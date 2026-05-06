"""ProspUp — Blueprint Admin & Misc.

Routes diverses : focus_queue, snapshots admin, backups, reset DB,
views (saved filters), rapport hebdo PDF, tasks (CRUD + rules + auto-tasks),
company merge."""
from __future__ import annotations

import datetime
import io
import json
import os
import re
from io import BytesIO
from pathlib import Path

from flask import Blueprint, Response, jsonify, request, send_file

from app import _audit_log, _create_auto_task, log_activity, logger
from config import APP_DIR, DATA_DIR
from utils.auth import _company_owned, _prospect_owned, _uid, login_required, role_required
from utils.common import _now_iso, _today_iso
from utils.db import _conn

admin_bp = Blueprint("admin", __name__)


@admin_bp.get("/api/focus_queue")
def api_focus_queue():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    today = _today_iso()
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    with _conn() as conn:
        rows = conn.execute(
            '''
            SELECT p.*, c.groupe AS company_groupe, c.site AS company_site
            FROM prospects p
            LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id=?
            WHERE p.owner_id=? AND p.nextFollowUp IS NOT NULL AND p.nextFollowUp != ''
            ORDER BY 
                CASE 
                    WHEN p.nextFollowUp <= ? THEN 0
                    WHEN p.nextFollowUp = ? THEN 1
                    ELSE 2
                END,
                COALESCE(p.priority, 2) ASC,
                p.nextFollowUp ASC,
                p.id DESC
            LIMIT 200;
            ''',
            (uid, uid, today, tomorrow),
        ).fetchall()
    return jsonify({"ok": True, "items": [dict(r) for r in rows]})


# ====== Snapshots API ======
@admin_bp.get("/api/snapshots")
def api_snapshots_list():
    return jsonify({"ok": True, "items": list_snapshots()})


@admin_bp.post("/api/snapshots/create")
@login_required
@role_required('admin')
def api_snapshots_create():
    chk = _require_same_origin()
    if chk:
        return chk
    payload = request.get_json(force=True, silent=False) or {}
    label = (payload.get("label") or "manual").strip() or "manual"
    try:
        fn = create_snapshot(label=label, is_auto=False)
        return jsonify({"ok": True, "filename": fn})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@admin_bp.post("/api/snapshots/restore")
@login_required
@role_required('admin')
def api_snapshots_restore():
    chk = _require_same_origin()
    if chk:
        return chk
    payload = request.get_json(force=True, silent=False) or {}
    fn = (payload.get("filename") or "").strip()
    if not fn:
        return jsonify({"ok": False, "error": "filename is required"}), 400
    try:
        # validation anti path traversal
        _snapshot_path(fn)
    except Exception:
        return jsonify({"ok": False, "error": "invalid filename"}), 400
    try:
        restore_snapshot(fn)
        return jsonify({"ok": True})
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "snapshot not found"}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@admin_bp.post("/api/snapshots/delete")
@login_required
@role_required('admin')
def api_snapshots_delete():
    chk = _require_same_origin()
    if chk:
        return chk
    payload = request.get_json(force=True, silent=False) or {}
    fn = (payload.get("filename") or "").strip()
    if not fn:
        return jsonify({"ok": False, "error": "filename is required"}), 400
    try:
        p = _snapshot_path(fn)
    except Exception:
        return jsonify({"ok": False, "error": "invalid filename"}), 400
    try:
        if p.exists():
            p.unlink()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ====== Backups automatiques API ======
@admin_bp.get("/api/admin/backups")
@login_required
@role_required('admin')
def api_admin_backups_list():
    from backup import list_backups
    return jsonify(ok=True, backups=list_backups())


@admin_bp.post("/api/admin/backup/trigger")
@login_required
@role_required('admin')
def api_admin_backup_trigger():
    chk = _require_same_origin()
    if chk:
        return chk
    from backup import create_backup
    path = create_backup()
    if path:
        logger.info("Backup manuel déclenché par %s : %s", session.get('user_id'), path)
        return jsonify(ok=True, path=path)
    return jsonify(ok=False, error="Échec du backup — voir les logs serveur"), 500


