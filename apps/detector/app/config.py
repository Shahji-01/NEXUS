"""Effective configuration for the NEXUS detector service.

This module is intentionally dependency-light (standard library only) so it can
be imported and exercised without the heavy CV/ML stack installed. It centralises
the lane mapping, detection thresholds, calibration values, playback cadence, and
the network binding used by the FastAPI app.

Requirements:
  - 1.1 / 1.3: one clip per lane, mapped to the North/South/East/West lane ids.
  - 2.6: the service runs server-side, separate from the browser.
  - 10.5: a configured Lane_Mapping translates detector identifiers to system lane ids.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict
from urllib.parse import urlparse

# --- Constants ------------------------------------------------------------

# Default base URL the Node API uses to reach this service (design: DETECTOR_URL).
DEFAULT_DETECTOR_URL = "http://127.0.0.1:8099"

# Translation table between detector camera identifiers and system lane ids 0..3.
# Lane ids are consistent with the existing system: 0=North, 1=South, 2=East, 3=West.
DEFAULT_LANE_MAPPING: Dict[str, int] = {
    "cam_north": 0,
    "cam_south": 1,
    "cam_east": 2,
    "cam_west": 3,
}

# Human-readable direction per system lane id (mirrors the Node LANE_DIRECTIONS).
LANE_DIRECTIONS: Dict[int, str] = {
    0: "North",
    1: "South",
    2: "East",
    3: "West",
}

# Congestion thresholds derived from density (mirror the Node simulation thresholds).
# density > 80 -> critical, > 55 -> high, > 30 -> medium, else low.
CONGESTION_CRITICAL_MIN = 80.0
CONGESTION_HIGH_MIN = 55.0
CONGESTION_MEDIUM_MIN = 30.0

# Clip filename convention: clips/lane_{0..3}.mp4
CLIP_FILENAME_TEMPLATE = "lane_{lane_id}.mp4"


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _host_port_from_url(url: str) -> tuple[str, int]:
    """Extract (host, port) from DETECTOR_URL, falling back to 127.0.0.1:8099."""
    parsed = urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 8099
    return host, port


@dataclass(frozen=True)
class DetectorConfig:
    """Effective, resolved configuration for one detector process."""

    # Network
    detector_url: str = DEFAULT_DETECTOR_URL
    host: str = "127.0.0.1"
    port: int = 8099

    # Lane mapping (detector identifier -> system lane id 0..3)
    lane_mapping: Dict[str, int] = field(default_factory=lambda: dict(DEFAULT_LANE_MAPPING))

    # Detection thresholds
    detection_confidence_min: float = 0.35  # minimum confidence to count a detection
    emergency_confidence_min: float = 0.60  # minimum confidence for an emergency-vehicle report (R5.1)

    # Congestion derivation thresholds
    congestion_critical_min: float = CONGESTION_CRITICAL_MIN
    congestion_high_min: float = CONGESTION_HIGH_MIN
    congestion_medium_min: float = CONGESTION_MEDIUM_MIN

    # Calibration / playback
    meters_per_pixel: float = 0.05  # spatial calibration for speed estimation (R3)
    fps: float = 25.0              # clip frame rate used for speed estimation
    max_speed_kmh: float = 200.0  # reported speed is bounded to [0, 200] (R3.4)

    # Performance tuning
    inference_imgsz: int = 480     # YOLO input size; smaller = faster CPU inference
    overlay_max_width: int = 854   # downscale overlay frames to this width before JPEG
    overlay_jpeg_quality: int = 70  # JPEG quality for overlay frames (smaller payloads)

    # Clips
    clips_dir: str = "clips"
    clip_filename_template: str = CLIP_FILENAME_TEMPLATE

    @property
    def lane_ids(self) -> list[int]:
        """System lane ids covered by the lane mapping, sorted ascending."""
        return sorted(set(self.lane_mapping.values()))

    def clip_path(self, lane_id: int) -> Path:
        """Absolute-relative path to the clip for a given system lane id."""
        filename = self.clip_filename_template.format(lane_id=lane_id)
        return Path(self.clips_dir) / filename

    def as_dict(self) -> dict:
        """Serialisable view of the effective config for the GET /config endpoint."""
        return {
            "detector_url": self.detector_url,
            "host": self.host,
            "port": self.port,
            "lane_mapping": dict(self.lane_mapping),
            "lane_directions": {str(k): v for k, v in LANE_DIRECTIONS.items()},
            "thresholds": {
                "detection_confidence_min": self.detection_confidence_min,
                "emergency_confidence_min": self.emergency_confidence_min,
                "congestion_critical_min": self.congestion_critical_min,
                "congestion_high_min": self.congestion_high_min,
                "congestion_medium_min": self.congestion_medium_min,
            },
            "meters_per_pixel": self.meters_per_pixel,
            "fps": self.fps,
            "max_speed_kmh": self.max_speed_kmh,
            "clips": {
                "dir": self.clips_dir,
                "filename_template": self.clip_filename_template,
                "expected": {
                    str(lane_id): str(self.clip_path(lane_id))
                    for lane_id in self.lane_ids
                },
            },
        }


def load_config() -> DetectorConfig:
    """Build the effective config from environment variables with sane defaults."""
    detector_url = os.environ.get("DETECTOR_URL", DEFAULT_DETECTOR_URL)
    env_host, env_port = _host_port_from_url(detector_url)

    return DetectorConfig(
        detector_url=detector_url,
        host=os.environ.get("DETECTOR_HOST", env_host),
        port=_env_int("DETECTOR_PORT", env_port),
        lane_mapping=dict(DEFAULT_LANE_MAPPING),
        detection_confidence_min=_env_float("DETECTION_CONFIDENCE_MIN", 0.35),
        emergency_confidence_min=_env_float("EMERGENCY_CONFIDENCE_MIN", 0.60),
        meters_per_pixel=_env_float("METERS_PER_PIXEL", 0.05),
        fps=_env_float("DETECTOR_FPS", 25.0),
        clips_dir=os.environ.get("CLIPS_DIR", "clips"),
    )


# Module-level singleton used by the FastAPI app.
config = load_config()
