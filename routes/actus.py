"""ProspUp — Blueprint Actus (news marché du travail + offres d'emploi).

Page `/v30/actus` + API JSON `/api/actus/*`. La logique métier est dans
`services/actus.py` (cache SQLite partagé, sources RSS, adapter jobs).
"""
from __future__ import annotations

import threading

from flask import Blueprint, jsonify, render_template, request

from config import APP_VERSION
from services import actus as actus_svc
from utils.auth import _get_current_user, _uid, login_required, role_required
from utils.db import _sidebar_counts

actus_bp = Blueprint("actus", __name__)


# ────────────────────────────────────────────────────────────────────
#  Page
# ────────────────────────────────────────────────────────────────────

@actus_bp.get("/v30/actus")
@login_required
def page_v30_actus():
    """Rendu serveur de la page Actus. Les données sont chargées côté
    client via /api/actus/articles et /api/actus/jobs."""
    uid = _uid()
    user_initials = "AB"
    user = _get_current_user() or {}
    if uid:
        dn = (user.get("display_name") or user.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    return render_template(
        "v30/actus.html",
        active="actus",
        crumbs=["Prosp'Up", "Actus"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
        is_admin=(user.get("role") == "admin"),
    )


# ────────────────────────────────────────────────────────────────────
#  API — articles
# ────────────────────────────────────────────────────────────────────

@actus_bp.get("/api/actus/articles")
@login_required
def api_actus_articles():
    region = (request.args.get("region") or "national").strip()
    if region not in actus_svc.REGIONS:
        region = "national"
    try:
        limit = max(1, min(int(request.args.get("limit", 9)), 100))
    except ValueError:
        limit = 9
    with_image_only = (request.args.get("with_image") or "").lower() in ("1", "true", "yes")
    items = actus_svc.list_articles(region=region, limit=limit, with_image_only=with_image_only)
    return jsonify({"ok": True, "items": items, "count": len(items)})


# ────────────────────────────────────────────────────────────────────
#  API — jobs
# ────────────────────────────────────────────────────────────────────

@actus_bp.get("/api/actus/jobs")
@login_required
def api_actus_jobs():
    region = (request.args.get("region") or "national").strip()
    if region not in actus_svc.REGIONS:
        region = "national"
    q = (request.args.get("q") or "").strip()
    contract = [c.strip().upper() for c in (request.args.get("contract") or "").split(",") if c.strip()]
    sort = (request.args.get("sort") or "date").strip()
    try:
        limit = max(1, min(int(request.args.get("limit", 60)), 200))
    except ValueError:
        limit = 60
    try:
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        offset = 0
    items = actus_svc.list_jobs(
        region=region, q=q, contract=contract, sort=sort,
        limit=limit, offset=offset, owner_id=_uid(),
    )
    return jsonify({"ok": True, "items": items, "count": len(items)})


# ────────────────────────────────────────────────────────────────────
#  API — favoris
# ────────────────────────────────────────────────────────────────────

@actus_bp.get("/api/actus/jobs/crm")
@login_required
def api_actus_jobs_crm():
    """Retourne les offres dont l'entreprise correspond à une entreprise du
    CRM de l'utilisateur. Réponse enrichie : items + métadonnées de
    matching (companies_count, matched_count, total_companies)."""
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    region = (request.args.get("region") or "national").strip()
    if region not in actus_svc.REGIONS:
        region = "national"
    try:
        limit = max(1, min(int(request.args.get("limit", 30)), 100))
    except ValueError:
        limit = 30
    result = actus_svc.list_crm_jobs(owner_id=uid, region=region, limit=limit)
    return jsonify({"ok": True, **result})


@actus_bp.get("/api/actus/favoris")
@login_required
def api_actus_favoris_list():
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    items = actus_svc.list_favoris(owner_id=uid)
    return jsonify({"ok": True, "items": items, "count": len(items)})


@actus_bp.post("/api/actus/favoris")
@login_required
def api_actus_favoris_toggle():
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    payload = request.get_json(silent=True) or {}
    try:
        job_id = int(payload.get("job_id"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "job_id requis"}), 400
    result = actus_svc.toggle_favori(owner_id=uid, job_id=job_id)
    return jsonify({"ok": True, **result})


# ────────────────────────────────────────────────────────────────────
#  API — refresh manuel + status
# ────────────────────────────────────────────────────────────────────

@actus_bp.post("/api/actus/refresh")
@login_required
def api_actus_refresh():
    """Déclenche un refresh en background pour ne pas bloquer la requête
    HTTP (les flux RSS peuvent prendre plusieurs secondes)."""
    force = bool((request.get_json(silent=True) or {}).get("force"))

    def _run():
        try:
            actus_svc.refresh_all(force=force)
        except Exception as exc:  # pragma: no cover
            from app import logger
            logger.warning("Actus refresh manuel a échoué : %s", exc)

    threading.Thread(target=_run, daemon=True, name="actus_refresh").start()
    return jsonify({"ok": True, "started": True, "force": force})


@actus_bp.get("/api/actus/status")
@login_required
def api_actus_status():
    return jsonify({"ok": True, **actus_svc.status()})


# ────────────────────────────────────────────────────────────────────
#  API — config (région par défaut, admin only)
# ────────────────────────────────────────────────────────────────────

@actus_bp.get("/api/actus/config")
@login_required
def api_actus_config_get():
    """Retourne la config Actus (lecture seule pour tous)."""
    return jsonify({
        "ok": True,
        "default_region": actus_svc.get_default_region(),
        "regions": [{"id": rid, "label": r["label"]} for rid, r in actus_svc.REGIONS.items()],
    })


@actus_bp.post("/api/actus/config")
@login_required
@role_required('admin')
def api_actus_config_set():
    """Définit la région par défaut (admin only). Body JSON :
    `{default_region: "ara"}`."""
    payload = request.get_json(silent=True) or {}
    region = (payload.get("default_region") or "").strip()
    try:
        applied = actus_svc.set_default_region(region)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, "default_region": applied})
