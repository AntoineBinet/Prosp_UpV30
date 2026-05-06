"""ProspUp — Blueprint Prospects — partie 1 (timeline, log-call, events).

Routes liées à l'historique du prospect : timeline (events/notes/calls/pushes),
log-call, log-stage, events add/update/delete."""
from __future__ import annotations

import datetime
import json
import re
from pathlib import Path

from flask import Blueprint, jsonify, request

from app import _audit_log, log_activity, logger
from utils.auth import _prospect_owned, _uid
from utils.common import _now_iso
from utils.db import _auth_conn, _conn

prospects_bp = Blueprint("prospects", __name__)


@prospects_bp.get("/api/prospect/timeline")
def api_prospect_timeline():
    pid = request.args.get("id")
    if not pid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    try:
        pid_int = int(pid)
    except (ValueError, TypeError):
        return jsonify({"ok": False, "error": "id invalide"}), 400

    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401

    prospect_dict: dict = {}
    logs: list = []
    extra: list = []
    cand_names: dict = {}
    user_names: dict = {}

    try:
        with _conn() as conn:
            row = conn.execute(
                "SELECT p.*, c.groupe AS company_groupe, c.site AS company_site "
                "FROM prospects p "
                "LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = p.owner_id "
                "WHERE p.id=? AND p.owner_id=?;",
                (pid_int, uid)
            ).fetchone()
            if not row:
                return jsonify({"ok": False, "error": "prospect not found"}), 404
            prospect_dict = dict(row)

            try:
                logs = [
                    dict(r)
                    for r in conn.execute(
                        "SELECT * FROM push_logs WHERE prospect_id=? ORDER BY id DESC LIMIT 80;",
                        (pid_int,),
                    ).fetchall()
                ]
            except Exception as e:
                logger.error("[timeline] push_logs query failed pid=%s: %s", pid_int, e)

            try:
                extra = [
                    dict(r)
                    for r in conn.execute(
                        "SELECT id, date, type, title, content, meta, createdAt FROM prospect_events WHERE prospect_id=? ORDER BY date DESC, id DESC LIMIT 80;",
                        (pid_int,),
                    ).fetchall()
                ]
            except Exception as e:
                logger.warning("[timeline] prospect_events query failed pid=%s: %s", pid_int, e)

            _cand_ids: set = set()
            _user_ids: set = set()
            for _l in logs:
                for _f in ("candidate_id1", "candidate_id2"):
                    _v = _l.get(_f)
                    if _v:
                        try:
                            _cand_ids.add(int(_v))
                        except (ValueError, TypeError):
                            pass
                for _f in ("consultant1_id", "consultant2_id"):
                    _v = _l.get(_f)
                    if _v:
                        try:
                            _user_ids.add(int(_v))
                        except (ValueError, TypeError):
                            pass

            if _cand_ids:
                try:
                    _ph = ",".join("?" * len(_cand_ids))
                    for _r in conn.execute(
                        f"SELECT id, name FROM candidates WHERE id IN ({_ph});",
                        list(_cand_ids),
                    ).fetchall():
                        cand_names[int(_r["id"])] = _r["name"] or ""
                except Exception as e:
                    logger.warning("[timeline] candidates lookup failed: %s", e)

            if _user_ids:
                try:
                    _aconn = _auth_conn()
                    try:
                        _ph = ",".join("?" * len(_user_ids))
                        for _r in _aconn.execute(
                            f"SELECT id, display_name, username FROM users WHERE id IN ({_ph});",
                            list(_user_ids),
                        ).fetchall():
                            user_names[int(_r["id"])] = (
                                _r["display_name"] or _r["username"] or f"user_{_r['id']}"
                            )
                    finally:
                        _aconn.close()
                except Exception as e:
                    logger.warning("[timeline] user lookup failed: %s", e)

    except Exception as e:
        logger.exception("[timeline] unhandled error pid=%s uid=%s: %s", pid_int, uid, e)
        return jsonify({"ok": False, "error": "Erreur interne"}), 500

    meetings_rows: list = []
    attachments_rows: list = []

    try:
        with _conn() as conn2:
            try:
                meetings_rows = [
                    dict(r)
                    for r in conn2.execute(
                        """SELECT m.id, m.date, m.title, m.summary, m.next_action, m.tags,
                                  m.createdAt,
                                  (SELECT COUNT(*) FROM meeting_action_items ai WHERE ai.meeting_id = m.id) AS action_count,
                                  (SELECT COUNT(*) FROM meeting_action_items ai WHERE ai.meeting_id = m.id AND ai.status != 'done') AS action_pending
                           FROM meetings m
                           WHERE m.prospect_id = ? AND m.owner_id = ?
                           ORDER BY m.date DESC, m.createdAt DESC
                           LIMIT 50""",
                        (pid_int, uid),
                    ).fetchall()
                ]
            except Exception as e:
                logger.warning("[timeline] meetings query failed pid=%s: %s", pid_int, e)

            try:
                attachments_rows = [
                    dict(r)
                    for r in conn2.execute(
                        """SELECT id, original_name, size, mime_type, description, tags,
                                  thumbnail, meeting_id, title, createdAt
                           FROM prospect_attachments
                           WHERE prospect_id = ? AND owner_id = ?
                           ORDER BY createdAt DESC
                           LIMIT 100""",
                        (pid_int, uid),
                    ).fetchall()
                ]
            except Exception as e:
                logger.warning("[timeline] attachments query failed pid=%s: %s", pid_int, e)
    except Exception:
        pass

    events = []

    try:
        call_notes = json.loads((prospect_dict.get("callNotes") or "[]"))
        if isinstance(call_notes, list):
            for idx, n in enumerate(call_notes):
                d = (n.get("date") if isinstance(n, dict) else "") or ""
                events.append(
                    {
                        "type": "call_note",
                        "date": d,
                        "title": "Note d'appel",
                        "content": (n.get("content") if isinstance(n, dict) else "") or "",
                        "source": "note",
                        "note_index": idx,
                    }
                )
    except Exception:
        pass

    for e in extra:
        meta = None
        try:
            meta = json.loads(e.get("meta") or "null")
        except Exception:
            meta = None
        events.append(
            {
                "type": e.get("type") or "event",
                "date": e.get("date") or e.get("createdAt") or "",
                "title": e.get("title") or "",
                "content": e.get("content") or "",
                "meta": meta,
                "source": "event",
                "id": e.get("id"),
            }
        )

    for l in logs:
        _candidates = []
        for _f in ("candidate_id1", "candidate_id2"):
            _cid = l.get(_f)
            if _cid:
                try:
                    if int(_cid) in cand_names:
                        _candidates.append(cand_names[int(_cid)])
                except (ValueError, TypeError):
                    pass
        _consultants = []
        for _f in ("consultant1_id", "consultant2_id"):
            _cuid = l.get(_f)
            if _cuid:
                try:
                    if int(_cuid) in user_names:
                        _consultants.append(user_names[int(_cuid)])
                except (ValueError, TypeError):
                    pass
        events.append(
            {
                "type": "push",
                "date": l.get("sentAt") or l.get("createdAt") or "",
                "title": f"Push ({l.get('channel') or 'email'})",
                "content": l.get("subject") or "",
                "meta": {
                    "to": l.get("to_email"),
                    "template": l.get("template_name"),
                    "candidates": _candidates,
                    "consultants": _consultants,
                },
                "source": "push",
            }
        )

    # Meetings (CR de réunion) — apparaissent dans la timeline
    for m in meetings_rows:
        tags = []
        try:
            tags = json.loads(m.get("tags") or "[]") or []
        except Exception:
            pass
        body_parts = []
        if m.get("summary"):
            body_parts.append(m["summary"])
        if m.get("next_action"):
            body_parts.append(f"Prochaine action : {m['next_action']}")
        events.append(
            {
                "type": "cr",
                "date": f"{m.get('date') or m.get('createdAt') or ''}T00:00:00" if m.get("date") and "T" not in str(m.get("date", "")) else (m.get("date") or m.get("createdAt") or ""),
                "title": m.get("title") or "Compte-rendu",
                "content": "\n".join(body_parts),
                "source": "cr",
                "id": m.get("id"),
                "meta": {
                    "next_action": m.get("next_action") or "",
                    "action_count": m.get("action_count") or 0,
                    "action_pending": m.get("action_pending") or 0,
                    "tags": tags,
                },
            }
        )

    # Pièces jointes — apparaissent dans la timeline
    for a in attachments_rows:
        a_tags = []
        try:
            a_tags = json.loads(a.get("tags") or "[]") or []
        except Exception:
            pass
        custom_title = (a.get("title") or "").strip()
        events.append(
            {
                "type": "attachment",
                "date": a.get("createdAt") or "",
                "title": custom_title or a.get("original_name") or "Fichier",
                "content": a.get("description") or "",
                "source": "attachment",
                "id": a.get("id"),
                "meta": {
                    "original_name": a.get("original_name") or "",
                    "custom_title": custom_title,
                    "size": a.get("size") or 0,
                    "mime_type": a.get("mime_type") or "",
                    "has_thumbnail": bool(a.get("thumbnail")),
                    "tags": a_tags,
                    "meeting_id": a.get("meeting_id"),
                },
            }
        )

    def _key(e):
        return str(e.get("date") or "")

    events = sorted(events, key=_key, reverse=True)[:150]

    # Synthèse activité : next_action du CR le plus récent + tâches en attente
    activity_summary = {}
    if meetings_rows:
        latest = meetings_rows[0]
        if latest.get("next_action"):
            activity_summary["next_action"] = latest["next_action"]
            activity_summary["next_action_from"] = latest.get("title") or ""
            activity_summary["next_action_date"] = latest.get("date") or ""
        total_pending = sum(m.get("action_pending") or 0 for m in meetings_rows)
        if total_pending:
            activity_summary["pending_tasks"] = total_pending

    return jsonify({"ok": True, "prospect": prospect_dict, "events": events, "activity_summary": activity_summary})