# ====== Reset (factory) API ======
@admin_bp.post("/api/reset")
@login_required
@role_required('admin')
def api_reset():
    """Reset the whole database to the initial seed (dangerous)."""
    chk = _require_same_origin()
    if chk:
        return chk
    # snapshot safety
    try:
        create_snapshot(label="before_reset", is_auto=False)
    except Exception:
        pass

    # rebuild DB file
    try:
        if DB_PATH.exists():
            DB_PATH.unlink()
    except Exception as e:
        return jsonify({"ok": False, "error": f"cannot delete db: {e}"}), 500

    try:
        init_db()
        seed_info = seed_from_initial()
        return jsonify({"ok": True, "seed": seed_info})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ====== Export / Import ======
# Routes /api/push-logs/* + /api/push-campaigns/* + /api/push/track* + /api/push/optimal-time + /api/push/analytics — voir routes/push_logs.py
# ====== Saved Views API (v6) ======
@admin_bp.get("/api/views")
def api_views_list():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    page = (request.args.get("page") or "prospects").strip().lower()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, page, name, state, createdAt, updatedAt FROM saved_views WHERE page=? AND owner_id=? ORDER BY updatedAt DESC, id DESC;",
            (page, uid),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["state"] = json.loads(d.get("state") or "{}")
        except Exception:
            d["state"] = {}
        out.append(d)
    return jsonify(out)

@admin_bp.post("/api/views/save")
def api_views_save():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    page = (payload.get("page") or "prospects").strip().lower()
    name = (payload.get("name") or "").strip()
    state = payload.get("state") or {}
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400
    now = _now_iso()
    state_json = json.dumps(state, ensure_ascii=False)
    vid = payload.get("id")
    with _conn() as conn:
        cur = conn.cursor()
        if vid:
            cur.execute(
                "UPDATE saved_views SET name=?, state=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (name, state_json, now, int(vid), uid),
            )
            if cur.rowcount == 0:
                vid = None
        if not vid:
            cur.execute(
                "INSERT INTO saved_views (page, name, state, createdAt, updatedAt, owner_id) VALUES (?, ?, ?, ?, ?, ?);",
                (page, name, state_json, now, now, uid),
            )
            vid = cur.lastrowid
    return jsonify({"ok": True, "id": vid})

@admin_bp.post("/api/views/delete")
def api_views_delete():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    vid = payload.get("id")
    if not vid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    with _conn() as conn:
        conn.execute("DELETE FROM saved_views WHERE id=? AND owner_id=?;", (int(vid), uid))
    return jsonify({"ok": True})


# ════════════════════════════════════════════════════════════
# v30 — Rapport : export PDF
# ════════════════════════════════════════════════════════════

