"""
ProspUp v32.1 — Blueprint Transcription de réunions

Routes :
  GET  /v30/transcription                     — Page liste (templates v30)
  GET  /v30/transcription/<id>                — Page détail
  POST /api/transcription/upload              — Upload audio + start job
  GET  /api/transcription                     — Liste des transcriptions de l'utilisateur
  GET  /api/transcription/<id>                — Détail (status + résultat)
  POST /api/transcription/<id>/retry          — Relance un job en erreur
  DELETE /api/transcription/<id>              — Soft delete
  GET  /api/transcription/<id>/audio          — Stream du fichier audio (lecture)
  GET  /api/transcription/<id>/export.txt     — Export texte plain
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from io import BytesIO
from pathlib import Path

from flask import Blueprint, Response, abort, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

from app import (
    APP_DIR,
    APP_VERSION,
    DB_PATH,
    _conn,
    _get_current_user,
    _load_ai_config,
    _uid,
    logger,
)
from services.transcription import resume_pending_jobs, start_job_async

transcription_bp = Blueprint("transcription", __name__)

ALLOWED_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".oga", ".mp4", ".webm", ".flac", ".aac"}
MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB
UPLOAD_DIR = APP_DIR / "data" / "audio_uploads"


def _audio_dir(uid: int) -> Path:
    d = UPLOAD_DIR / f"user_{uid}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9._ -]+", "", s).strip()
    s = re.sub(r"[\s_-]+", "_", s)
    return s[:80] or "audio"


def _row_to_dict(row) -> dict:
    if row is None:
        return {}
    d = dict(row)
    for k in ("segments_json", "speakers_json", "analysis_json"):
        v = d.get(k)
        if v:
            try:
                d[k.replace("_json", "")] = json.loads(v)
            except Exception:
                d[k.replace("_json", "")] = None
        else:
            d[k.replace("_json", "")] = None
        d.pop(k, None)
    d.pop("audio_path", None)  # path interne, pas exposé au front
    return d


# ─── Pages v30 ────────────────────────────────────────────────────────


@transcription_bp.get("/v30/transcription")
def page_transcription_list():
    uid = _uid()
    if not uid:
        return Response(status=302, headers={"Location": "/login"})
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"
    return render_template(
        "v30/transcription.html",
        active="transcription",
        crumbs=["Prosp'Up", "Transcription"],
        counts={},
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@transcription_bp.get("/v30/transcription/<int:tid>")
def page_transcription_detail(tid: int):
    uid = _uid()
    if not uid:
        return Response(status=302, headers={"Location": "/login"})
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, title FROM transcriptions WHERE id=? AND owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (tid, uid),
        ).fetchone()
    if not row:
        return Response(status=302, headers={"Location": "/v30/transcription"})
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"
    return render_template(
        "v30/transcription_detail.html",
        active="transcription",
        crumbs=[
            {"label": "Prosp'Up", "href": "/v30/dashboard"},
            {"label": "Transcription", "href": "/v30/transcription"},
            row["title"] or f"Transcription {tid}",
        ],
        counts={},
        pinned=[],
        user_initials=user_initials,
        transcription_id=tid,
        transcription_title=row["title"] or "",
        app_version=APP_VERSION,
    )


# ─── API ──────────────────────────────────────────────────────────────


@transcription_bp.post("/api/transcription/upload")
def api_upload():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if "audio" not in request.files:
        return jsonify(ok=False, error="Aucun fichier audio fourni (champ 'audio')."), 400
    file = request.files["audio"]
    if not file.filename:
        return jsonify(ok=False, error="Nom de fichier vide."), 400

    raw_name = secure_filename(file.filename) or "audio.mp3"
    ext = Path(raw_name).suffix.lower()
    if ext not in ALLOWED_EXT:
        return jsonify(ok=False, error=f"Format non supporté ({ext}). Formats acceptés : {', '.join(sorted(ALLOWED_EXT))}."), 400

    # Lecture taille (file.content_length n'est pas fiable côté multipart)
    file.stream.seek(0, 2)
    size = file.stream.tell()
    file.stream.seek(0)
    if size > MAX_UPLOAD_BYTES:
        return jsonify(ok=False, error=f"Fichier trop volumineux ({size // (1024*1024)} MB > 500 MB)."), 413
    if size <= 0:
        return jsonify(ok=False, error="Fichier vide."), 400

    title = (request.form.get("title") or Path(raw_name).stem or "Réunion").strip()[:200]

    # Stockage : data/audio_uploads/user_<uid>/<timestamp>_<slug><ext>
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_stem = _slugify(Path(raw_name).stem)
    dest = _audio_dir(uid) / f"{ts}_{safe_stem}{ext}"
    file.save(str(dest))

    now = datetime.now().isoformat(timespec="seconds")
    config = _load_ai_config()
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO transcriptions "
            "(title, audio_filename, audio_path, audio_size, status, progress, stage, "
            " whisper_model, analysis_model, owner_id, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'pending', 0, 'En attente', ?, ?, ?, ?, ?);",
            (
                title,
                raw_name,
                str(dest),
                size,
                config.get("whisper_model", "large-v3"),
                config.get("anthropic_model", "claude-haiku-4-5"),
                uid,
                now,
                now,
            ),
        )
        tid = cur.lastrowid
        conn.commit()

    # Démarrage job async
    start_job_async(tid, str(dest), str(DB_PATH), config)
    logger.info("Transcription %s démarrée par user %s (file=%s, %d bytes)", tid, uid, raw_name, size)
    return jsonify(ok=True, id=tid)


@transcription_bp.get("/api/transcription")
def api_list():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, title, audio_filename, audio_size, duration_sec, status, progress, stage, "
            "       error_message, language, whisper_model, analysis_model, "
            "       created_at, updated_at, completed_at "
            "FROM transcriptions "
            "WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') "
            "ORDER BY created_at DESC LIMIT 200;",
            (uid,),
        ).fetchall()
    items = [dict(r) for r in rows]
    return jsonify(ok=True, items=items)


@transcription_bp.get("/api/transcription/<int:tid>")
def api_detail(tid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM transcriptions "
            "WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') "
            "LIMIT 1;",
            (tid, uid),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Transcription introuvable"), 404
    return jsonify(ok=True, item=_row_to_dict(row))


@transcription_bp.post("/api/transcription/<int:tid>/retry")
def api_retry(tid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, audio_path, status FROM transcriptions "
            "WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (tid, uid),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Transcription introuvable"), 404
    if row["status"] == "processing":
        return jsonify(ok=False, error="Transcription en cours — patientez."), 409
    audio_path = row["audio_path"]
    if not audio_path or not Path(audio_path).exists():
        return jsonify(ok=False, error="Fichier audio introuvable sur le disque."), 410
    now = datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        conn.execute(
            "UPDATE transcriptions SET status='pending', progress=0, stage='En attente', "
            "error_message=NULL, completed_at=NULL, updated_at=? WHERE id=?;",
            (now, tid),
        )
        conn.commit()
    config = _load_ai_config()
    start_job_async(tid, audio_path, str(DB_PATH), config)
    return jsonify(ok=True)


@transcription_bp.delete("/api/transcription/<int:tid>")
def api_delete(tid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    now = datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE transcriptions SET deleted_at=? WHERE id=? AND owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='');",
            (now, tid, uid),
        )
        conn.commit()
    if cur.rowcount == 0:
        return jsonify(ok=False, error="Transcription introuvable"), 404
    return jsonify(ok=True)


@transcription_bp.get("/api/transcription/<int:tid>/audio")
def api_audio_stream(tid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT audio_path, audio_filename FROM transcriptions "
            "WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (tid, uid),
        ).fetchone()
    if not row or not row["audio_path"]:
        abort(404)
    path = Path(row["audio_path"])
    if not path.exists():
        abort(404)
    return send_file(str(path), as_attachment=False, download_name=row["audio_filename"] or path.name)


@transcription_bp.get("/api/transcription/<int:tid>/export.txt")
def api_export_txt(tid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT title, transcript_text, analysis_json, created_at "
            "FROM transcriptions WHERE id=? AND owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (tid, uid),
        ).fetchone()
    if not row:
        abort(404)
    parts: list[str] = []
    # 1. CR narratif (markdown) si disponible — c'est le format le plus utile
    narrative_md = ""
    if row["analysis_json"]:
        try:
            a = json.loads(row["analysis_json"])
            narrative_md = (a.get("narrative_markdown") or "").strip()
        except Exception:
            a = None
    if narrative_md:
        parts.append(narrative_md)
        parts += ["", "---", ""]
    else:
        parts += [f"# {row['title']}", f"Date : {row['created_at']}", ""]
        if row["analysis_json"]:
            try:
                a = json.loads(row["analysis_json"])
                if a.get("summary"):
                    parts += ["## Synthèse", a["summary"], ""]
                if a.get("decisions"):
                    parts += ["## Décisions"] + [f"- {d}" for d in a["decisions"]] + [""]
                if a.get("action_items"):
                    parts += ["## Tâches"]
                    for it in a["action_items"]:
                        line = f"- {it.get('task') or '?'}"
                        if it.get("assignee"): line += f" — {it['assignee']}"
                        if it.get("due_date"): line += f" (échéance : {it['due_date']})"
                        parts.append(line)
                    parts.append("")
                if a.get("next_steps"):
                    parts += ["## Prochaines étapes"] + [f"- {s}" for s in a["next_steps"]] + [""]
            except Exception:
                pass
    # 2. Transcript brut en annexe
    parts += ["## Transcript brut", "", row["transcript_text"] or "(vide)"]
    body = "\n".join(parts).encode("utf-8")
    safe = _slugify(row["title"] or f"transcription_{tid}")
    return send_file(
        BytesIO(body),
        mimetype="text/plain; charset=utf-8",
        as_attachment=True,
        download_name=f"{safe}.txt",
    )


# ─── Hook reprise au démarrage ───────────────────────────────────────


def init_resume() -> None:
    """À appeler depuis app.py après init_db pour marquer les jobs orphelins."""
    resume_pending_jobs(str(DB_PATH), _load_ai_config)
