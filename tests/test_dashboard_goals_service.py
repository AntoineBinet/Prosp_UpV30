import json
import sqlite3

from services.dashboard_goals import (
    DEFAULT_GOALS_CONFIG,
    build_goals_payload,
    decorate_goals_scope,
    get_goals_config,
)


def _conn_with_app_settings() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)")
    return conn


def test_get_goals_config_returns_defaults_without_db_value():
    conn = _conn_with_app_settings()

    cfg = get_goals_config(conn)

    assert cfg == DEFAULT_GOALS_CONFIG


def test_get_goals_config_merges_known_fields_only():
    conn = _conn_with_app_settings()
    custom = {
        "daily": {"rdv": {"target": "2", "xp": "180"}, "unknown": {"target": 99}},
        "weekly": {"push": {"target": "20"}},
        "meta": {"push_channels": "email"},
    }
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?)",
        ("goals_config", json.dumps(custom)),
    )

    cfg = get_goals_config(conn)

    assert cfg["daily"]["rdv"]["target"] == 2
    assert cfg["daily"]["rdv"]["xp"] == 180
    assert "unknown" not in cfg["daily"]
    assert cfg["weekly"]["push"]["target"] == 20
    assert cfg["meta"]["push_channels"] == "email"
    assert cfg["weekly"]["rdv"]["target"] == DEFAULT_GOALS_CONFIG["weekly"]["rdv"]["target"]


def test_decorate_goals_scope_computes_ratio_done_and_xp():
    scope_cfg = {
        "rdv": {"label": "RDV", "target": 5, "xp": 100},
        "push": {"label": "Push", "target": 4, "xp": 80},
    }
    counts = {"rdv": 3, "push": 6}

    payload = decorate_goals_scope(scope_cfg, counts)

    assert payload["xp_total"] == 180
    assert payload["xp_current"] == 140
    assert payload["items"]["rdv"]["ratio"] == 0.6
    assert payload["items"]["rdv"]["done"] is False
    assert payload["items"]["rdv"]["xp_earned"] == 60
    assert payload["items"]["push"]["ratio"] == 1.0
    assert payload["items"]["push"]["done"] is True
    assert payload["items"]["push"]["xp_earned"] == 80


def test_build_goals_payload_includes_config_and_decorated_scopes():
    goals_cfg = {
        "daily": {"rdv": {"label": "RDV", "target": 2, "xp": 100}},
        "weekly": {"push": {"label": "Push", "target": 4, "xp": 80}},
    }

    payload = build_goals_payload(
        goals_cfg=goals_cfg,
        daily_counts={"rdv": 1},
        weekly_counts={"push": 4},
    )

    assert payload["config"] == goals_cfg
    assert payload["daily"]["items"]["rdv"]["ratio"] == 0.5
    assert payload["daily"]["items"]["rdv"]["xp_earned"] == 50
    assert payload["weekly"]["items"]["push"]["done"] is True
    assert payload["weekly"]["xp_current"] == 80
