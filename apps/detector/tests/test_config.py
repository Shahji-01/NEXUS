"""Tests for the effective detector configuration (stdlib-only, no CV deps)."""

from __future__ import annotations

import importlib

from app.config import (
    DEFAULT_DETECTOR_URL,
    DEFAULT_LANE_MAPPING,
    DetectorConfig,
    _host_port_from_url,
    load_config,
)


def test_default_lane_mapping_covers_four_lanes():
    cfg = DetectorConfig()
    assert cfg.lane_mapping == {
        "cam_north": 0,
        "cam_south": 1,
        "cam_east": 2,
        "cam_west": 3,
    }
    assert cfg.lane_ids == [0, 1, 2, 3]


def test_lane_mapping_is_unique_and_total():
    # No two detector identifiers collide onto the same system lane id.
    values = list(DEFAULT_LANE_MAPPING.values())
    assert sorted(values) == [0, 1, 2, 3]
    assert len(set(values)) == len(values)


def test_default_port_is_8099():
    cfg = DetectorConfig()
    assert cfg.port == 8099
    assert cfg.detector_url == DEFAULT_DETECTOR_URL


def test_clip_path_follows_convention():
    cfg = DetectorConfig()
    assert str(cfg.clip_path(0)).replace("\\", "/") == "clips/lane_0.mp4"
    assert str(cfg.clip_path(3)).replace("\\", "/") == "clips/lane_3.mp4"


def test_as_dict_includes_lane_mapping_and_thresholds():
    payload = DetectorConfig().as_dict()
    assert payload["lane_mapping"] == DEFAULT_LANE_MAPPING
    assert payload["port"] == 8099
    assert "emergency_confidence_min" in payload["thresholds"]
    assert "meters_per_pixel" in payload
    assert "fps" in payload
    assert set(payload["clips"]["expected"].keys()) == {"0", "1", "2", "3"}


def test_host_port_parsing():
    assert _host_port_from_url("http://127.0.0.1:8099") == ("127.0.0.1", 8099)
    assert _host_port_from_url("http://localhost") == ("localhost", 8099)


def test_load_config_reads_env(monkeypatch):
    monkeypatch.setenv("DETECTOR_URL", "http://0.0.0.0:9000")
    monkeypatch.setenv("EMERGENCY_CONFIDENCE_MIN", "0.75")
    monkeypatch.setenv("METERS_PER_PIXEL", "0.1")
    monkeypatch.setenv("DETECTOR_FPS", "30")

    cfg = load_config()
    assert cfg.host == "0.0.0.0"
    assert cfg.port == 9000
    assert cfg.emergency_confidence_min == 0.75
    assert cfg.meters_per_pixel == 0.1
    assert cfg.fps == 30.0
