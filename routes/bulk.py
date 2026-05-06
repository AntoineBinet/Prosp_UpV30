"""ProspUp — Blueprint Bulk Operations (mass updates prospects)."""
from __future__ import annotations

import json
from flask import Blueprint, jsonify, request

from app import _audit_log, log_activity, logger
from utils.auth import _prospect_owned, _uid
from utils.common import _now_iso
from utils.db import _conn

bulk_bp = Blueprint("bulk", __name__)


@bulk_bp.post("/api/prospect/mark_done")
def api_prospect_mark_done():
    payload = request.get_json(force=True, silent=False) or {}
    pid = payload.get("id")
    if not pid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    note = (payload.get("note") or "").rstrip()
    next_action = (payload.get("nextAction") or "").strip() or None
    next_follow = (payload.get("nextFollowUp") or "").strip()
    last_contact = (payload.get("lastContact") or _now_iso()).strip()
    date = payload.get("date") or _now_iso()
    now = _now_iso()

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute("SELECT id FROM prospects WHERE id=? AND owner_id=?;", (int(pid), uid)).fetchone()
        if not row:
            return jsonify(ok=False, error="prospect not found"), 404
        conn.execute(
            "UPDATE prospects SET lastContact=?, nextAction=?, nextFollowUp=? WHERE id=? AND owner_id=?;",
            (last_contact, next_action, next_follow, int(pid), uid),
        )
        if note or next_action or next_follow:
            meta = {"nextAction": next_action, "nextFollowUp": next_follow}
            conn.execute(
                "INSERT INTO prospect_events (prospect_id, date, type, title, content, meta, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?);",
                (int(pid), date, "done", "Action réalisée", note or "", json.dumps(meta, ensure_ascii=False), now),
            )
        # Teams webhook: CR (v22.1)
        try:
            p_row = conn.execute("SELECT name, company_id FROM prospects WHERE id=? AND owner_id=?;", (int(pid), uid)).fetchone()
            p_name = p_row["name"] if p_row else "?"
            c_row = conn.execute("SELECT groupe FROM companies WHERE id=? AND owner_id=?;", (p_row["company_id"], uid)).fetchone() if p_row else None
            c_name = c_row["groupe"] if c_row else ""
            prefix = _get_user_prefix(uid)
            card = _build_adaptive_card(
                "Compte-rendu",
                [("Prospect", p_name), ("Entreprise", c_name), ("Résumé", (note or "—")[:200]),
                 ("Next action", next_action or "—"), ("Relance", next_follow or "—"), ("Consultant", prefix)],
                [{"title": "Voir prospect", "url": f"https://prospup.work/entreprises?highlight={pid}"}]
            )
            _send_teams_webhook(card, "mark_done")
        except Exception:
            pass
    return jsonify({"ok": True})


@bulk_bp.post("/api/prospects/bulk-update")
def api_prospects_bulk_update():
    """Bulk update nextFollowUp for selected prospects (owner only)."""
    chk = _require_same_origin()
    if chk:
        return chk
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    ids = payload.get("ids")
    if not ids or not isinstance(ids, list):
        return jsonify(ok=False, error="ids (array) required"), 400
    next_follow = payload.get("nextFollowUp")
    if next_follow is not None:
        next_follow = str(next_follow).strip() or None
    updated = 0
    with _conn() as conn:
        for pid in ids:
            try:
                pid = int(pid)
            except (TypeError, ValueError):
                continue
            row = conn.execute("SELECT id FROM prospects WHERE id=? AND owner_id=?;", (pid, uid)).fetchone()
            if row:
                conn.execute("UPDATE prospects SET nextFollowUp=? WHERE id=? AND owner_id=?;", (next_follow, pid, uid))
                updated += 1
    return jsonify(ok=True, updated=updated)


