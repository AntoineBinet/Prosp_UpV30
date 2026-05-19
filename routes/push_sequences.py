"""ProspUp — Blueprint Séquences Push (Phase 4 productivité v32.x).

Endpoints :
- GET    /api/push/sequences                                  — liste
- POST   /api/push/sequences                                  — création
- PUT    /api/push/sequences/<id>                             — update
- DELETE /api/push/sequences/<id>                             — delete (non-default)
- POST   /api/push/sequences/<id>/enroll                      — enroll {prospect_id}
- POST   /api/push/sequences/seed-defaults                    — crée les 3 par défaut
- GET    /api/push/sequences/due                              — étapes dues
- GET    /api/push/sequences/enrollments                      — liste enrollments
- POST   /api/push/sequences/enrollments/<id>/complete-step   — body {step_index}
- POST   /api/push/sequences/enrollments/<id>/pause           — body {reason?}
- POST   /api/push/sequences/enrollments/<id>/cancel
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from services.push_sequences import (
    auto_pause_replied,
    create_sequence,
    delete_sequence,
    enroll,
    evaluate_due_steps,
    get_sequence,
    list_enrollments,
    list_sequences,
    mark_step_complete,
    seed_default_sequences,
    update_enrollment_status,
    update_sequence,
)
from utils.auth import _uid

push_sequences_bp = Blueprint("push_sequences", __name__)


@push_sequences_bp.get("/api/push/sequences")
def api_sequences_list():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    # Seed automatique au premier accès si l'user n'a aucune séquence.
    seed_default_sequences(uid)
    return jsonify(ok=True, sequences=list_sequences(uid))


@push_sequences_bp.post("/api/push/sequences")
def api_sequences_create():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    try:
        sid = create_sequence(
            uid,
            name=payload.get("name") or "",
            description=payload.get("description") or "",
            steps=payload.get("steps") or [],
        )
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    return jsonify(ok=True, id=sid)


@push_sequences_bp.put("/api/push/sequences/<int:sid>")
def api_sequences_update(sid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    kwargs: dict = {}
    if "name" in payload:
        kwargs["name"] = payload["name"]
    if "description" in payload:
        kwargs["description"] = payload["description"]
    if "steps" in payload:
        kwargs["steps"] = payload["steps"]
    if "is_active" in payload:
        kwargs["is_active"] = bool(payload["is_active"])
    try:
        ok = update_sequence(uid, sid, **kwargs)
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    if not ok:
        return jsonify(ok=False, error="Séquence introuvable ou aucune modification"), 404
    return jsonify(ok=True)


@push_sequences_bp.delete("/api/push/sequences/<int:sid>")
def api_sequences_delete(sid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    seq = get_sequence(uid, sid)
    if not seq:
        return jsonify(ok=False, error="Séquence introuvable"), 404
    if seq.get("is_default"):
        return jsonify(ok=False, error="Impossible de supprimer une séquence par défaut"), 400
    ok = delete_sequence(uid, sid)
    return jsonify(ok=ok)


@push_sequences_bp.post("/api/push/sequences/<int:sid>/enroll")
def api_sequences_enroll(sid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    try:
        prospect_id = int(payload.get("prospect_id"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="prospect_id requis"), 400
    result = enroll(uid, prospect_id, sid)
    if not result.get("ok"):
        return jsonify(result), 400
    return jsonify(result)


@push_sequences_bp.post("/api/push/sequences/seed-defaults")
def api_sequences_seed_defaults():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    created = seed_default_sequences(uid)
    return jsonify(ok=True, created=created)


@push_sequences_bp.get("/api/push/sequences/due")
def api_sequences_due():
    """Étapes dues aujourd'hui (avec auto-pause préalable sur replied_at)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    paused = auto_pause_replied(uid)
    items = evaluate_due_steps(uid)
    return jsonify(ok=True, items=items, count=len(items), auto_paused=paused)


@push_sequences_bp.get("/api/push/sequences/enrollments")
def api_sequences_enrollments():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    status = (request.args.get("status") or "").strip() or None
    return jsonify(ok=True, enrollments=list_enrollments(uid, status=status))


@push_sequences_bp.post("/api/push/sequences/enrollments/<int:eid>/complete-step")
def api_sequences_complete_step(eid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    try:
        step_index = int(payload.get("step_index"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="step_index requis"), 400
    res = mark_step_complete(uid, eid, step_index)
    if not res.get("ok"):
        return jsonify(res), 400
    return jsonify(res)


@push_sequences_bp.post("/api/push/sequences/enrollments/<int:eid>/pause")
def api_sequences_pause(eid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    ok = update_enrollment_status(uid, eid, "paused", reason=payload.get("reason"))
    return jsonify(ok=ok)


@push_sequences_bp.post("/api/push/sequences/enrollments/<int:eid>/cancel")
def api_sequences_cancel(eid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    ok = update_enrollment_status(uid, eid, "cancelled")
    return jsonify(ok=ok)
