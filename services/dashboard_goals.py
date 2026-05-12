from __future__ import annotations

import json
from typing import Any, Iterable

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
        # Report d'objectifs quotidiens non atteints sur le jour ouvré suivant.
        "carryover_enabled": True,
        "carryover_max_days": 7,
    },
}


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def safe_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ("1", "true", "yes", "on", "oui"):
            return True
        if v in ("0", "false", "no", "off", "non", ""):
            return False
    return default


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

    meta_in = cfg.get("meta") if isinstance(cfg.get("meta"), dict) else {}
    meta_out = out.setdefault("meta", {})
    # Champs libres (push_channels, reset_weekday, …) — passe-plat.
    for k, v in meta_in.items():
        meta_out[k] = v
    # Champs typés (carryover) — coercition stricte pour éviter les
    # valeurs hétérogènes venant d'anciens JSON ou de l'UI.
    if "carryover_enabled" in meta_in:
        meta_out["carryover_enabled"] = safe_bool(
            meta_in.get("carryover_enabled"),
            default=bool(DEFAULT_GOALS_CONFIG["meta"]["carryover_enabled"]),
        )
    if "carryover_max_days" in meta_in:
        meta_out["carryover_max_days"] = max(
            0,
            safe_int(
                meta_in.get("carryover_max_days"),
                default=int(DEFAULT_GOALS_CONFIG["meta"]["carryover_max_days"]),
            ),
        )
    return out


def decorate_goals_scope(
    scope_cfg: dict[str, Any],
    counts: dict[str, Any],
    carryover: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute ratios and xp for a scope (daily or weekly).

    Si `carryover` est fourni (mapping {goal_key: int>=0}), la cible
    effective de chaque objectif est augmentée du carryover correspondant.
    Le détail d'origine (`base_target`, `carryover`) est exposé dans l'item.
    """
    items: dict[str, dict[str, Any]] = {}
    xp_total = 0
    xp_current = 0
    carryover = carryover or {}

    for key, cfg in (scope_cfg or {}).items():
        label = (cfg or {}).get("label") or key
        base_target = safe_int((cfg or {}).get("target"), 0)
        carry = max(0, safe_int(carryover.get(key, 0), 0)) if base_target > 0 else 0
        target = base_target + carry
        xp = safe_int((cfg or {}).get("xp"), 0)
        count = safe_int((counts or {}).get(key), 0)
        ratio = 1.0 if target <= 0 else min(1.0, float(count) / float(target))
        done = target > 0 and count >= target
        xp_earned = xp if done else int(round(xp * ratio))

        items[key] = {
            "label": label,
            "target": target,
            "base_target": base_target,
            "carryover": carry,
            "xp": xp,
            "count": count,
            "ratio": ratio,
            "done": done,
            "xp_earned": xp_earned,
        }
        xp_total += xp
        xp_current += xp_earned

    return {"items": items, "xp_total": xp_total, "xp_current": xp_current}


def compute_daily_carryover(
    daily_cfg: dict[str, Any],
    counts_by_date: dict[str, dict[str, Any]],
    working_days: Iterable[str],
    today: str,
    max_days: int = 7,
) -> dict[str, int]:
    """Calcule le report d'objectifs quotidiens non atteints sur les jours
    ouvrés précédents.

    Pour chaque objectif quotidien, on propage le déficit (target effectif − count)
    de chaque jour ouvré antérieur à `today`, en chaînant : un jour ouvré qui
    n'atteint pas son target *effectif* (base + report de la veille) reporte
    le solde au prochain jour ouvré. Si un jour atteint ou dépasse son target
    effectif, le report repart de zéro.

    Args:
        daily_cfg: section `daily` de goals_config (avec `target` par clé).
        counts_by_date: dict {ISO date → {goal_key: count}}. Les dates manquantes
            sont traitées comme 0 (pas d'activité).
        working_days: iterable d'ISO dates considérées comme jours ouvrés
            (du plus ancien au plus récent, ou non trié — la fonction trie).
        today: ISO date du jour courant (exclu du calcul — on ne rapporte
            que les jours ouvrés *avant* today).
        max_days: nombre maximum de jours ouvrés précédents à prendre en
            compte (cap pour éviter une dette s'accumulant indéfiniment).

    Returns:
        Dict {goal_key: carryover_int} où carryover_int >= 0.
        Ne contient que les clés présentes dans daily_cfg avec un target > 0.
    """
    keys = [k for k, v in (daily_cfg or {}).items() if safe_int((v or {}).get("target"), 0) > 0]
    if not keys:
        return {}

    prev_wds = sorted(d for d in (working_days or []) if d and d < today)
    if max_days > 0:
        prev_wds = prev_wds[-max_days:]
    if not prev_wds:
        return {k: 0 for k in keys}

    targets = {k: safe_int((daily_cfg.get(k) or {}).get("target"), 0) for k in keys}
    shortfall = {k: 0 for k in keys}
    for d in prev_wds:
        counts = counts_by_date.get(d) or {}
        for k in keys:
            eff_target = targets[k] + shortfall[k]
            count = safe_int(counts.get(k, 0), 0)
            shortfall[k] = max(0, eff_target - count)
    return shortfall


def build_goals_payload(
    goals_cfg: dict[str, Any],
    daily_counts: dict[str, Any],
    weekly_counts: dict[str, Any],
    daily_carryover: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build normalized dashboard goals payload from config + counts.

    Le `daily_carryover` (optionnel) augmente les cibles quotidiennes — c'est
    le mécanisme de report d'objectifs non atteints au jour ouvré précédent.
    Voir `compute_daily_carryover`.
    """
    return {
        "config": goals_cfg,
        "daily": decorate_goals_scope(goals_cfg.get("daily", {}), daily_counts, daily_carryover),
        "weekly": decorate_goals_scope(goals_cfg.get("weekly", {}), weekly_counts),
    }