@bulk_bp.post("/api/prospects/bulk-field-update")
def api_prospects_bulk_field_update():
    """Bulk update a single field (email or telephone) for selected prospects."""
    chk = _require_same_origin()
    if chk:
        return chk
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    ids = payload.get("ids")
    field = payload.get("field", "")
    values = payload.get("values")
    if not ids or not isinstance(ids, list):
        return jsonify(ok=False, error="ids (array) required"), 400
    if field not in ("email", "telephone"):
        return jsonify(ok=False, error="field must be 'email' or 'telephone'"), 400
    if not values or not isinstance(values, list) or len(values) != len(ids):
        return jsonify(ok=False, error="values (array, same length as ids) required"), 400
    updated = 0
    col = "email" if field == "email" else "telephone"
    with _conn() as conn:
        for i, pid in enumerate(ids):
            try:
                pid = int(pid)
            except (TypeError, ValueError):
                continue
            val = str(values[i]).strip() if values[i] else ""
            row = conn.execute("SELECT id FROM prospects WHERE id=? AND owner_id=?;", (pid, uid)).fetchone()
            if row:
                conn.execute(f"UPDATE prospects SET {col}=? WHERE id=? AND owner_id=?;", (val, pid, uid))
                updated += 1
    return jsonify(ok=True, updated=updated)


@bulk_bp.post("/api/prospects/bulk-edit")
def api_prospects_bulk_edit():
    """Bulk update a whitelisted field for selected prospects.

    Accepte deux formats :
      - mode mono-champ : { ids, field, value }
      - mode multi-champs : { ids, fields: { f1: v1, f2: v2, ... } } (v31.3+)
    Les changements de statut → "Rendez-vous" + rdvDate déclenchent un event
    rdv_taken (KPI gamification). Tout changement de statut crée aussi un
    event status_change dans la timeline.
    """
    chk = _require_same_origin()
    if chk:
        return chk
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    ids = payload.get("ids")
    fields_in = payload.get("fields")
    field = payload.get("field", "")
    value = payload.get("value")
    ALLOWED_FIELDS = {"fonction", "statut", "pertinence", "fixedMetier", "notes", "company_id",
                      "telephone", "email", "linkedin", "rdvDate", "nextFollowUp", "priority", "nextAction",
                      "tags"}
    ALLOW_EMPTY = {"notes", "telephone", "email", "linkedin", "rdvDate", "nextFollowUp", "nextAction", "tags"}
    if not ids or not isinstance(ids, list):
        return jsonify(ok=False, error="ids (array) required"), 400

    # Construire le dict de champs à appliquer (mono ou multi).
    if isinstance(fields_in, dict) and fields_in:
        fields_map = dict(fields_in)
    else:
        if field not in ALLOWED_FIELDS:
            return jsonify(ok=False, error=f"field must be one of {sorted(ALLOWED_FIELDS)}"), 400
        fields_map = {field: value}

    # Validation et normalisation par champ.
    company_meta = None
    normalized: dict = {}
    for f, v in fields_map.items():
        if f not in ALLOWED_FIELDS:
            return jsonify(ok=False, error=f"field '{f}' non autorisé"), 400
        if v is None or (str(v).strip() == "" and f not in ALLOW_EMPTY):
            return jsonify(ok=False, error=f"value required for '{f}'"), 400
        if f == "company_id":
            try:
                cid = int(str(v).strip())
            except (TypeError, ValueError):
                return jsonify(ok=False, error="company_id must be an integer"), 400
            with _conn() as conn:
                row = conn.execute(
                    "SELECT id, groupe, site FROM companies WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
                    (cid, uid)
                ).fetchone()
                if not row:
                    return jsonify(ok=False, error="Entreprise inconnue — utilise l'autocomplete pour la choisir ou la créer."), 400
                normalized[f] = cid
                company_meta = {"id": int(row["id"]), "groupe": row["groupe"] or "", "site": row["site"] or ""}
        elif f in ("priority", "pertinence"):
            try:
                normalized[f] = int(str(v).strip()) if str(v).strip() != "" else None
            except (TypeError, ValueError):
                return jsonify(ok=False, error=f"{f} must be an integer"), 400
        else:
            normalized[f] = str(v).strip() if v is not None else ""

    updated = 0
    errors = []
    set_clause = ", ".join(f"{f}=?" for f in normalized.keys())
    set_values = list(normalized.values())

    with _conn() as conn:
        for pid in ids:
            try:
                pid = int(pid)
            except (TypeError, ValueError):
                errors.append(str(pid))
                continue
            row = conn.execute(
                "SELECT id, statut, rdvDate FROM prospects WHERE id=? AND owner_id=?;",
                (pid, uid)
            ).fetchone()
            if not row:
                errors.append(str(pid))
                continue
            old_statut = str(row["statut"] or "").strip()
            old_rdv = str(row["rdvDate"] or "").strip()
            conn.execute(
                f"UPDATE prospects SET {set_clause} WHERE id=? AND owner_id=?;",
                set_values + [pid, uid]
            )
            updated += 1

            # Event rdv_taken pour le KPI gamification.
            try:
                new_statut = str(normalized.get("statut", old_statut) or "").strip()
                new_rdv = str(normalized.get("rdvDate", old_rdv) or "").strip()
                if new_statut == "Rendez-vous" and new_rdv:
                    if old_statut != "Rendez-vous" or old_rdv != new_rdv:
                        now_ev = datetime.datetime.now().isoformat(timespec="seconds")
                        ev_date = now_ev[:10]
                        conn.execute(
                            "INSERT OR IGNORE INTO prospect_events (prospect_id, date, type, title, content, meta, createdAt) VALUES (?,?,?,?,?,?,?)",
                            (pid, ev_date, "rdv_taken", "RDV pris", None,
                             json.dumps({"rdvDate": new_rdv}, ensure_ascii=False), now_ev),
                        )
            except Exception:
                pass

            # Event status_change pour la timeline.
            try:
                if "statut" in normalized:
                    new_statut = str(normalized["statut"] or "").strip()
                    if new_statut and old_statut != new_statut:
                        ev_at = datetime.datetime.now().isoformat()
                        content_statut = f"{old_statut} → {new_statut}" if old_statut else new_statut
                        conn.execute(
                            "INSERT OR IGNORE INTO prospect_events (prospect_id, date, type, title, content, meta, createdAt) VALUES (?,?,?,?,?,?,?)",
                            (pid, ev_at, "status_change", "Changement de statut", content_statut, None, ev_at),
                        )
            except Exception:
                pass

    resp = {"ok": True, "updated": updated, "errors": errors}
    if company_meta:
        resp["company"] = company_meta
    return jsonify(**resp)


