"""Per-lane and system-wide error handling for the NEXUS detector service.

This module implements the error-handling layer that the detection endpoints
(``GET /detections``, ``GET /detections/{laneId}``, ``GET /health``) build on.
It is intentionally dependency-light (standard library only): no cv2, numpy, or
ML imports, so it can be imported and unit-tested in a bare environment and it
mirrors the pattern used by :mod:`app.config`, :mod:`app.density`, and
:mod:`app.video_loop`.

Design goals (design: Python CV Microservice -> per-lane error objects):

  * **One bad lane never fails the batch.** An unopenable clip or an
    unprocessable frame for a single lane yields a per-lane error object
    ``{"lane_id": id, "result": null, "error": {"code", "message"}}`` while the
    healthy lanes carry their detection ``result`` unchanged
    (Requirements 1.4, 1.5, 2.5, 11.4).
  * **System-wide configuration error.** When *all* configured clips fail to
    open, the service reports an overall status of ``"config_error"``; otherwise
    the status is ``"ok"`` (Requirement 1.6).

The functions accept flexible per-lane "state" values so callers can pass either
a :class:`app.video_loop.VideoLoop` (which exposes ``opened`` / ``is_open()`` and
a lane-identifying ``error``), a :class:`app.video_loop.CaptureError`, a plain
error ``dict`` ``{"code", "message"}``, or ``None`` for a healthy lane.

Requirements:
  - 1.4: a missing/unopenable clip reports a source error identifying the Lane ID.
  - 1.5: when a Lane's clip is unavailable, the others keep producing output.
  - 1.6: if all four clips fail to open, report a system-wide configuration error.
  - 2.5: if a frame cannot be processed, return an error identifying the Lane ID.
  - 11.4: if the service returns an error for a single Lane, the others continue.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

# Overall service-status values surfaced by GET /health (design: Data Models).
STATUS_OK = "ok"
STATUS_CONFIG_ERROR = "config_error"

# Canonical error codes for the per-lane error objects.
CODE_CLIP_OPEN_FAILED = "CLIP_OPEN_FAILED"
CODE_FRAME_PROCESS_FAILED = "FRAME_PROCESS_FAILED"


def _error_to_dict(error: Any, lane_id: Optional[int] = None) -> Dict[str, Any]:
    """Coerce an error-like value into a ``{"code", "message"}`` dict.

    Accepts a :class:`app.video_loop.CaptureError` (has ``code``/``message``), a
    plain mapping, or an arbitrary object/string. Always returns a dict with at
    least ``code`` and ``message`` keys so the JSON contract is stable.
    """
    # CaptureError or any object exposing code/message attributes.
    code = getattr(error, "code", None)
    message = getattr(error, "message", None)
    if code is not None or message is not None:
        out: Dict[str, Any] = {
            "code": str(code) if code is not None else CODE_CLIP_OPEN_FAILED,
            "message": str(message) if message is not None else "",
        }
        attr_lane = getattr(error, "lane_id", None)
        if attr_lane is not None:
            out["lane_id"] = attr_lane
        return out

    # Mapping form: {"code", "message", ...}.
    if isinstance(error, Mapping):
        out = {
            "code": str(error.get("code", CODE_CLIP_OPEN_FAILED)),
            "message": str(error.get("message", "")),
        }
        if "lane_id" in error:
            out["lane_id"] = error["lane_id"]
        return out

    # Fallback: a bare string or other value becomes the message.
    return {
        "code": CODE_CLIP_OPEN_FAILED,
        "message": "" if error is None else str(error),
    }


def normalize_lane_error(
    state: Any, lane_id: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    """Return a ``{"code", "message"}`` error dict for a lane, or ``None``.

    Interprets a per-lane "state" value and reports whether that lane is in an
    error state:

      * ``None``                       -> ``None`` (healthy lane).
      * a ``VideoLoop`` (has ``opened``/``error``) -> ``None`` when open, else its
        lane-identifying error (synthesised if the loop is closed without one).
      * a ``CaptureError`` / error object (has ``code``/``message``) -> its error.
      * an error ``Mapping`` ``{"code", "message"}`` -> that error.

    Args:
        state: The per-lane state to interpret.
        lane_id: Optional lane id used to enrich a synthesised error message.

    Returns:
        An error dict identifying the affected lane, or ``None`` if the lane is
        healthy / open (Requirements 1.4, 2.5).
    """
    if state is None:
        return None

    # VideoLoop-like: openability decides whether there's an error.
    if hasattr(state, "opened") and hasattr(state, "error"):
        if getattr(state, "opened"):
            return None
        err = getattr(state, "error")
        resolved_lane = lane_id if lane_id is not None else getattr(state, "lane_id", None)
        if err is not None:
            return _error_to_dict(err, resolved_lane)
        # Closed but no error object recorded: synthesise a clear, lane-identifying one.
        suffix = f"lane_{resolved_lane} " if resolved_lane is not None else ""
        return {
            "code": CODE_CLIP_OPEN_FAILED,
            "message": f"{suffix}clip could not be opened".strip(),
        }

    # CaptureError-like or error mapping.
    if hasattr(state, "code") or hasattr(state, "message") or isinstance(state, Mapping):
        return _error_to_dict(state, lane_id)

    return None


def lane_error_map(lane_states: Mapping[int, Any]) -> Dict[int, Optional[Dict[str, Any]]]:
    """Map each lane id to its error dict, or ``None`` when the lane is healthy.

    Args:
        lane_states: Mapping ``lane_id -> state`` (``VideoLoop`` | error | ``None``).

    Returns:
        Mapping ``lane_id -> {"code", "message"} | None`` for every configured lane.
    """
    return {
        lane_id: normalize_lane_error(state, lane_id)
        for lane_id, state in lane_states.items()
    }


def failed_lane_ids(lane_states: Mapping[int, Any]) -> List[int]:
    """Return the sorted list of lane ids whose clip failed to open / errored."""
    return sorted(
        lane_id
        for lane_id, state in lane_states.items()
        if normalize_lane_error(state, lane_id) is not None
    )


def service_status(lane_states: Mapping[int, Any]) -> str:
    """Compute the overall service status from per-lane open/error states.

    Returns ``"config_error"`` when there is at least one configured lane and
    *every* configured lane failed to open; otherwise ``"ok"`` (Requirement 1.6).
    An empty mapping (no configured lanes) yields ``"ok"`` since there is nothing
    to have failed.

    Args:
        lane_states: Mapping ``lane_id -> state`` (``VideoLoop`` | error | ``None``).

    Returns:
        ``"config_error"`` or ``"ok"``.
    """
    if not lane_states:
        return STATUS_OK
    failed = failed_lane_ids(lane_states)
    return STATUS_CONFIG_ERROR if len(failed) == len(lane_states) else STATUS_OK


def compute_health(lane_states: Mapping[int, Any]) -> Dict[str, Any]:
    """Compute both the per-lane error map and the system-wide status.

    This is the single entry point the ``GET /health`` endpoint uses: given the
    per-lane open/error states, it returns the overall ``service_status`` plus a
    per-lane error map and the list of failed lanes so a single unavailable lane
    is surfaced without failing the others (Requirements 1.4, 1.5, 1.6, 11.4).

    Args:
        lane_states: Mapping ``lane_id -> state`` (``VideoLoop`` | error | ``None``).

    Returns:
        ``{"service_status", "lane_errors", "failed_lanes"}``.
    """
    errors = lane_error_map(lane_states)
    failed = sorted(lane_id for lane_id, err in errors.items() if err is not None)
    status = (
        STATUS_CONFIG_ERROR
        if lane_states and len(failed) == len(lane_states)
        else STATUS_OK
    )
    return {
        "service_status": status,
        "lane_errors": errors,
        "failed_lanes": failed,
    }


def build_lane_result_entry(
    lane_id: int,
    result: Optional[Any] = None,
    error: Any = None,
) -> Dict[str, Any]:
    """Build a single per-lane result entry for the detection endpoints.

    When ``error`` is present (an unopenable clip or an unprocessable frame), the
    entry carries ``result: null`` and a lane-identifying error object. Otherwise
    the lane's ``result`` is carried through with ``error: null`` (Requirements
    1.4, 2.5, 11.4).

    Args:
        lane_id: The system lane id this entry describes.
        result: The lane's Detection_Result (used only when there is no error).
        error: An error-like value (``CaptureError`` | mapping | str) or ``None``.

    Returns:
        ``{"lane_id", "result", "error"}`` where exactly one of ``result`` /
        ``error`` is populated.
    """
    if error is not None:
        err = _error_to_dict(error, lane_id)
        # Keep the error self-describing about the lane it belongs to.
        err.setdefault("lane_id", lane_id)
        return {"lane_id": lane_id, "result": None, "error": err}
    return {"lane_id": lane_id, "result": result, "error": None}


def frame_error(lane_id: int, message: str) -> Dict[str, Any]:
    """Build an unprocessable-frame error object identifying the lane (R2.5)."""
    return {
        "code": CODE_FRAME_PROCESS_FAILED,
        "message": message,
        "lane_id": lane_id,
    }


def build_lane_results(
    results: Optional[Mapping[int, Any]] = None,
    errors: Optional[Mapping[int, Any]] = None,
    lane_ids: Optional[List[int]] = None,
) -> Dict[int, Dict[str, Any]]:
    """Build per-lane result entries, combining successful results and errors.

    Errors take precedence over results so that an unopenable clip / unprocessable
    frame for one lane produces an error entry while every healthy lane carries
    its result — one bad lane never fails the whole batch (Requirements 1.4, 1.5,
    2.5, 11.4).

    The set of lanes covered is the union of ``lane_ids``, the keys of
    ``results``, and the keys of ``errors``.

    Args:
        results: Mapping ``lane_id -> Detection_Result`` for healthy lanes.
        errors: Mapping ``lane_id -> error`` (``CaptureError`` | mapping | str) for
            lanes whose clip is unopenable or whose frame is unprocessable.
        lane_ids: Optional explicit list of lane ids to include (e.g. all four
            configured lanes), even if absent from ``results`` / ``errors``.

    Returns:
        Mapping ``lane_id -> {"lane_id", "result", "error"}`` for every covered lane.
    """
    results = results or {}
    errors = errors or {}

    covered: set[int] = set()
    if lane_ids:
        covered.update(lane_ids)
    covered.update(results.keys())
    covered.update(errors.keys())

    entries: Dict[int, Dict[str, Any]] = {}
    for lane_id in sorted(covered):
        error = errors.get(lane_id)
        result = results.get(lane_id)
        entries[lane_id] = build_lane_result_entry(lane_id, result=result, error=error)
    return entries


def build_detections_payload(
    results: Optional[Mapping[int, Any]] = None,
    errors: Optional[Mapping[int, Any]] = None,
    lane_states: Optional[Mapping[int, Any]] = None,
    lane_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """Assemble the ``GET /detections`` payload: status + per-lane entries.

    Combines the per-lane result entries (results vs. errors) with the
    system-wide status. When ``lane_states`` is omitted, the status is derived
    from ``errors`` alone (treating any lane with an error as failed), which lets
    callers use this without a ``VideoLoop`` handle.

    Args:
        results: Mapping ``lane_id -> Detection_Result`` for healthy lanes.
        errors: Mapping ``lane_id -> error`` for failed lanes.
        lane_states: Optional mapping ``lane_id -> VideoLoop`` used to compute the
            system-wide ``config_error`` status from clip openability.
        lane_ids: Optional explicit list of lane ids to include.

    Returns:
        ``{"service_status", "lanes"}`` where ``lanes`` maps lane id (as ``str``)
        to its per-lane entry, matching the JSON contract in the design.
    """
    entries = build_lane_results(results=results, errors=errors, lane_ids=lane_ids)

    if lane_states is not None:
        status = service_status(lane_states)
    else:
        # Derive status from the entries: config_error only when every covered
        # lane is in an error state.
        if entries and all(entry["error"] is not None for entry in entries.values()):
            status = STATUS_CONFIG_ERROR
        else:
            status = STATUS_OK

    return {
        "service_status": status,
        "lanes": {str(lane_id): entry for lane_id, entry in entries.items()},
    }