@prospects_bp.post("/api/prospect/log-call")
def api_prospect_log_call():
    """Enregistre un clic sur le bouton Appeler pour un prospect."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    body = request.get_json(silent=True) or {}
    prospect_id = body.get("prospect_id")
    if not prospect_id:
        return jsonify(ok=False, error="prospect_id requis"), 400
    now = _now_iso()
    today = now[:10]
    # Précision microseconde pour garantir l'unicité dans prospect_events (contrainte UNIQUE sur prospect_id, type, date)
    event_at = datetime.datetime.now().isoformat()
    with _conn() as conn:
        # Vérifier que le prospect appartient à l'utilisateur et récupérer le statut courant
        row = conn.execute(
            "SELECT id, statut FROM prospects WHERE id=? AND owner_id=?;", (prospect_id, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        statut = (row["statut"] or "").strip()
        conn.execute(
            "INSERT INTO call_logs (prospect_id, owner_id, date, called_at) VALUES (?,?,?,?);",
            (prospect_id, uid, today, now),
        )
        conn.execute(
            "UPDATE prospects SET lastContact = ? WHERE id = ? AND owner_id = ?;",
            (now, prospect_id, uid),
        )
        # Ajouter une entrée dans la timeline prospect
        call_content = f"Statut : {statut}" if statut else ""
        conn.execute(
            "INSERT OR IGNORE INTO prospect_events "
            "(prospect_id, date, type, title, content, createdAt) VALUES (?,?,?,?,?,?);",
            (prospect_id, event_at, "call", "Appel sortant", call_content, now),
        )
    return jsonify(ok=True, lastContact=now)


@prospects_bp.post("/api/prospect/log-stage")
def api_prospect_log_stage():
    """Enregistre une étape de pipeline (reunion_tech, contrat_signe) pour un prospect."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    body = request.get_json(silent=True) or {}
    prospect_id = body.get("prospect_id")
    stage = body.get("stage")
    ALLOWED_STAGES = ("reunion_tech", "contrat_signe")
    if not prospect_id:
        return jsonify(ok=False, error="prospect_id requis"), 400
    if stage not in ALLOWED_STAGES:
        return jsonify(ok=False, error="stage invalide"), 400
    now = _now_iso()
    today = now[:10]
    STAGE_LABELS = {
        "reunion_tech": "Réunion Technique réalisée",
        "contrat_signe": "Contrat Signé",
    }
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM prospects WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (prospect_id, uid),
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        conn.execute(
            """INSERT INTO prospect_events (prospect_id, date, type, title, content, meta, createdAt)
               VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(prospect_id, type, date) DO UPDATE SET title=excluded.title, createdAt=excluded.createdAt;""",
            (prospect_id, today, stage, STAGE_LABELS[stage], None, None, now),
        )
    return jsonify(ok=True, stage=stage, date=today)