@bulk_bp.post("/api/prospects/bulk-status-tags")
def api_prospects_bulk_status_tags():
    """v23.5: Bulk update statut and/or tags for selected prospects."""
    chk = _require_same_origin()
    if chk:
        return chk
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    ids = payload.get("ids")
    new_statut = payload.get("statut")  # optional
    add_tags = payload.get("add_tags")  # optional list of tags to add
    remove_tags = payload.get("remove_tags")  # optional list of tags to remove
    if not ids or not isinstance(ids, list):
        return jsonify(ok=False, error="ids (array) required"), 400
    if not new_statut and not add_tags and not remove_tags:
        return jsonify(ok=False, error="statut, add_tags or remove_tags required"), 400
    updated = 0
    now = _now_iso()
    with _conn() as conn:
        for pid in ids:
            try:
                pid = int(pid)
            except (TypeError, ValueError):
                continue
            row = conn.execute("SELECT id, statut, tags FROM prospects WHERE id=? AND owner_id=? AND deleted_at IS NULL;", (pid, uid)).fetchone()
            if not row:
                continue
            sets = []
            vals = []
            if new_statut:
                sets.append("statut=?")
                vals.append(new_statut)
            if add_tags or remove_tags:
                # Parse existing tags
                raw = row["tags"] or "[]"
                try:
                    existing = json.loads(raw) if raw.startswith("[") else [t.strip() for t in raw.split(",") if t.strip()]
                except Exception:
                    existing = []
                if add_tags and isinstance(add_tags, list):
                    for t in add_tags:
                        if t and t not in existing:
                            existing.append(t)
                if remove_tags and isinstance(remove_tags, list):
                    existing = [t for t in existing if t not in remove_tags]
                sets.append("tags=?")
                vals.append(json.dumps(existing, ensure_ascii=False))
            vals.extend([pid, uid])
            conn.execute(f"UPDATE prospects SET {', '.join(sets)} WHERE id=? AND owner_id=?;", vals)
            updated += 1
    _audit_log("bulk_status_tags", "prospect", new_value=json.dumps({"ids": ids[:20], "statut": new_statut, "add_tags": add_tags, "remove_tags": remove_tags}, ensure_ascii=False))
    return jsonify(ok=True, updated=updated)


