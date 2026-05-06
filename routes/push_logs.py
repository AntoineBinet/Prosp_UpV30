"""ProspUp — Blueprint Push-logs (logs envois, campagnes, tracking, analytics).

Inclut les helpers `_recompute_last_push_dates`, `_campaign_row_to_dict` et
`_apply_campaign_filters` qui ne sont utilisés que par ces routes.
"""
from __future__ import annotations

import datetime
import io
import json
import re
import sqlite3
from io import BytesIO
from typing import Any, Dict, List

from flask import Blueprint, Response, jsonify, request, send_file
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment

from app import _audit_log, log_activity, logger
from utils.auth import _prospect_owned, _require_same_origin, _uid
from utils.common import _now_iso, _today_iso
from utils.db import _auth_conn, _conn
from utils.validation import _check_table_exists, _safe_execute_insert, _safe_execute_update, _validate_positive_int

push_logs_bp = Blueprint("push_logs", __name__)


@push_logs_bp.get("/api/push-logs/export.xlsx")
def api_export_push_logs_xlsx():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    from openpyxl import Workbook

    with _conn() as conn:
        rows = conn.execute(
            '''
            SELECT l.id, l.sentAt, l.channel, l.to_email, l.subject, l.template_name,
                   p.name AS prospect_name, p.email AS prospect_email,
                   c.groupe AS company_groupe, c.site AS company_site
            FROM push_logs l
            JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=?
            LEFT JOIN companies c ON c.id = p.company_id
            ORDER BY l.id DESC;
            ''',
            (uid,),
        ).fetchall()

    wb = Workbook()
    ws = wb.active
    ws.title = "push_logs"
    headers = ["id", "sentAt", "channel", "to_email", "subject", "template_name", "prospect_name", "prospect_email", "company_groupe", "company_site"]
    ws.append(headers)
    for r in rows:
        d = dict(r)
        row_values = []
        for h in headers:
            v = d.get(h)
            if isinstance(v, str):
                v = v.replace("\r\n", "\n").replace("\r", "\n")
            row_values.append(v)
        ws.append(row_values)

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)
    filename = f"Push_logs_{_today_iso()}.xlsx"
    return send_file(
        bio,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def _csv_cell(v):
    """Normalise une valeur pour export CSV : pas de sauts de ligne pour éviter décalage."""
    if v is None:
        return ""
    s = str(v).strip().replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
    return s


@push_logs_bp.get("/api/candidates/export.csv")
def api_export_candidates_csv():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM candidates WHERE owner_id=? AND deleted_at IS NULL ORDER BY id DESC;", (uid,)).fetchall()
    output = BytesIO()
    import io
    text_io = io.TextIOWrapper(output, encoding="utf-8", newline="")
    writer = csv.writer(text_io)
    headers = ["id","name","role","location","seniority","tech","linkedin","source","status","notes","createdAt","updatedAt"]
    writer.writerow(headers)
    for r in rows:
        d = dict(r)
        writer.writerow([_csv_cell(d.get(h)) for h in headers])
    text_io.flush()
    output.seek(0)
    filename = f"Candidates_{_today_iso()}.csv"
    return send_file(output, as_attachment=True, download_name=filename, mimetype="text/csv")


# ====== Push logs API ======
@push_logs_bp.get("/api/push-logs")
def api_push_logs_list():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute(
            '''
            SELECT
                l.id,
                l.prospect_id,
                l.sentAt,
                l.channel,
                l.to_email,
                l.subject,
                l.body,
                l.template_id,
                l.template_name,
                l.createdAt,
                l.consultant1_id,
                l.consultant2_id,
                p.name AS prospect_name,
                p.email AS prospect_email,
                c.groupe AS company_groupe,
                c.site AS company_site
            FROM push_logs l
            JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=?
            LEFT JOIN companies c ON c.id = p.company_id
            ORDER BY l.id DESC;
            ''',
            (uid,),
        ).fetchall()
    logs = [dict(r) for r in rows]
    # Enrichir consultant1/2_name depuis la main DB (table users)
    consultant_ids = {r["consultant1_id"] for r in logs if r.get("consultant1_id")} \
                     | {r["consultant2_id"] for r in logs if r.get("consultant2_id")}
    names_by_id = {}
    if consultant_ids:
        try:
            with _auth_conn() as auth:
                rows_u = auth.execute(
                    "SELECT id, username, display_name FROM users WHERE id IN ({});".format(
                        ",".join("?" * len(consultant_ids))
                    ),
                    tuple(consultant_ids),
                ).fetchall()
                names_by_id = {u["id"]: (u["display_name"] or u["username"]) for u in rows_u}
        except Exception as e:
            logger.warning("push-logs consultants enrichment: %s", e)
    for r in logs:
        r["consultant1_name"] = names_by_id.get(r.get("consultant1_id"))
        r["consultant2_name"] = names_by_id.get(r.get("consultant2_id"))
    return jsonify(logs)


@push_logs_bp.post("/api/push-logs/add")
def api_push_logs_add():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    prospect_id = payload.get("prospect_id")
    sent_at = (payload.get("sentAt") or "").strip()
    if not prospect_id or not sent_at:
        return jsonify({"ok": False, "error": "prospect_id and sentAt are required"}), 400

    channel = (payload.get("channel") or "email").strip().lower() or "email"
    if channel not in ("email", "linkedin", "other"):
        channel = "email"

    to_email = (payload.get("to_email") or "").strip() or None
    subject = (payload.get("subject") or "").strip() or None
    body = payload.get("body")
    if body is not None:
        body = str(body)

    template_id = payload.get("template_id")
    template_name = (payload.get("template_name") or "").strip() or None
    try:
        template_id = int(template_id) if template_id not in (None, "", "null") else None
    except Exception:
        template_id = None

    # v25.3: Candidats et consultants pour traçabilité
    candidate_id1 = payload.get("candidate_id1")
    candidate_id2 = payload.get("candidate_id2")
    consultant1_id = payload.get("consultant1_id")
    consultant2_id = payload.get("consultant2_id")
    try:
        candidate_id1 = int(candidate_id1) if candidate_id1 not in (None, "", "null") else None
    except Exception:
        candidate_id1 = None
    try:
        candidate_id2 = int(candidate_id2) if candidate_id2 not in (None, "", "null") else None
    except Exception:
        candidate_id2 = None
    try:
        consultant1_id = int(consultant1_id) if consultant1_id not in (None, "", "null") else None
    except Exception:
        consultant1_id = None
    try:
        consultant2_id = int(consultant2_id) if consultant2_id not in (None, "", "null") else None
    except Exception:
        consultant2_id = None

    now = datetime.datetime.now().isoformat(timespec="seconds")

    # v26.6: Calculer timing et générer tracking_pixel_id
    try:
        sent_dt = datetime.datetime.fromisoformat(sent_at.replace('Z', '+00:00') if 'Z' in sent_at else sent_at)
        sent_at_hour = sent_dt.hour
        sent_at_day_of_week = sent_dt.weekday()  # 0=lundi, 6=dimanche
    except Exception:
        # Fallback sur maintenant si parsing échoue
        sent_dt = datetime.datetime.now()
        sent_at_hour = sent_dt.hour
        sent_at_day_of_week = sent_dt.weekday()

    variant_id = (payload.get("variant_id") or "").strip() or None
    tracking_pixel_id = str(_uuid.uuid4()) if channel == "email" else None

    # Récupérer les variantes si fournies
    variants = payload.get("variants", [])
    if not isinstance(variants, list):
        variants = []

    with _conn() as conn:
        # Validation prospect_id
        try:
            prospect_id_int = _validate_positive_int(prospect_id, "prospect_id")
        except ValueError as e:
            return jsonify({"ok": False, "error": str(e)}), 400
        
        # ensure prospect exists
        p = conn.execute("SELECT id, name FROM prospects WHERE id=? AND owner_id=?;", (prospect_id_int, uid)).fetchone()
        if not p:
            return jsonify({"ok": False, "error": "prospect not found"}), 404

        # Insertion push_logs avec gestion d'erreur
        try:
            push_log_id = _safe_execute_insert(
                conn,
                '''
                INSERT INTO push_logs (prospect_id, sentAt, channel, to_email, subject, body, template_id, template_name, candidate_id1, candidate_id2, consultant1_id, consultant2_id, sent_at_hour, sent_at_day_of_week, variant_id, tracking_pixel_id, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                ''',
                (prospect_id_int, sent_at, channel, to_email, subject, body, template_id, template_name, candidate_id1, candidate_id2, consultant1_id, consultant2_id, sent_at_hour, sent_at_day_of_week, variant_id, tracking_pixel_id, now),
            )
        except Exception as e:
            logger.error("Erreur insertion push_logs: %s", e)
            return jsonify({"ok": False, "error": "Erreur lors de l'enregistrement du log"}), 500

        # Enregistrer les variantes A/B si fournies
        if variants:
            # Vérifier que la table push_variants existe
            if not _check_table_exists(conn, "push_variants"):
                logger.warning("Table push_variants n'existe pas, ignorons les variantes")
            else:
                for variant in variants:
                    if isinstance(variant, dict) and variant.get("variant_id") and variant.get("subject") is not None:
                        try:
                            _safe_execute_insert(
                                conn,
                                '''
                                INSERT INTO push_variants (push_log_id, variant_id, subject, body, sent_at, createdAt)
                                VALUES (?, ?, ?, ?, ?, ?);
                                ''',
                                (push_log_id, variant["variant_id"], variant.get("subject"), variant.get("body"), sent_at, now),
                            )
                        except Exception as e:
                            logger.warning("Erreur insertion variante %s: %s", variant.get("variant_id"), e)
                            # Continue avec les autres variantes

        # Update denormalized fields on prospect for quick UI
        if channel == "email":
            conn.execute("UPDATE prospects SET pushEmailSentAt=? WHERE id=? AND owner_id=?;", (sent_at, int(prospect_id), uid))
        elif channel == "linkedin":
            # column added via migration
            try:
                conn.execute("UPDATE prospects SET pushLinkedInSentAt=? WHERE id=? AND owner_id=?;", (sent_at, int(prospect_id), uid))
            except sqlite3.OperationalError as e:
                logger.warning("pushLinkedInSentAt column missing: %s", e)

    log_activity('send_push', 'prospect', int(prospect_id), p["name"] if p else None, {'channel': channel})
    return jsonify({"ok": True, "push_log_id": push_log_id, "tracking_pixel_id": tracking_pixel_id})


def _recompute_last_push_dates(conn: sqlite3.Connection, prospect_id: int) -> Dict[str, str]:
    """Recompute denormalized push*SentAt fields from push_logs."""
    out = {"pushEmailSentAt": "", "pushLinkedInSentAt": ""}
    row = conn.execute(
        "SELECT sentAt FROM push_logs WHERE prospect_id=? AND (channel IS NULL OR lower(channel)='email') ORDER BY id DESC LIMIT 1;",
        (prospect_id,),
    ).fetchone()
    if row and row["sentAt"]:
        out["pushEmailSentAt"] = str(row["sentAt"])
    row = conn.execute(
        "SELECT sentAt FROM push_logs WHERE prospect_id=? AND lower(channel)='linkedin' ORDER BY id DESC LIMIT 1;",
        (prospect_id,),
    ).fetchone()
    if row and row["sentAt"]:
        out["pushLinkedInSentAt"] = str(row["sentAt"])

    # update prospects table if columns exist (v23.4: scope by owner_id for safety)
    uid = _uid()
    if uid:
        conn.execute("UPDATE prospects SET pushEmailSentAt=? WHERE id=? AND owner_id=?;", (out["pushEmailSentAt"], prospect_id, uid))
        try:
            conn.execute("UPDATE prospects SET pushLinkedInSentAt=? WHERE id=? AND owner_id=?;", (out["pushLinkedInSentAt"], prospect_id, uid))
        except sqlite3.OperationalError as e:
            logger.warning("pushLinkedInSentAt column missing: %s", e)
    else:
        conn.execute("UPDATE prospects SET pushEmailSentAt=? WHERE id=?;", (out["pushEmailSentAt"], prospect_id))
        try:
            conn.execute("UPDATE prospects SET pushLinkedInSentAt=? WHERE id=?;", (out["pushLinkedInSentAt"], prospect_id))
        except sqlite3.OperationalError as e:
            logger.warning("pushLinkedInSentAt column missing: %s", e)
    return out

@push_logs_bp.post("/api/push-logs/undo_last")
def api_push_logs_undo_last():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    prospect_id = payload.get("prospect_id")
    channel = (payload.get("channel") or "").strip().lower() or None
    if not prospect_id:
        return jsonify({"ok": False, "error": "prospect_id is required"}), 400
    if not _prospect_owned(int(prospect_id)):
        return jsonify(ok=False, error="Accès refusé"), 403

    with _conn() as conn:
        if channel in ("email", "linkedin", "other"):
            row = conn.execute(
                "SELECT id FROM push_logs WHERE prospect_id=? AND lower(COALESCE(channel,'email'))=? ORDER BY id DESC LIMIT 1;",
                (int(prospect_id), channel),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM push_logs WHERE prospect_id=? ORDER BY id DESC LIMIT 1;",
                (int(prospect_id),),
            ).fetchone()

        deleted_id = None
        if row:
            deleted_id = int(row["id"])
            conn.execute("DELETE FROM push_logs WHERE id=?;", (deleted_id,))

        # Recompute last push dates (email/linkedin)
        updated = _recompute_last_push_dates(conn, int(prospect_id))
    return jsonify({"ok": True, "deleted": deleted_id, "updated": updated})

@push_logs_bp.post("/api/push-logs/delete")
def api_push_logs_delete():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    log_id = payload.get("id")
    if not log_id:
        return jsonify({"ok": False, "error": "id is required"}), 400

    # Validation log_id
    try:
        log_id_int = _validate_positive_int(log_id, "id")
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    with _conn() as conn:
        row = conn.execute("SELECT prospect_id FROM push_logs WHERE id=?;", (log_id_int,)).fetchone()
        if not row:
            return jsonify(ok=True)
        
        # Gérer le cas où prospect_id est None
        prospect_id = row.get("prospect_id") if row else None
        if prospect_id is None:
            # Si pas de prospect_id, on peut quand même supprimer le log
            conn.execute("DELETE FROM push_logs WHERE id=?;", (log_id_int,))
            return jsonify({"ok": True})
        
        # Vérifier l'ownership
        try:
            prospect_id_int = int(prospect_id)
            if not _prospect_owned(prospect_id_int):
                return jsonify(ok=False, error="Accès refusé"), 403
        except (ValueError, TypeError):
            logger.warning("prospect_id invalide dans push_logs: %s", prospect_id)
            conn.execute("DELETE FROM push_logs WHERE id=?;", (log_id_int,))
            return jsonify({"ok": True})
        
        conn.execute("DELETE FROM push_logs WHERE id=?;", (log_id_int,))
        _recompute_last_push_dates(conn, prospect_id_int)
    return jsonify({"ok": True})


# ════════════════════════════════════════════════════════════
# v30 — Push campaigns (brouillon + audience + envoi)
# ════════════════════════════════════════════════════════════

def _campaign_row_to_dict(row) -> dict:
    d = dict(row)
    for k in ("filters_json", "stats_json"):
        raw = d.get(k)
        if raw:
            try:
                d[k[:-5]] = json.loads(raw) if isinstance(raw, str) else raw
            except Exception:
                d[k[:-5]] = None
        else:
            d[k[:-5]] = None
    return d


@push_logs_bp.get("/api/push-campaigns")
def api_push_campaigns_list():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM push_campaigns WHERE owner_id=? ORDER BY id DESC;",
            (uid,),
        ).fetchall()
    return jsonify([_campaign_row_to_dict(r) for r in rows])