@admin_bp.post("/api/rapport/export-pdf")
@login_required
def api_rapport_export_pdf():
    """Convertit le markdown du rapport v30 en PDF via ReportLab.

    Payload : { week, html, markdown }
    Retourne : application/pdf (attachment).
    """
    err = _require_same_origin()
    if err:
        return err
    payload = request.get_json(force=True, silent=True) or {}
    week = (payload.get("week") or "").strip() or datetime.date.today().isoformat()
    markdown_src = payload.get("markdown") or ""
    if not markdown_src.strip():
        return jsonify(ok=False, error="markdown is required"), 400

    from io import BytesIO
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=1.8 * cm, leftMargin=1.8 * cm,
        topMargin=1.6 * cm, bottomMargin=1.6 * cm,
    )
    styles = getSampleStyleSheet()

    def S(name, parent="Normal", **kw):
        return ParagraphStyle(name, parent=styles[parent], **kw)

    NAVY = colors.HexColor("#1A1A2E")
    ACCENT = colors.HexColor("#6366F1")
    MUTED = colors.HexColor("#6B7280")
    sTitle = S("RapTitle", fontName="Helvetica-Bold", fontSize=18,
               textColor=NAVY, spaceAfter=6, leading=22)
    sSub = S("RapSub", fontName="Helvetica-Oblique", fontSize=10,
             textColor=MUTED, spaceAfter=16, leading=14)
    sH2 = S("RapH2", fontName="Helvetica-Bold", fontSize=13,
            textColor=NAVY, spaceBefore=12, spaceAfter=4, leading=16)
    sBody = S("RapBody", fontName="Helvetica", fontSize=10.5,
              textColor=colors.black, spaceAfter=4, leading=14, alignment=4)
    sBullet = S("RapBullet", fontName="Helvetica", fontSize=10,
                textColor=colors.black, spaceAfter=2, leading=13, leftIndent=12)

    story = []
    # Parse markdown simple : #/##/### en titres, - en bullets, blanc en paragraphe
    lines = markdown_src.splitlines()
    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            story.append(Spacer(1, 6))
            continue
        if line.startswith("# "):
            txt = line[2:].strip()
            story.append(Paragraph(txt, sTitle))
            story.append(HRFlowable(width="100%", thickness=0.5, color=ACCENT, spaceAfter=8))
        elif line.startswith("## "):
            story.append(Paragraph(line[3:].strip(), sH2))
        elif line.startswith("### "):
            story.append(Paragraph(line[4:].strip(), sH2))
        elif line.strip().startswith("- ") or line.strip().startswith("* "):
            story.append(Paragraph("• " + line.strip()[2:], sBullet))
        elif line.startswith("*") and line.endswith("*") and len(line) > 2:
            story.append(Paragraph(line.strip("*"), sSub))
        else:
            safe = line.replace("<", "&lt;").replace(">", "&gt;")
            story.append(Paragraph(safe, sBody))

    try:
        doc.build(story)
    except Exception as e:
        logger.exception("export-pdf build failed: %s", e)
        return jsonify(ok=False, error=str(e)), 500

    buffer.seek(0)
    from flask import send_file
    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"rapport-{week}.pdf",
    )