@bulk_bp.post("/api/prospects/bulk-archive")
def api_prospects_bulk_archive():
    """v30.2 : archive (ou désarchive) plusieurs prospects d'un coup."""
    chk = _require_same_origin()
    if chk:
        return chk
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    ids = payload.get("ids")
    archive = 1 if payload.get("archive", True) else 0
    if not ids or not isinstance(ids, list):
        return jsonify(ok=False, error="ids (array) required"), 400
    updated = 0
    with _conn() as conn:
        for pid in ids:
            try:
                pid = int(pid)
            except (TypeError, ValueError):
                continue
            row = conn.execute("SELECT id FROM prospects WHERE id=? AND owner_id=?;", (pid, uid)).fetchone()
            if row:
                conn.execute("UPDATE prospects SET is_archived=? WHERE id=? AND owner_id=?;", (archive, pid, uid))
                updated += 1
    _audit_log("bulk_archive", "prospect", new_value=json.dumps({"ids": ids[:20], "archive": archive}))
    return jsonify(ok=True, updated=updated)


@bulk_bp.post("/api/prospects/remove-tag-globally")
def api_prospects_remove_tag_globally():
    """Supprime un ou plusieurs tags de TOUS les prospects de l'utilisateur courant."""
    chk = _require_same_origin()
    if chk:
        return chk
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    tags_to_remove = payload.get("tags")
    if not tags_to_remove or not isinstance(tags_to_remove, list):
        return jsonify(ok=False, error="tags (array) required"), 400
    tags_to_remove = [str(t).strip() for t in tags_to_remove if str(t).strip()]
    if not tags_to_remove:
        return jsonify(ok=False, error="tags vides"), 400
    # Construire un set case-insensitive pour la comparaison
    remove_set = set(t.lower() for t in tags_to_remove)
    affected = 0
    try:
        with _conn() as conn:
            rows = conn.execute(
                "SELECT id, tags FROM prospects WHERE owner_id=? AND deleted_at IS NULL", (uid,)
            ).fetchall()
            for row in rows:
                raw = row["tags"] or "[]"
                try:
                    existing = json.loads(raw) if isinstance(raw, str) and raw.startswith("[") else [t.strip() for t in raw.split(",") if t.strip()]
                except Exception:
                    existing = []
                filtered = [t for t in existing if t.strip().lower() not in remove_set]
                if len(filtered) != len(existing):
                    conn.execute(
                        "UPDATE prospects SET tags=? WHERE id=? AND owner_id=?",
                        (json.dumps(filtered, ensure_ascii=False), row["id"], uid)
                    )
                    affected += 1
    except Exception as exc:
        logger.exception("Erreur remove-tag-globally")
        return jsonify(ok=False, error=str(exc)), 500
    _audit_log("remove_tag_globally", "prospect",
               new_value=json.dumps({"tags": tags_to_remove[:20], "affected": affected}, ensure_ascii=False))
    return jsonify(ok=True, affected=affected, removed=len(tags_to_remove))


@bulk_bp.post("/api/prospects/update-contacts")
def api_prospects_update_contacts():
    """Bulk update telephone/email for existing prospects from Excel import.

    Body: { updates: [{id, telephone, email}] }
    Only updates fields that are provided and non-empty.
    """
    chk = _require_same_origin()
    if chk:
        return chk
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    updates = payload.get("updates")
    if not updates or not isinstance(updates, list):
        return jsonify(ok=False, error="updates (array) required"), 400
    updated = 0
    with _conn() as conn:
        for item in updates:
            try:
                pid = int(item.get("id"))
            except (TypeError, ValueError):
                continue
            tel = str(item.get("telephone") or "").strip()
            mail = str(item.get("email") or "").strip()
            if not tel and not mail:
                continue
            row = conn.execute(
                "SELECT id FROM prospects WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
                (pid, uid)
            ).fetchone()
            if not row:
                continue
            sets, vals = [], []
            if tel:
                sets.append("telephone=?")
                vals.append(tel)
            if mail:
                sets.append("email=?")
                vals.append(mail)
            vals.extend([pid, uid])
            conn.execute(f"UPDATE prospects SET {', '.join(sets)} WHERE id=? AND owner_id=?;", vals)
            updated += 1
    return jsonify(ok=True, updated=updated)

