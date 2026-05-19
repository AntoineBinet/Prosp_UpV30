"""ProspUp — Blueprint Score Prospect + Funnel (Phase 3 productivité v32.x).

Endpoints :
- GET /api/prospects/scores       — scores 0-100 par prospect (avec composantes)
- GET /api/stats/funnel           — funnel 5 étapes pour /v30/stats
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from services.prospect_score import compute_for_user, compute_funnel
from utils.auth import _uid

prospect_score_bp = Blueprint("prospect_score", __name__)


@prospect_score_bp.get("/api/prospects/scores")
def api_prospects_scores():
    """Retourne les scores des prospects de l'utilisateur.

    Query : ?ids=1,2,3 (optionnel) — restreint le calcul à ces IDs.
    Sinon retourne tous les prospects actifs.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    ids_param = (request.args.get("ids") or "").strip()
    prospect_ids: list[int] | None = None
    if ids_param:
        try:
            prospect_ids = [int(x) for x in ids_param.split(",") if x.strip()]
        except ValueError:
            return jsonify(ok=False, error="ids invalide"), 400

    scores = compute_for_user(uid, prospect_ids=prospect_ids)
    return jsonify(ok=True, scores=scores, count=len(scores))


@prospect_score_bp.get("/api/stats/funnel")
def api_stats_funnel():
    """Funnel 5 étapes : Total → Contactés → RDV pris → RDV tenus → Signés.

    Query : ?with_ids=1 pour inclure la liste des IDs par étape (pour
    drill-down). Sans ce flag, seuls les counts + taux sont retournés
    pour réduire le payload.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with_ids = request.args.get("with_ids", "").strip() == "1"
    data = compute_funnel(uid)

    if not with_ids:
        data["stages"] = [
            {k: v for k, v in s.items() if k != "ids"}
            for s in data["stages"]
        ]
    return jsonify(ok=True, **data)
