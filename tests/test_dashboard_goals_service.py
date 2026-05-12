import json
import sqlite3

from services.dashboard_goals import (
    DEFAULT_GOALS_CONFIG,
    build_goals_payload,
    compute_daily_carryover,
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


# ─── Carryover (report d'objectifs non atteints au jour ouvré suivant) ───

def test_default_goals_config_exposes_carryover_meta():
    assert DEFAULT_GOALS_CONFIG["meta"]["carryover_enabled"] is True
    assert DEFAULT_GOALS_CONFIG["meta"]["carryover_max_days"] == 7


def test_get_goals_config_coerces_carryover_meta_from_db():
    conn = _conn_with_app_settings()
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?)",
        (
            "goals_config",
            json.dumps({"meta": {"carryover_enabled": "false", "carryover_max_days": "3"}}),
        ),
    )

    cfg = get_goals_config(conn)

    assert cfg["meta"]["carryover_enabled"] is False
    assert cfg["meta"]["carryover_max_days"] == 3


def test_decorate_goals_scope_applies_carryover_to_target():
    scope_cfg = {"push": {"label": "Push", "target": 3, "xp": 60}}
    counts = {"push": 4}

    payload = decorate_goals_scope(scope_cfg, counts, carryover={"push": 2})

    item = payload["items"]["push"]
    assert item["base_target"] == 3
    assert item["carryover"] == 2
    assert item["target"] == 5  # 3 base + 2 reportés
    assert item["done"] is False
    assert item["count"] == 4
    assert round(item["ratio"], 4) == 0.8
    assert item["xp_earned"] == 48  # 60 * 0.8


def test_decorate_goals_scope_carryover_ignored_when_target_zero():
    """Un objectif désactivé (target=0) ne doit jamais hériter de carryover."""
    scope_cfg = {"push": {"label": "Push", "target": 0, "xp": 60}}

    payload = decorate_goals_scope(scope_cfg, {"push": 0}, carryover={"push": 5})

    item = payload["items"]["push"]
    assert item["base_target"] == 0
    assert item["carryover"] == 0
    assert item["target"] == 0


def test_compute_daily_carryover_single_day_shortfall():
    daily_cfg = {"push": {"target": 3, "xp": 60}, "rdv": {"target": 1, "xp": 120}}
    # Lundi : 1/3 push, 1/1 rdv → shortfall push=2, rdv=0
    counts = {"2026-05-04": {"push": 1, "rdv": 1}}

    out = compute_daily_carryover(
        daily_cfg=daily_cfg,
        counts_by_date=counts,
        working_days=["2026-05-04"],
        today="2026-05-05",
    )

    assert out == {"push": 2, "rdv": 0}


def test_compute_daily_carryover_chains_over_working_days():
    """Le déficit se propage : un jour qui rate son target effectif (base + report)
    reporte le solde au prochain jour ouvré."""
    daily_cfg = {"push": {"target": 3, "xp": 60}}
    counts = {
        "2026-05-04": {"push": 1},   # eff=3, 1/3 → shortfall=2
        "2026-05-05": {"push": 4},   # eff=3+2=5, 4/5 → shortfall=1
        "2026-05-06": {"push": 5},   # eff=3+1=4, 5/4 → shortfall=0 (reset)
    }

    out = compute_daily_carryover(
        daily_cfg=daily_cfg,
        counts_by_date=counts,
        working_days=["2026-05-04", "2026-05-05", "2026-05-06"],
        today="2026-05-07",
    )

    assert out == {"push": 0}


def test_compute_daily_carryover_chains_when_never_caught_up():
    daily_cfg = {"push": {"target": 3, "xp": 60}}
    counts = {
        "2026-05-04": {"push": 0},   # eff=3, 0/3 → shortfall=3
        "2026-05-05": {"push": 1},   # eff=3+3=6, 1/6 → shortfall=5
    }

    out = compute_daily_carryover(
        daily_cfg=daily_cfg,
        counts_by_date=counts,
        working_days=["2026-05-04", "2026-05-05"],
        today="2026-05-06",
    )

    assert out == {"push": 5}


def test_compute_daily_carryover_excludes_today_and_caps_lookback():
    daily_cfg = {"push": {"target": 3, "xp": 60}}
    # 10 jours ouvrés successifs, 0 push partout → chaque jour ajoute 3
    days = [f"2026-04-{d:02d}" for d in range(6, 16)]  # 10 dates fictives ouvrées
    counts = {d: {"push": 0} for d in days}

    out = compute_daily_carryover(
        daily_cfg=daily_cfg,
        counts_by_date=counts,
        working_days=days + ["2026-04-16"],  # today inclus dans la liste → doit être exclu
        today="2026-04-16",
        max_days=3,
    )

    # Cap à 3 jours ouvrés : 3+3+3 = 9 (la 3e itération a eff=3+6=9, count=0 → shortfall=9)
    assert out == {"push": 9}


def test_compute_daily_carryover_skips_goals_without_target():
    """Un objectif désactivé (target=0) ne doit pas générer de carryover."""
    daily_cfg = {
        "rdv": {"target": 1, "xp": 120},
        "push": {"target": 0, "xp": 60},   # désactivé
    }
    counts = {"2026-05-04": {"rdv": 0, "push": 0}}

    out = compute_daily_carryover(
        daily_cfg=daily_cfg,
        counts_by_date=counts,
        working_days=["2026-05-04"],
        today="2026-05-05",
    )

    assert out == {"rdv": 1}
    assert "push" not in out


def test_compute_daily_carryover_empty_when_no_previous_working_days():
    daily_cfg = {"push": {"target": 3, "xp": 60}}

    out = compute_daily_carryover(
        daily_cfg=daily_cfg,
        counts_by_date={},
        working_days=[],
        today="2026-05-05",
    )

    assert out == {"push": 0}


def test_build_goals_payload_propagates_daily_carryover():
    goals_cfg = {
        "daily": {"push": {"label": "Push", "target": 3, "xp": 60}},
        "weekly": {"push": {"label": "Push wk", "target": 15, "xp": 180}},
    }

    payload = build_goals_payload(
        goals_cfg=goals_cfg,
        daily_counts={"push": 2},
        weekly_counts={"push": 5},
        daily_carryover={"push": 2},
    )

    daily_push = payload["daily"]["items"]["push"]
    assert daily_push["target"] == 5
    assert daily_push["base_target"] == 3
    assert daily_push["carryover"] == 2
    # Le carryover ne s'applique pas au scope weekly
    weekly_push = payload["weekly"]["items"]["push"]
    assert weekly_push["target"] == 15
    assert weekly_push["carryover"] == 0
