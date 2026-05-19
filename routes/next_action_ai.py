"""ProspUp — Blueprint Next Action IA (Phase 2 productivité v32.x).

Suggestions IA passives par prospect : badge sur la fiche, liste dans
Focus. L'utilisateur décide d'appliquer ou non.

Endpoints :
- GET  /api/ai/next-action/<id>             — suggestion en cache (sans regen)
- POST /api/ai/next-action/<id>/refresh     — force regen IA pour ce prospect
- GET  /api/ai/next-action/today            — top 10 suggestions actives (Focus)
- POST /api/ai/next-action/refresh-batch    — regen N prospects actifs (admin)
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from services.next_action_ai import (
    SUGGESTION_TTL_DAYS,
    generate_for_prospect,
    get_cached,
    is_suggestion_stale,
    list_active_prospect_ids,
    list_today_suggestions,
)
from utils.auth import _prospect_owned, _uid

next_action_ai_bp = Blueprint("next_action_ai", __name__)


@next_action_ai_bp.get("/api/ai/next-action/<int:prospect_id>")
def api_next_action_get(prospect_id: int):
    """Retourne la suggestion en cache pour un prospect (sans regen)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Prospect introuvable"), 404
    suggestion = get_cached(prospect_id, uid)
    return jsonify(
        ok=True,
        suggestion=suggestion,
        stale=is_suggestion_stale(suggestion),
        ttl_days=SUGGESTION_TTL_DAYS,
    )


@next_action_ai_bp.post("/api/ai/next-action/<int:prospect_id>/refresh")
def api_next_action_refresh(prospect_id: int):
    """Force la regénération de la suggestion pour ce prospect."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Prospect introuvable"), 404
    res = generate_for_prospect(prospect_id, uid)
    if not res.get("ok"):
        return jsonify(ok=False, error=res.get("error") or "Échec"), 502
    return jsonify(ok=True, suggestion=res["suggestion"])


@next_action_ai_bp.get("/api/ai/next-action/today")
def api_next_action_today():
    """Top suggestions actives pour aujourd'hui (vue Focus)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    try:
        limit = max(1, min(50, int(request.args.get("limit", "10"))))
    except (TypeError, ValueError):
        limit = 10
    items = list_today_suggestions(uid, limit=limit)
    return jsonify(ok=True, items=items, count=len(items))


@next_action_ai_bp.post("/api/ai/next-action/refresh-batch")
def api_next_action_refresh_batch():
    """Regénère les suggestions pour N prospects actifs (manuel).

    Body : {"limit": int (max 20), "force": bool}
    - force=False : ne regénère que les suggestions périmées (>7j) ou absentes
    - force=True  : regénère toutes les suggestions de tous les actifs
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    try:
        limit = max(1, min(20, int(payload.get("limit", 10))))
    except (TypeError, ValueError):
        limit = 10
    force = bool(payload.get("force"))

    candidates = list_active_prospect_ids(uid)
    refreshed = 0
    failed = 0
    skipped = 0
    errors: list[str] = []

    for pid in candidates:
        if refreshed >= limit:
            break
        if not force:
            cached = get_cached(pid, uid)
            if cached and not is_suggestion_stale(cached):
                skipped += 1
                continue
        res = generate_for_prospect(pid, uid)
        if res.get("ok"):
            refreshed += 1
        else:
            failed += 1
            if len(errors) < 3:
                errors.append(f"#{pid}: {res.get('error')}")

    return jsonify(
        ok=True,
        total_candidates=len(candidates),
        refreshed=refreshed,
        failed=failed,
        skipped=skipped,
        errors=errors,
    )