# v30 — REST delete (miroir de /api/views/delete POST body)
@admin_bp.delete("/api/views/<int:vid>")
def api_views_delete_rest(vid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    with _conn() as conn:
        cur = conn.execute("DELETE FROM saved_views WHERE id=? AND owner_id=?;", (vid, uid))
        deleted = cur.rowcount
    return jsonify(ok=True, deleted=deleted)


# ====== Tasks / To-Do API (v19) ======

@admin_bp.get("/api/tasks")
@login_required
def api_tasks_list():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    status = (request.args.get("status") or "pending").strip().lower()
    with _conn() as conn:
        if status == "all":
            rows = conn.execute(
                "SELECT * FROM tasks WHERE owner_id=? ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, id DESC;",
                (uid,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE status=? AND owner_id=? ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, id DESC;",
                (status, uid),
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["linked_ids"] = json.loads(d.get("linked_ids") or "{}")
        except Exception:
            d["linked_ids"] = {}
        out.append(d)
    return jsonify({"ok": True, "tasks": out})


@admin_bp.post("/api/tasks/save")
@login_required
@role_required("editor")
def api_tasks_save():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload, err = validate_payload({'title': str})
    if err:
        return err
    title = (payload.get("title") or "").strip()
    if not title:
        return jsonify({"ok": False, "error": "title is required"}), 400
    comment = (payload.get("comment") or "").strip()
    due_date = (payload.get("due_date") or "").strip() or None
    linked_ids = payload.get("linked_ids") or {}
    linked_json = json.dumps(linked_ids, ensure_ascii=False)
    now = _now_iso()
    tid = payload.get("id")
    with _conn() as conn:
        cur = conn.cursor()
        if tid:
            cur.execute(
                "UPDATE tasks SET title=?, comment=?, due_date=?, linked_ids=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (title, comment, due_date, linked_json, now, int(tid), uid),
            )
            if cur.rowcount == 0:
                tid = None
        if not tid:
            cur.execute(
                "INSERT INTO tasks (title, comment, due_date, status, linked_ids, createdAt, updatedAt, owner_id) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?);",
                (title, comment, due_date, linked_json, now, now, uid),
            )
            tid = cur.lastrowid
            # Teams webhook: new task (v22.1)
            try:
                prefix = _get_user_prefix(uid)
                card = _build_adaptive_card(
                    "Nouvelle tâche",
                    [("Titre", title), ("Échéance", due_date or "—"), ("Commentaire", (comment or "—")[:150]), ("Consultant", prefix)],
                    [{"title": "Ouvrir Focus", "url": "https://prospup.work/focus"}]
                )
                _send_teams_webhook(card, "task_created")
            except Exception:
                pass
    return jsonify({"ok": True, "id": tid})


@admin_bp.post("/api/tasks/done")
@login_required
@role_required("editor")
def api_tasks_done():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    tid = payload.get("id")
    if not tid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    new_status = payload.get("status", "done")
    if new_status not in ("done", "pending"):
        new_status = "done"
    now = _now_iso()
    with _conn() as conn:
        conn.execute("UPDATE tasks SET status=?, updatedAt=? WHERE id=? AND owner_id=?;", (new_status, now, int(tid), uid))
    return jsonify({"ok": True})


@admin_bp.post("/api/tasks/delete")
@login_required
@role_required("editor")
def api_tasks_delete():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    tid = payload.get("id")
    if not tid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    with _conn() as conn:
        conn.execute("DELETE FROM tasks WHERE id=? AND owner_id=?;", (int(tid), uid))
    return jsonify({"ok": True})


# ====== Task Rules API (v26.6) ======
@admin_bp.get("/api/tasks/rules")
@login_required
def api_tasks_rules_list():
    """Lister les règles de création automatique de tâches."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM task_rules WHERE owner_id=? OR owner_id IS NULL ORDER BY name;",
            (uid,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["conditions"] = json.loads(d.get("conditions") or "{}")
        except Exception:
            d["conditions"] = {}
        d["enabled"] = bool(d.get("enabled"))
        out.append(d)
    return jsonify({"ok": True, "rules": out})


@admin_bp.post("/api/tasks/rules")
@login_required
@role_required("admin")
def api_tasks_rules_save():
    """Créer ou modifier une règle de création automatique de tâches (admin uniquement)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    trigger_type = (payload.get("trigger_type") or "").strip()
    template_title = (payload.get("template_title") or "").strip()
    
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400
    if not trigger_type:
        return jsonify({"ok": False, "error": "trigger_type is required"}), 400
    if not template_title:
        return jsonify({"ok": False, "error": "template_title is required"}), 400
    
    if trigger_type not in ("prospect_created", "status_changed", "meeting_done", "daily_check"):
        return jsonify({"ok": False, "error": "trigger_type invalide"}), 400
    
    conditions = payload.get("conditions") or {}
    template_comment = (payload.get("template_comment") or "").strip()
    priority = int(payload.get("priority") or 2)
    enabled = 1 if payload.get("enabled") else 0
    
    conditions_json = json.dumps(conditions, ensure_ascii=False)
    now = _now_iso()
    rule_id = payload.get("id")
    
    with _conn() as conn:
        if rule_id:
            # Mise à jour
            conn.execute(
                "UPDATE task_rules SET name=?, trigger_type=?, conditions=?, template_title=?, template_comment=?, priority=?, enabled=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (name, trigger_type, conditions_json, template_title, template_comment, priority, enabled, now, int(rule_id), uid)
            )
        else:
            # Création
            cursor = conn.execute(
                "INSERT INTO task_rules (name, trigger_type, conditions, template_title, template_comment, priority, enabled, owner_id, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                (name, trigger_type, conditions_json, template_title, template_comment, priority, enabled, uid, now, now)
            )
            rule_id = cursor.lastrowid
    
    return jsonify({"ok": True, "id": rule_id})


@admin_bp.post("/api/tasks/rules/delete")
@login_required
@role_required("admin")
def api_tasks_rules_delete():
    """Supprimer une règle de création automatique de tâches (admin uniquement)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    rule_id = payload.get("id")
    if not rule_id:
        return jsonify({"ok": False, "error": "id is required"}), 400
    with _conn() as conn:
        conn.execute("DELETE FROM task_rules WHERE id=? AND owner_id=?;", (int(rule_id), uid))
    return jsonify({"ok": True})


@admin_bp.post("/api/tasks/daily-check")
@login_required
def api_tasks_daily_check():
    """Vérification quotidienne : crée des tâches automatiques pour les prospects avec nextFollowUp dans les prochains jours."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    days_ahead = request.args.get("days", type=int) or 2  # Par défaut: 2 jours
    
    today = datetime.date.today()
    target_date = today + datetime.timedelta(days=days_ahead)
    
    created_count = 0
    
    with _conn() as conn:
        # Récupérer les prospects avec nextFollowUp dans la fenêtre
        prospects = conn.execute(
            """
            SELECT p.*, c.groupe AS company_groupe
            FROM prospects p
            LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = ?
            WHERE p.owner_id = ?
              AND p.nextFollowUp IS NOT NULL
              AND p.nextFollowUp != ''
              AND DATE(p.nextFollowUp) BETWEEN ? AND ?
              AND p.deleted_at IS NULL
            """,
            (uid, uid, today.isoformat(), target_date.isoformat())
        ).fetchall()
        
        for p_row in prospects:
            p = dict(p_row)
            try:
                context = {
                    "prospect_id": p["id"],
                    "name": p.get("name") or "",
                    "email": p.get("email"),
                    "telephone": p.get("telephone"),
                    "linkedin": p.get("linkedin"),
                    "statut": p.get("statut"),
                    "pertinence": p.get("pertinence"),
                    "nextFollowUp": p.get("nextFollowUp"),
                    "company_id": p.get("company_id"),
                    "company_groupe": p.get("company_groupe") or "",
                }
                
                # Calculer le nombre de jours jusqu'à nextFollowUp
                try:
                    follow_date = datetime.datetime.fromisoformat(
                        context["nextFollowUp"].replace("Z", "+00:00")[:10]
                    ).date()
                    days_diff = (follow_date - today).days
                    context["nextFollowUp_days"] = days_diff
                except Exception:
                    context["nextFollowUp_days"] = 0
                
                # Vérifier si une tâche existe déjà pour ce prospect et cette date
                existing = conn.execute(
                    """
                    SELECT id FROM tasks
                    WHERE owner_id = ?
                      AND status = 'pending'
                      AND json_extract(linked_ids, '$.prospect_id') = ?
                      AND due_date = ?
                    LIMIT 1
                    """,
                    (uid, context["prospect_id"], context["nextFollowUp"][:10])
                ).fetchone()
                
                if not existing:
                    # Créer la tâche via les règles
                    _create_auto_task("daily_check", context)
                    created_count += 1
            except Exception as e:
                logger.warning("Erreur vérification quotidienne pour prospect %s: %s", p.get("id"), e)
    
    return jsonify({"ok": True, "created": created_count, "checked": len(prospects)})


@admin_bp.get("/api/tasks/optimize")
@login_required
def api_tasks_optimize():
    """Retourne les tâches triées de manière optimale (planification intelligente)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    status = (request.args.get("status") or "pending").strip().lower()
    with _conn() as conn:
        if status == "all":
            rows = conn.execute(
                "SELECT * FROM tasks WHERE owner_id=? ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, id DESC;",
                (uid,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE status=? AND owner_id=? ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, id DESC;",
                (status, uid),
            ).fetchall()
    
    tasks = []
    for r in rows:
        d = dict(r)
        try:
            d["linked_ids"] = json.loads(d.get("linked_ids") or "{}")
        except Exception:
            d["linked_ids"] = {}
        tasks.append(d)
    
    # Optimiser l'ordre
    optimized = _optimize_task_schedule(tasks)
    
    return jsonify({"ok": True, "tasks": optimized})

