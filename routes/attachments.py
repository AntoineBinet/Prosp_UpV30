"""ProspUp — Blueprint Attachments (pièces jointes prospects).

Upload, listing, miniature (PNG), download, suppression.
Stockage isolé par owner_id + prospect_id dans data/user_<uid>/attachments/prospect_<pid>/.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import secrets
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from werkzeug.utils import secure_filename

from app import _audit_log, log_activity, logger
from utils.auth import _prospect_owned, _uid
from utils.db import _conn
from utils.files import _attachment_dir, _extract_pdf_text, _generate_thumbnail, _sniff_mime, _thumb_dir, _validate_upload

attachments_bp = Blueprint("attachments", __name__)


@attachments_bp.post("/api/prospect/attachments")
def api_prospect_attachment_upload():
    """Upload d'une pièce jointe pour un prospect. Isolée par owner_id.

    v32.0 : génère une miniature (PDF/images) et extrait le texte des PDF
    pour la recherche full-text.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    prospect_id = request.form.get("prospect_id", type=int)
    description = (request.form.get("description") or "").strip()[:200]
    meeting_id = request.form.get("meeting_id", type=int)
    tags_raw = request.form.get("tags") or ""

    if not prospect_id:
        return jsonify(ok=False, error="prospect_id requis"), 400
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify(ok=False, error="Fichier manquant"), 400

    ok_upload, err_upload = _validate_upload(file, "prospect_attachment")
    if not ok_upload:
        msg, code = err_upload
        return jsonify(ok=False, error=msg), code

    ext = os.path.splitext(file.filename or "")[1].lower()
    safe_orig = os.path.basename(file.filename or "").strip() or "fichier"
    stored_name = f"{uuid.uuid4().hex}{ext}"

    attach_dir = _attachment_dir(uid, prospect_id)
    target = attach_dir / stored_name
    data = file.read()
    target.write_bytes(data)

    now = datetime.datetime.now().isoformat(timespec="seconds")
    mime = file.mimetype or ""

    # Tags depuis FormData (CSV ou JSON array)
    tags_list = []
    if tags_raw:
        try:
            parsed = json.loads(tags_raw)
            if isinstance(parsed, list):
                tags_list = [str(t).strip() for t in parsed if str(t).strip()]
        except Exception:
            tags_list = [t.strip() for t in tags_raw.split(",") if t.strip()]
    tags_json = json.dumps(tags_list, ensure_ascii=False) if tags_list else None

    # Génération thumbnail (best effort)
    thumb_name = None
    thumb_target = _thumb_dir(uid, prospect_id) / f"{stored_name}.png"
    if _generate_thumbnail(target, mime, thumb_target):
        thumb_name = thumb_target.name

    # Extraction texte PDF (best effort)
    extracted = ""
    if mime == "application/pdf":
        extracted = _extract_pdf_text(target)

    with _conn() as conn:
        cursor = conn.execute(
            """INSERT INTO prospect_attachments
               (prospect_id, owner_id, filename, original_name, size, mime_type, description,
                meeting_id, tags, thumbnail, extracted_text, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (prospect_id, uid, stored_name, safe_orig, len(data), mime, description or None,
             meeting_id, tags_json, thumb_name, extracted or None, now)
        )
        att_id = cursor.lastrowid

    return jsonify(
        ok=True, id=att_id, original_name=safe_orig, size=len(data),
        createdAt=now, has_thumbnail=bool(thumb_name), tags=tags_list
    )


@attachments_bp.get("/api/prospect/attachments")
def api_prospect_attachment_list():
    """Liste les pièces jointes d'un prospect (owner uniquement).

    Filtres : ?q= (search dans nom/description/extracted_text), ?tag= (filtre par tag).
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    prospect_id = request.args.get("prospect_id", type=int)
    q = (request.args.get("q") or "").strip()
    tag_filter = (request.args.get("tag") or "").strip()
    meeting_id_filter = request.args.get("meeting_id", type=int)
    if not prospect_id:
        return jsonify(ok=False, error="prospect_id requis"), 400
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403

    where = ["prospect_id = ?", "owner_id = ?"]
    params: list = [prospect_id, uid]
    if q:
        like = f"%{q}%"
        where.append("(original_name LIKE ? OR description LIKE ? OR extracted_text LIKE ? OR tags LIKE ?)")
        params.extend([like, like, like, like])
    if meeting_id_filter is not None:
        where.append("meeting_id = ?")
        params.append(meeting_id_filter)

    sql = f"""SELECT id, filename, original_name, size, mime_type, description, meeting_id,
                     tags, thumbnail, createdAt
              FROM prospect_attachments
              WHERE {' AND '.join(where)}
              ORDER BY createdAt DESC"""

    with _conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    attachments = []
    for r in rows:
        d = dict(r)
        try:
            d["tags"] = json.loads(d.get("tags") or "[]") or []
        except Exception:
            d["tags"] = []
        d["has_thumbnail"] = bool(d.get("thumbnail"))
        # Filtre tag (post-filtre car JSON)
        if tag_filter and tag_filter not in d["tags"]:
            continue
        d.pop("thumbnail", None)  # ne pas exposer le nom interne
        attachments.append(d)
    return jsonify(ok=True, attachments=attachments)


@attachments_bp.get("/api/prospect/attachments/<int:att_id>/thumb")
def api_prospect_attachment_thumb(att_id):
    """Sert la miniature d'une pièce jointe (PNG)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        row = conn.execute(
            "SELECT prospect_id, thumbnail FROM prospect_attachments WHERE id = ? AND owner_id = ?",
            (att_id, uid)
        ).fetchone()
    if not row or not row["thumbnail"]:
        return jsonify(ok=False, error="Miniature indisponible"), 404

    thumb_path = _thumb_dir(uid, row["prospect_id"]) / row["thumbnail"]
    if not thumb_path.exists():
        return jsonify(ok=False, error="Miniature introuvable"), 404
    return send_file(str(thumb_path), mimetype="image/png")


@attachments_bp.patch("/api/prospect/attachments/<int:att_id>")
def api_prospect_attachment_update(att_id):
    """Met à jour les métadonnées d'une pièce jointe : tags, description, meeting_id."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    body = request.get_json(silent=True) or {}

    sets = []
    vals: list = []
    if "tags" in body:
        tags_in = body.get("tags") or []
        if isinstance(tags_in, str):
            tags_in = [t.strip() for t in tags_in.split(",") if t.strip()]
        if not isinstance(tags_in, list):
            tags_in = []
        tags_in = [str(t).strip() for t in tags_in if str(t).strip()][:20]
        sets.append("tags = ?")
        vals.append(json.dumps(tags_in, ensure_ascii=False) if tags_in else None)
    if "description" in body:
        desc = (body.get("description") or "").strip()[:500] or None
        sets.append("description = ?")
        vals.append(desc)
    if "title" in body:
        new_title = (body.get("title") or "").strip()[:120] or None
        sets.append("title = ?")
        vals.append(new_title)
    if "meeting_id" in body:
        mid = body.get("meeting_id")
        if mid is not None and mid != "":
            try:
                mid = int(mid)
            except (TypeError, ValueError):
                return jsonify(ok=False, error="meeting_id invalide"), 400
        else:
            mid = None
        sets.append("meeting_id = ?")
        vals.append(mid)
    if not sets:
        return jsonify(ok=False, error="Aucun champ à modifier"), 400

    vals.extend([att_id, uid])
    with _conn() as conn:
        cur = conn.execute(
            f"UPDATE prospect_attachments SET {', '.join(sets)} WHERE id = ? AND owner_id = ?",
            vals
        )
        if cur.rowcount == 0:
            return jsonify(ok=False, error="Pièce jointe introuvable"), 404
    return jsonify(ok=True)


@attachments_bp.get("/api/prospect/attachments/<int:att_id>/file")
def api_prospect_attachment_file(att_id):
    """Sert le fichier d'une pièce jointe (téléchargement ou inline pour PDF/images)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM prospect_attachments WHERE id = ? AND owner_id = ?",
            (att_id, uid)
        ).fetchone()

    if not row:
        return jsonify(ok=False, error="Pièce jointe introuvable"), 404

    attach_dir = _attachment_dir(uid, row["prospect_id"])
    file_path = attach_dir / row["filename"]
    if not file_path.exists():
        return jsonify(ok=False, error="Fichier introuvable sur le serveur"), 404

    inline_mimes = {"application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"}
    disposition = "inline" if row["mime_type"] in inline_mimes else "attachment"

    return send_file(
        str(file_path),
        mimetype=row["mime_type"] or "application/octet-stream",
        as_attachment=(disposition == "attachment"),
        download_name=row["original_name"],
    )


@attachments_bp.delete("/api/prospect/attachments/<int:att_id>")
def api_prospect_attachment_delete(att_id):
    """Supprime une pièce jointe (fichier + miniature + enregistrement DB)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM prospect_attachments WHERE id = ? AND owner_id = ?",
            (att_id, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Pièce jointe introuvable"), 404

        attach_dir = _attachment_dir(uid, row["prospect_id"])
        file_path = attach_dir / row["filename"]
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception as e:
            logger.warning("[attachment] delete file error att=%s: %s", att_id, e)
        # Miniature
        thumb_name = row["thumbnail"] if "thumbnail" in row.keys() else None
        if thumb_name:
            try:
                tp = _thumb_dir(uid, row["prospect_id"]) / thumb_name
                if tp.exists():
                    tp.unlink()
            except Exception as e:
                logger.warning("[attachment] delete thumb error att=%s: %s", att_id, e)

        conn.execute("DELETE FROM prospect_attachments WHERE id = ? AND owner_id = ?", (att_id, uid))

    return jsonify(ok=True)