@push_logs_bp.post("/api/push-campaigns")
def api_push_campaigns_create():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip() or "Campagne sans nom"
    category_id = payload.get("category_id")
    template_id = payload.get("template_id")
    filters = payload.get("filters")
    scheduled_at = payload.get("scheduled_at")
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO push_campaigns (owner_id, name, category_id, template_id, "
            "filters_json, scheduled_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?);",
            (uid, name,
             int(category_id) if category_id else None,
             int(template_id) if template_id else None,
             json.dumps(filters) if filters else None,
             scheduled_at, now, now),
        )
        cid = cur.lastrowid
        row = conn.execute("SELECT * FROM push_campaigns WHERE id=?;", (cid,)).fetchone()
    return jsonify(ok=True, campaign=_campaign_row_to_dict(row))


@push_logs_bp.put("/api/push-campaigns/<int:cid>")
def api_push_campaigns_update(cid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    payload = request.get_json(force=True, silent=True) or {}
    fields = []
    params: list = []
    if "name" in payload:
        fields.append("name=?"); params.append((payload["name"] or "").strip())
    if "category_id" in payload:
        fields.append("category_id=?"); params.append(payload["category_id"] or None)
    if "template_id" in payload:
        fields.append("template_id=?"); params.append(payload["template_id"] or None)
    if "filters" in payload:
        fields.append("filters_json=?"); params.append(json.dumps(payload["filters"]) if payload["filters"] else None)
    if "scheduled_at" in payload:
        fields.append("scheduled_at=?"); params.append(payload["scheduled_at"])
    if not fields:
        return jsonify(ok=False, error="Aucun champ à mettre à jour"), 400
    fields.append("updated_at=?")
    params.append(datetime.datetime.now().isoformat(timespec="seconds"))
    params.extend([cid, uid])
    with _conn() as conn:
        conn.execute(
            f"UPDATE push_campaigns SET {', '.join(fields)} WHERE id=? AND owner_id=?;",
            params,
        )
        row = conn.execute(
            "SELECT * FROM push_campaigns WHERE id=? AND owner_id=?;", (cid, uid)
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Campagne introuvable"), 404
    return jsonify(ok=True, campaign=_campaign_row_to_dict(row))


@push_logs_bp.delete("/api/push-campaigns/<int:cid>")
def api_push_campaigns_delete(cid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    with _conn() as conn:
        cur = conn.execute(
            "DELETE FROM push_campaigns WHERE id=? AND owner_id=?;", (cid, uid)
        )
        deleted = cur.rowcount
    return jsonify(ok=True, deleted=deleted)


def _apply_campaign_filters(conn, uid: int, filters: dict) -> list[dict]:
    """Retourne la liste des prospects matchant les filtres de la campagne."""
    where = ["p.owner_id=?", "(p.deleted_at IS NULL)"]
    params: list = [uid]
    f = filters or {}
    # Statut
    if f.get("statut"):
        vals = f["statut"] if isinstance(f["statut"], list) else [f["statut"]]
        where.append(f"p.statut IN ({','.join(['?']*len(vals))})")
        params.extend(vals)
    # Pertinence min
    if f.get("pertinence_min") is not None:
        where.append("COALESCE(p.pertinence,0)>=?"); params.append(int(f["pertinence_min"]))
    # Tags (LIKE)
    if f.get("tags"):
        tags = f["tags"] if isinstance(f["tags"], list) else [f["tags"]]
        for t in tags:
            where.append("COALESCE(p.tags,'') LIKE ?"); params.append(f"%{t}%")
    # A relancer
    if f.get("a_relancer"):
        where.append("(p.statut IN ('Relance à faire','Relancer'))")
    # Limit
    limit = int(f.get("limit") or 500)
    q = (
        "SELECT p.id, p.name, p.email, p.phone, p.statut, p.tags, "
        "c.groupe AS company_name "
        "FROM prospects p LEFT JOIN companies c ON c.id=p.company_id "
        "WHERE " + " AND ".join(where) + " ORDER BY p.id DESC LIMIT ?;"
    )
    params.append(limit)
    rows = conn.execute(q, params).fetchall()
    return [dict(r) for r in rows]


@push_logs_bp.post("/api/push-campaigns/<int:cid>/recipients-preview")
def api_push_campaigns_recipients(cid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT filters_json FROM push_campaigns WHERE id=? AND owner_id=?;",
            (cid, uid),
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Campagne introuvable"), 404
        filters = {}
        raw = row["filters_json"]
        if raw:
            try:
                filters = json.loads(raw) if isinstance(raw, str) else raw
            except Exception:
                filters = {}
        prospects = _apply_campaign_filters(conn, uid, filters)
    return jsonify(ok=True, count=len(prospects), prospects=prospects)


@push_logs_bp.post("/api/push-campaigns/<int:cid>/send")
def api_push_campaigns_send(cid: int):
    """Marque la campagne comme envoyée et crée un push_log par destinataire (tracking)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM push_campaigns WHERE id=? AND owner_id=?;", (cid, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Campagne introuvable"), 404
        filters = {}
        if row["filters_json"]:
            try:
                filters = json.loads(row["filters_json"])
            except Exception:
                filters = {}
        recipients = _apply_campaign_filters(conn, uid, filters)
        count = 0
        for p in recipients:
            conn.execute(
                "INSERT INTO push_logs (prospect_id, sentAt, channel, to_email, "
                "subject, body, template_id, createdAt, campaign_id) "
                "VALUES (?,?,?,?,?,?,?,?,?);",
                (p["id"], now, "campaign", p.get("email") or "",
                 row["name"], "", row["template_id"], now, cid),
            )
            count += 1
        stats = {"sent": count, "recipients": len(recipients)}
        conn.execute(
            "UPDATE push_campaigns SET sent_at=?, stats_json=?, updated_at=? WHERE id=?;",
            (now, json.dumps(stats), now, cid),
        )
    return jsonify(ok=True, sent=count, recipients=len(recipients))



# ====== Push tracking & analytics API (v26.6) ======
@push_logs_bp.get("/api/push/track")
def api_push_track():
    """Track email open via tracking pixel. Returns 1x1 transparent GIF."""
    pixel_id = request.args.get("pixel_id")
    if not pixel_id:
        return jsonify({"ok": False, "error": "pixel_id required"}), 400

    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        # Mettre à jour opened_at si pas déjà ouvert
        try:
            _safe_execute_update(
                conn,
                "UPDATE push_logs SET opened_at=? WHERE tracking_pixel_id=? AND opened_at IS NULL;",
                (now, pixel_id),
            )
        except Exception as e:
            logger.warning("Erreur mise à jour push_logs opened_at: %s", e)
        
        # Mettre à jour aussi dans push_variants si applicable
        if _check_table_exists(conn, "push_variants"):
            try:
                _safe_execute_update(
                    conn,
                    """
                    UPDATE push_variants SET opened_at=?
                    WHERE push_log_id IN (SELECT id FROM push_logs WHERE tracking_pixel_id=?)
                    AND opened_at IS NULL;
                    """,
                    (now, pixel_id),
                )
            except Exception as e:
                logger.warning("Erreur mise à jour push_variants opened_at: %s", e)

    # Retourner un pixel transparent 1x1 GIF
    gif_data = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
    return Response(gif_data, mimetype="image/gif")


@push_logs_bp.get("/api/push/track/click")
def api_push_track_click():
    """Track email link click and redirect."""
    pixel_id = request.args.get("pixel_id")
    url = request.args.get("url")
    if not pixel_id or not url:
        return jsonify({"ok": False, "error": "pixel_id and url required"}), 400

    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        # Mettre à jour clicked_at si pas déjà cliqué
        try:
            _safe_execute_update(
                conn,
                "UPDATE push_logs SET clicked_at=? WHERE tracking_pixel_id=? AND clicked_at IS NULL;",
                (now, pixel_id),
            )
        except Exception as e:
            logger.warning("Erreur mise à jour push_logs clicked_at: %s", e)
        
        # Mettre à jour aussi dans push_variants si applicable
        if _check_table_exists(conn, "push_variants"):
            try:
                _safe_execute_update(
                    conn,
                    """
                    UPDATE push_variants SET clicked_at=?
                    WHERE push_log_id IN (SELECT id FROM push_logs WHERE tracking_pixel_id=?)
                    AND clicked_at IS NULL;
                    """,
                    (now, pixel_id),
                )
            except Exception as e:
                logger.warning("Erreur mise à jour push_variants clicked_at: %s", e)

    # Rediriger vers l'URL
    return redirect(url, code=302)


@push_logs_bp.get("/api/push/optimal-time")
def api_push_optimal_time():
    """Retourne le timing optimal pour un prospect donné."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    prospect_id = request.args.get("prospect_id", type=int)
    if not prospect_id:
        return jsonify({"ok": False, "error": "prospect_id required"}), 400
    result = _get_optimal_send_time(prospect_id)
    return jsonify({"ok": True, "optimal_timing": result})


@push_logs_bp.get("/api/push/analytics")
def api_push_analytics():
    """Retourne les analytics de mailing : meilleurs créneaux, performance variantes, recommandations."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    prospect_id = request.args.get("prospect_id", type=int)
    
    # Validation prospect_id si fourni
    prospect_id_validated = None
    if prospect_id is not None:
        try:
            prospect_id_validated = _validate_positive_int(prospect_id, "prospect_id")
        except ValueError:
            return jsonify({"ok": False, "error": "prospect_id invalide"}), 400

    with _conn() as conn:
        # Base query pour filtrer par owner_id - construction sécurisée avec paramètres
        # Toujours utiliser des paramètres, jamais de f-strings avec valeurs utilisateur
        base_where_owner = "l.prospect_id IN (SELECT id FROM prospects WHERE owner_id=?)"
        base_params = [uid]
        
        if prospect_id_validated is not None:
            base_where_owner += " AND l.prospect_id=?"
            base_params.append(prospect_id_validated)

        # 1. Meilleurs créneaux horaires (taux d'ouverture par heure)
        hour_stats = []
        for hour in range(24):
            # Construction sécurisée : base_where_owner est une constante contrôlée, hour est un entier
            query = f"""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened
                FROM push_logs l
                WHERE {base_where_owner} AND l.sent_at_hour=? AND l.channel='email'
                """
            # base_where_owner est sûr car construit uniquement avec des constantes et des paramètres
            rows = conn.execute(
                query,
                base_params + [hour],
            ).fetchone()
            if rows["total"] > 0:
                open_rate = (rows["opened"] / rows["total"]) * 100
                hour_stats.append({
                    "hour": hour,
                    "total": rows["total"],
                    "opened": rows["opened"],
                    "open_rate": round(open_rate, 2),
                })
        hour_stats.sort(key=lambda x: x["open_rate"], reverse=True)

        # 2. Meilleurs jours (taux d'ouverture par jour de semaine)
        day_stats = []
        day_names = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
        for day in range(7):
            # Construction sécurisée : base_where_owner est une constante contrôlée, day est un entier
            query = f"""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened
                FROM push_logs l
                WHERE {base_where_owner} AND l.sent_at_day_of_week=? AND l.channel='email'
                """
            rows = conn.execute(
                query,
                base_params + [day],
            ).fetchone()
            if rows["total"] > 0:
                open_rate = (rows["opened"] / rows["total"]) * 100
                day_stats.append({
                    "day": day,
                    "day_name": day_names[day],
                    "total": rows["total"],
                    "opened": rows["opened"],
                    "open_rate": round(open_rate, 2),
                })
        day_stats.sort(key=lambda x: x["open_rate"], reverse=True)

        # 3. Performance des variantes A/B
        variant_stats = []
        # Vérifier que la table push_variants existe (peut être absente sur anciennes DB)
        try:
            # Tester si la table existe
            conn.execute("SELECT 1 FROM push_variants LIMIT 1").fetchone()
            table_exists = True
        except sqlite3.OperationalError as e:
            if "no such table: push_variants" in str(e):
                # Table absente : créer la table
                logger.warning("Table push_variants absente, création...")
                try:
                    conn.executescript("""
                        CREATE TABLE IF NOT EXISTS push_variants (
                            id            INTEGER PRIMARY KEY,
                            push_log_id   INTEGER NOT NULL,
                            variant_id    TEXT NOT NULL,
                            subject       TEXT,
                            body          TEXT,
                            sent_at       TEXT,
                            opened_at     TEXT,
                            clicked_at    TEXT,
                            replied_at    TEXT,
                            createdAt     TEXT NOT NULL,
                            FOREIGN KEY(push_log_id) REFERENCES push_logs(id) ON DELETE CASCADE
                        );
                        CREATE INDEX IF NOT EXISTS idx_push_variants_push_log_id ON push_variants(push_log_id);
                        CREATE INDEX IF NOT EXISTS idx_push_variants_variant_id ON push_variants(variant_id);
                    """)
                    table_exists = True
                    logger.info("Table push_variants créée avec succès")
                except Exception as create_err:
                    logger.error("Impossible de créer push_variants: %s", create_err)
                    table_exists = False
            else:
                raise
        
        if table_exists:
            try:
                # Construction sécurisée : base_where_owner est une constante contrôlée
                query = f"""
                    SELECT 
                        v.variant_id,
                        COUNT(*) as total,
                        SUM(CASE WHEN v.opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
                        SUM(CASE WHEN v.clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
                        SUM(CASE WHEN v.replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
                    FROM push_variants v
                    JOIN push_logs l ON l.id = v.push_log_id
                    WHERE {base_where_owner}
                    GROUP BY v.variant_id
                    """
                variant_rows = conn.execute(
                    query,
                    base_params,
                ).fetchall()
            except sqlite3.OperationalError as e:
                logger.error("Erreur lors de la requête push_variants: %s", e)
                variant_rows = []
        else:
            variant_rows = []
        for row in variant_rows:
            total = row["total"]
            if total > 0:
                variant_stats.append({
                    "variant_id": row["variant_id"],
                    "total": total,
                    "opened": row["opened"],
                    "clicked": row["clicked"],
                    "replied": row["replied"],
                    "open_rate": round((row["opened"] / total) * 100, 2),
                    "click_rate": round((row["clicked"] / total) * 100, 2),
                    "reply_rate": round((row["replied"] / total) * 100, 2),
                })
        variant_stats.sort(key=lambda x: x["open_rate"], reverse=True)

        # 4. Recommandations de timing optimal par prospect
        optimal_timing = None
        if prospect_id:
            # Analyser l'historique de ce prospect
            prospect_rows = conn.execute(
                """
                SELECT sent_at_hour, sent_at_day_of_week, opened_at
                FROM push_logs
                WHERE prospect_id=? AND channel='email'
                ORDER BY id DESC LIMIT 20
                """,
                (prospect_id,),
            ).fetchall()
            if prospect_rows:
                # Calculer les meilleurs créneaux pour ce prospect
                hour_scores = {}
                day_scores = {}
                for row in prospect_rows:
                    hour = row["sent_at_hour"]
                    day = row["sent_at_day_of_week"]
                    opened = 1 if row["opened_at"] else 0
                    hour_scores[hour] = hour_scores.get(hour, [0, 0])
                    hour_scores[hour][0] += opened
                    hour_scores[hour][1] += 1
                    day_scores[day] = day_scores.get(day, [0, 0])
                    day_scores[day][0] += opened
                    day_scores[day][1] += 1

                best_hour = max(hour_scores.items(), key=lambda x: x[1][0] / x[1][1] if x[1][1] > 0 else 0)[0] if hour_scores else None
                best_day = max(day_scores.items(), key=lambda x: x[1][0] / x[1][1] if x[1][1] > 0 else 0)[0] if day_scores else None
                optimal_timing = {
                    "best_hour": best_hour,
                    "best_day": best_day,
                    "best_day_name": day_names[best_day] if best_day is not None else None,
                }

    return jsonify({
        "ok": True,
        "hour_stats": hour_stats[:5],  # Top 5
        "day_stats": day_stats[:5],  # Top 5
        "variant_stats": variant_stats,
        "optimal_timing": optimal_timing,
    })


def _get_optimal_send_time(prospect_id: int) -> Dict[str, Any]:
    """Calcule le timing optimal pour envoyer un push à un prospect donné."""
    uid = _uid()
    if not uid:
        return {}

    with _conn() as conn:
        # Vérifier que le prospect appartient à l'utilisateur
        p = conn.execute(
            "SELECT id FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid),
        ).fetchone()
        if not p:
            return {}

        # Analyser l'historique de ce prospect
        rows = conn.execute(
            """
            SELECT sent_at_hour, sent_at_day_of_week, opened_at, clicked_at
            FROM push_logs
            WHERE prospect_id=? AND channel='email'
            ORDER BY id DESC LIMIT 50
            """,
            (prospect_id,),
        ).fetchall()

        if not rows:
            # Pas d'historique : recommandations par défaut
            return {
                "best_hour": 10,  # 10h du matin
                "best_day": 1,  # Mardi
                "confidence": "low",
                "reason": "Pas d'historique disponible",
            }

        # Calculer les scores par créneau
        hour_scores = {}
        day_scores = {}
        for row in rows:
            hour = row["sent_at_hour"]
            day = row["sent_at_day_of_week"]
            score = 0
            if row["opened_at"]:
                score += 2
            if row["clicked_at"]:
                score += 3

            hour_scores[hour] = hour_scores.get(hour, [0, 0])
            hour_scores[hour][0] += score
            hour_scores[hour][1] += 1

            day_scores[day] = day_scores.get(day, [0, 0])
            day_scores[day][0] += score
            day_scores[day][1] += 1

        # Trouver les meilleurs créneaux
        best_hour = max(hour_scores.items(), key=lambda x: x[1][0] / x[1][1] if x[1][1] > 0 else 0)[0] if hour_scores else 10
        best_day = max(day_scores.items(), key=lambda x: x[1][0] / x[1][1] if x[1][1] > 0 else 0)[0] if day_scores else 1

        confidence = "high" if len(rows) >= 10 else "medium" if len(rows) >= 5 else "low"

        day_names = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
        return {
            "best_hour": best_hour,
            "best_day": best_day,
            "best_day_name": day_names[best_day],
            "confidence": confidence,
            "reason": f"Basé sur {len(rows)} envois précédents",
        }


