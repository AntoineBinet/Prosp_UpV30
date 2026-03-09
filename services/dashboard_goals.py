from __future__ import annotations

import json
from typing import Any

DEFAULT_GOALS_CONFIG = {
    "daily": {
        "rdv": {"label": "Prendre 1 RDV Prosp", "target": 1, "xp": 120},
        "push": {"label": "3 push", "target": 3, "xp": 60},
        "sourcing_contacted": {"label": "Sourcing : contacter 3 candidats qualifiés", "target": 3, "xp": 40},
    },
    "weekly": {
        "rdv": {"label": "Prendre 5 RDV Prosp", "target": 5, "xp": 300},
        "push": {"label": "15 push", "target": 15, "xp": 180},
        "sourcing_contacted": {"label": "Sourcing : contacter 15 candidats qualifiés", "target": 15, "xp": 120},
        "sourcing_solid": {
            "label": "Sourcing : avoir trois profils solide dans dossiers candidats",
            "target": 3,
            "xp": 120,
        },
    },
    "meta": {
        "push_channels": "any",
        "reset_weekday": 0,
    },
}


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def get_goals_config(conn: Any) -> dict[str, Any]:
    """Load goals_config from app_settings and merge with defaults."""
    raw = None
    try:
        row = conn.execute("SELECT value FROM app_settings WHERE key=?", ("goals_config",)).fetchone()
        raw = row["value"] if row else None
    except Exception:
        raw = None

    cfg: dict[str, Any] = {}
    if raw:
        try:
            cfg = json.loads(raw)
        except Exception:
            cfg = {}

    out = json.loads(json.dumps(DEFAULT_GOALS_CONFIG))
    for scope in ("daily", "weekly"):
        if isinstance(cfg.get(scope), dict):
            for key, value in cfg[scope].items():
                if key in out[scope] and isinstance(value, dict):
                    if "target" in value:
                        out[scope][key]["target"] = safe_int(value.get("target"), out[scope][key]["target"])
                    if "xp" in value:
                        out[scope][key]["xp"] = safe_int(value.get("xp"), out[scope][key]["xp"])

    if isinstance(cfg.get("meta"), dict):
        out.setdefault("meta", {}).update(cfg["meta"])
    return out


def decorate_goals_scope(scope_cfg: dict[str, Any], counts: dict[str, Any]) -> dict[str, Any]:
    """Compute ratios and xp for a scope (daily or weekly)."""
    items: dict[str, dict[str, Any]] = {}
    xp_total = 0
    xp_current = 0

    for key, cfg in (scope_cfg or {}).items():
        label = (cfg or {}).get("label") or key
        target = safe_int((cfg or {}).get("target"), 0)
        xp = safe_int((cfg or {}).get("xp"), 0)
        count = safe_int((counts or {}).get(key), 0)
        ratio = 1.0 if target <= 0 else min(1.0, float(count) / float(target))
        done = target > 0 and count >= target
        xp_earned = xp if done else int(round(xp * ratio))

        items[key] = {
            "label": label,
            "target": target,
            "xp": xp,
            "count": count,
            "ratio": ratio,
            "done": done,
            "xp_earned": xp_earned,
        }
        xp_total += xp
        xp_current += xp_earned

    return {"items": items, "xp_total": xp_total, "xp_current": xp_current}


def build_goals_payload(
    goals_cfg: dict[str, Any],
    daily_counts: dict[str, Any],
    weekly_counts: dict[str, Any],
) -> dict[str, Any]:
    """Build normalized dashboard goals payload from config + counts."""
    return {
        "config": goals_cfg,
        "daily": decorate_goals_scope(goals_cfg.get("daily", {}), daily_counts),
        "weekly": decorate_goals_scope(goals_cfg.get("weekly", {}), weekly_counts),
    }