@prospects_bp.post("/api/prospect/events/add")
def api_prospect_events_add():
    """Ajoute un événement manuel (note) à la timeline d'un prospect."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    pid = payload.get("prospect_id")
    if not pid:
        return jsonify(ok=False, error="prospect_id requis"), 400
    try:
        pid_i = int(pid)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="prospect_id invalide"), 400
    if not _prospect_owned(pid_i):
        return jsonify(ok=False, error="Accès refusé"), 403
    title = (payload.get("title") or "").strip() or "Note"
    content = (payload.get("content") or "").strip()
    etype = "note"
    date = datetime.datetime.now().isoformat()
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO prospect_events (prospect_id, date, type, title, content, createdAt)"
            " VALUES (?, ?, ?, ?, ?, ?);",
            (pid_i, date, etype, title, content, date),
        )
        new_id = cur.lastrowid
    return jsonify(ok=True, date=date, id=new_id, type=etype, title=title)


@prospects_bp.post("/api/prospect/timeline/update")
def api_prospect_timeline_update():
    """Modifie le contenu d'un item de timeline (prospect_events ou callNotes JSON)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    pid = payload.get("prospect_id")
    source = (payload.get("source") or "").strip()
    new_content = (payload.get("content") or "").strip()
    has_title = "title" in payload
    new_title = (payload.get("title") or "").strip()[:120] if has_title else None
    if not pid:
        return jsonify(ok=False, error="prospect_id requis"), 400
    try:
        pid_i = int(pid)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="prospect_id invalide"), 400
    if not _prospect_owned(pid_i):
        return jsonify(ok=False, error="Accès refusé"), 403
    if source not in ("event", "note"):
        return jsonify(ok=False, error="source invalide"), 400

    with _conn() as conn:
        if source == "event":
            ev_id = payload.get("id")
            try:
                ev_id_i = int(ev_id)
            except (TypeError, ValueError):
                return jsonify(ok=False, error="id invalide"), 400
            row = conn.execute(
                "SELECT id FROM prospect_events WHERE id=? AND prospect_id=?;",
                (ev_id_i, pid_i),
            ).fetchone()
            if not row:
                return jsonify(ok=False, error="Événement introuvable"), 404
            if has_title:
                conn.execute(
                    "UPDATE prospect_events SET content=?, title=? WHERE id=? AND prospect_id=?;",
                    (new_content, new_title or "Note", ev_id_i, pid_i),
                )
            else:
                conn.execute(
                    "UPDATE prospect_events SET content=? WHERE id=? AND prospect_id=?;",
                    (new_content, ev_id_i, pid_i),
                )
            return jsonify(ok=True)

        # source == "note" : mise à jour dans le JSON callNotes du prospect
        idx = payload.get("note_index")
        try:
            idx_i = int(idx)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="note_index invalide"), 400
        row = conn.execute(
            "SELECT callNotes FROM prospects WHERE id=? AND owner_id=?;",
            (pid_i, uid),
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        try:
            notes = json.loads(row["callNotes"] or "[]")
        except Exception:
            notes = []
        if not isinstance(notes, list) or not (0 <= idx_i < len(notes)):
            return jsonify(ok=False, error="Note introuvable"), 404
        if isinstance(notes[idx_i], dict):
            notes[idx_i]["content"] = new_content
        else:
            notes[idx_i] = {"date": "", "content": new_content}
        conn.execute(
            "UPDATE prospects SET callNotes=? WHERE id=? AND owner_id=?;",
            (json.dumps(notes, ensure_ascii=False), pid_i, uid),
        )
        return jsonify(ok=True)


@prospects_bp.post("/api/prospect/timeline/delete")
def api_prospect_timeline_delete():
    """Supprime un item de timeline (prospect_events ou callNotes JSON)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    pid = payload.get("prospect_id")
    source = (payload.get("source") or "").strip()
    if not pid:
        return jsonify(ok=False, error="prospect_id requis"), 400
    try:
        pid_i = int(pid)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="prospect_id invalide"), 400
    if not _prospect_owned(pid_i):
        return jsonify(ok=False, error="Accès refusé"), 403
    if source not in ("event", "note"):
        return jsonify(ok=False, error="source invalide"), 400

    with _conn() as conn:
        if source == "event":
            ev_id = payload.get("id")
            try:
                ev_id_i = int(ev_id)
            except (TypeError, ValueError):
                return jsonify(ok=False, error="id invalide"), 400
            cur = conn.execute(
                "DELETE FROM prospect_events WHERE id=? AND prospect_id=?;",
                (ev_id_i, pid_i),
            )
            if cur.rowcount == 0:
                return jsonify(ok=False, error="Événement introuvable"), 404
            return jsonify(ok=True)

        # source == "note"
        idx = payload.get("note_index")
        try:
            idx_i = int(idx)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="note_index invalide"), 400
        row = conn.execute(
            "SELECT callNotes FROM prospects WHERE id=? AND owner_id=?;",
            (pid_i, uid),
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        try:
            notes = json.loads(row["callNotes"] or "[]")
        except Exception:
            notes = []
        if not isinstance(notes, list) or not (0 <= idx_i < len(notes)):
            return jsonify(ok=False, error="Note introuvable"), 404
        notes.pop(idx_i)
        conn.execute(
            "UPDATE prospects SET callNotes=? WHERE id=? AND owner_id=?;",
            (json.dumps(notes, ensure_ascii=False), pid_i, uid),
        )
        return jsonify(ok=True)

