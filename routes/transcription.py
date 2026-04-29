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


@transcription_bp.get("/api/transcription/preflight")
def api_preflight():
    """Pre-flight check appelé par le front AVANT l'upload pour éviter
    de lancer 10 min de Whisper si une dépendance critique est KO.

    Retourne :
      {
        "ok": bool,                  # True si tout est vert (au moins le minimum)
        "claude": {ok, error?, model},
        "huggingface": {ok, error?, user?, type?},
        "gpu": {ok, device?, vram_gb?},
        "fallback_ollama_active": bool,
        "warnings": [strings]        # avertissements non bloquants
      }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    config = _load_ai_config()
    out: dict = {
        "claude":       {"ok": False},
        "huggingface":  {"ok": False},
        "gpu":          {"ok": False},
        "fallback_ollama_active": bool(config.get("transcription_fallback_ollama", False)),
        "warnings": [],
    }

    # ─── Claude (test léger : 10 tokens via /messages) ──
    anth_key = (config.get("anthropic_api_key") or "").strip()
    anth_model = (config.get("anthropic_model") or "claude-haiku-4-5").strip()
    out["claude"]["model"] = anth_model
    if not anth_key:
        out["claude"]["error"] = "Clé Anthropic non configurée"
    else:
        try:
            import urllib.request as _u, urllib.error as _ue
            body = json.dumps({
                "model": anth_model,
                "max_tokens": 10,
                "messages": [{"role": "user", "content": "OK"}],
            }).encode("utf-8")
            req = _u.Request(
                "https://api.anthropic.com/v1/messages",
                data=body,
                headers={
                    "x-api-key": anth_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                method="POST",
            )
            with _u.urlopen(req, timeout=15) as resp:
                resp.read()
            out["claude"]["ok"] = True
        except _ue.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8") if e.fp else ""
            except Exception:
                pass
            api_msg = ""
            try:
                err_data = json.loads(err_body) if err_body else {}
                err_obj = err_data.get("error", {})
                if isinstance(err_obj, dict):
                    api_msg = err_obj.get("message") or ""
            except Exception:
                api_msg = err_body[:300]
            low = api_msg.lower()
            if "credit" in low or "billing" in low or "insufficient" in low:
                out["claude"]["error"] = "credits_exhausted"
                out["claude"]["error_msg"] = api_msg
            elif e.code in (401, 403):
                out["claude"]["error"] = "invalid_key"
                out["claude"]["error_msg"] = api_msg
            else:
                out["claude"]["error"] = f"http_{e.code}"
                out["claude"]["error_msg"] = api_msg
        except Exception as e:
            out["claude"]["error"] = "network"
            out["claude"]["error_msg"] = str(e)

    # ─── HuggingFace (HEAD config.yaml sur les 2 modèles pyannote) ──
    diarize = bool(config.get("diarization_enabled", True))
    if not diarize:
        out["huggingface"]["ok"] = True  # désactivé = pas un blocage
        out["huggingface"]["skipped"] = True
    else:
        hf_token = (config.get("huggingface_token") or "").strip()
        if not hf_token:
            out["huggingface"]["error"] = "Token HF non configuré (diarisation activée)"
        else:
            import urllib.request as _u2, urllib.error as _ue2
            # 3 repos requis par pyannote.audio 4.x :
            #  - speaker-diarization-3.1 (pipeline)
            #  - segmentation-3.0 (modèle de segmentation)
            #  - speaker-diarization-community-1 (embeddings, chargé en cascade)
            # Tester les 3 fichiers les plus représentatifs (config.yaml ou pytorch_model)
            checks = (
                ("pyannote/speaker-diarization-3.1",          "config.yaml"),
                ("pyannote/segmentation-3.0",                 "config.yaml"),
                ("pyannote/speaker-diarization-community-1",  "config.yaml"),
            )
            ok_count = 0
            missing_repos: list[str] = []
            errs: list[str] = []
            for repo, fname in checks:
                try:
                    req = _u2.Request(
                        f"https://huggingface.co/{repo}/resolve/main/{fname}",
                        headers={"Authorization": f"Bearer {hf_token}"},
                        method="HEAD",
                    )
                    with _u2.urlopen(req, timeout=10):
                        ok_count += 1
                except _ue2.HTTPError as e:
                    if e.code in (401, 403):
                        missing_repos.append(repo)
                    errs.append(f"{repo} HTTP {e.code}")
                except Exception as e:
                    errs.append(f"{repo}: {e}")
            if ok_count == len(checks):
                out["huggingface"]["ok"] = True
            else:
                out["huggingface"]["error"] = "; ".join(errs)
                if missing_repos:
                    out["huggingface"]["missing_repos"] = missing_repos

    # ─── GPU CUDA via /api/deploy/install-torch-cuda/status interne ──
    try:
        import torch  # type: ignore
        out["gpu"]["torch_version"] = getattr(torch, "__version__", "?")
        out["gpu"]["ok"] = bool(torch.cuda.is_available())
        if out["gpu"]["ok"]:
            out["gpu"]["device"] = torch.cuda.get_device_name(0)
            try:
                out["gpu"]["vram_gb"] = round(
                    torch.cuda.get_device_properties(0).total_memory / 1024**3, 1
                )
            except Exception:
                pass
    except Exception as e:
        out["gpu"]["error"] = str(e)

    # ─── Verdict global ──
    # Le strict minimum pour lancer une transcription : Claude OK
    # (sinon le CR sera vide ou bidon, sauf si fallback explicite).
    # GPU et HF sont des « nice to have » : Whisper marche en CPU,
    # diar peut être désactivée.
    fallback_ok = out["fallback_ollama_active"]
    out["ok"] = bool(out["claude"]["ok"] or fallback_ok)
    if not out["claude"]["ok"] and fallback_ok:
        out["warnings"].append(
            "⚠ Claude indisponible — l'analyse utilisera Ollama (qualité moindre, hallucinations possibles)."
        )
    if not out["gpu"]["ok"]:
        out["warnings"].append(
            "⚠ GPU CUDA non détecté — Whisper tournera en CPU (5-10× plus lent)."
        )
    if diarize and not out["huggingface"]["ok"]:
        out["warnings"].append(
            "⚠ HuggingFace KO — diarisation indisponible (1 seul orateur, transcript sans labels)."
        )
    return jsonify(out)


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


@transcription_bp.post("/api/transcription/<int:tid>/reanalyze")
def api_reanalyze(tid: int):
    """Re-lance UNIQUEMENT l'analyse Claude sur le transcript existant.

    Cas d'usage : on a changé le prompt système ou le modèle Claude,
    et on veut une nouvelle analyse sans re-faire Whisper / pyannote
    (qui prend plusieurs minutes).
    """
    import threading
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, transcript_text, status FROM transcriptions "
            "WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (tid, uid),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Transcription introuvable"), 404
    if row["status"] == "processing":
        return jsonify(ok=False, error="Transcription en cours — patientez."), 409
    transcript_text = (row["transcript_text"] or "").strip()
    if not transcript_text:
        return jsonify(ok=False, error="Pas de transcript à analyser. Utilise « Relancer pipeline » pour re-transcrire."), 400

    config = _load_ai_config()
    anth_key = (config.get("anthropic_api_key") or "").strip()
    fallback_enabled = bool(config.get("fallback_enabled", True))
    if not anth_key and not fallback_enabled:
        return jsonify(ok=False, error="Clé Anthropic non configurée et fallback Ollama désactivé."), 400
    anth_model = (config.get("anthropic_model") or "claude-haiku-4-5").strip()

    # Marque comme « processing » + stage spécifique
    now = datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        conn.execute(
            "UPDATE transcriptions SET status='processing', progress=85, stage='Re-analyse Claude/Ollama…', "
            "error_message=NULL, updated_at=? WHERE id=?;",
            (now, tid),
        )
        conn.commit()

    def _bg() -> None:
        from services.transcription import run_analysis_with_fallback
        analysis, err_msg = run_analysis_with_fallback(transcript_text, config)
        done_at = datetime.now().isoformat(timespec="seconds")
        if analysis is not None:
            model_used = str(analysis.get("_model_used") or anth_model)
            with _conn() as c2:
                c2.execute(
                    "UPDATE transcriptions SET status='done', progress=100, stage='Terminé', "
                    "analysis_json=?, analysis_model=?, error_message=?, "
                    "completed_at=?, updated_at=? WHERE id=?;",
                    (
                        json.dumps(analysis, ensure_ascii=False),
                        model_used,
                        err_msg,  # peut être un msg "soft" même quand l'analyse a réussi (fallback)
                        done_at,
                        done_at,
                        tid,
                    ),
                )
                c2.commit()
            logger.info("Re-analyse %s terminée (provider=%s, model=%s)",
                        tid, analysis.get("_provider"), model_used)
        else:
            with _conn() as c2:
                c2.execute(
                    "UPDATE transcriptions SET status='done', progress=100, stage='Terminé', "
                    "error_message=?, completed_at=?, updated_at=? WHERE id=?;",
                    (err_msg or "Analyse échouée", done_at, done_at, tid),
                )
                c2.commit()

    t = threading.Thread(target=_bg, name=f"reanalyze-{tid}", daemon=True)
    t.start()
    return jsonify(ok=True)


@transcription_bp.get("/api/transcription/<int:tid>/external-prompt")
def api_external_prompt(tid: int):
    """Retourne le prompt complet (system + transcript) prêt à coller dans
    une IA externe (claude.ai, ChatGPT, Gemini, …). Utile quand l'API
    Anthropic n'a pas de crédits mais qu'on a un compte Claude.ai web."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT title, transcript_text FROM transcriptions "
            "WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (tid, uid),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Transcription introuvable"), 404
    transcript = (row["transcript_text"] or "").strip()
    if not transcript:
        return jsonify(ok=False, error="Pas de transcript disponible (transcription pas encore finie ?)."), 400

    # Import différé pour récupérer le prompt système actuel
    from services.transcription import _ANALYSIS_SYSTEM_PROMPT  # type: ignore

    full_prompt = (
        _ANALYSIS_SYSTEM_PROMPT
        + "\n\n═══════════════════════════════════════════════════════════════════════\n"
        + "TRANSCRIPT À ANALYSER\n"
        + "═══════════════════════════════════════════════════════════════════════\n\n"
        + transcript
    )
    return jsonify(
        ok=True,
        title=row["title"],
        prompt=full_prompt,
        transcript_length=len(transcript),
        approx_tokens=len(transcript) // 4,  # rough approx
    )


@transcription_bp.post("/api/transcription/<int:tid>/external-analysis")
def api_external_analysis(tid: int):
    """Reçoit la réponse d'une IA externe (collée par l'utilisateur),
    parse le JSON et stocke comme analysis_json. Tolérant : accepte le
    JSON brut, dans des balises ```json, ou du markdown pur (auto-emballé
    dans narrative_markdown)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    raw_text = (payload.get("response_text") or "").strip()
    source = (payload.get("source") or "external").strip()[:80]
    if not raw_text:
        return jsonify(ok=False, error="Réponse vide. Colle la sortie complète de l'IA."), 400

    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM transcriptions WHERE id=? AND owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (tid, uid),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Transcription introuvable"), 404

    # ─── Parse robuste ────────────────────────────────────────────────
    # 1. Essaye d'extraire un JSON (avec ou sans balises markdown)
    text = raw_text
    if "```" in text:
        # Cherche un bloc ```json ... ``` ou ``` ... ```
        import re as _re
        m = _re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, _re.DOTALL)
        if m:
            text = m.group(1).strip()
    analysis: dict | None = None
    try:
        analysis = json.loads(text)
        if not isinstance(analysis, dict):
            analysis = None
    except json.JSONDecodeError:
        # 2. Tente d'extraire le bloc {...} le plus large
        i, j_ = text.find("{"), text.rfind("}")
        if i >= 0 and j_ > i:
            try:
                cand = json.loads(text[i:j_ + 1])
                if isinstance(cand, dict):
                    analysis = cand
            except json.JSONDecodeError:
                pass

    if analysis is None:
        # 3. Fallback : on traite l'ensemble comme du markdown narratif
        # (cas où l'IA a renvoyé un CR sans wrapper JSON)
        analysis = {
            "title": None,
            "synthesis": None,
            "narrative_markdown": raw_text,
            "participants": [],
            "topics": [],
            "decisions": [],
            "action_items": [],
            "next_steps": [],
            "sentiment": "neutre",
            "quality_score": None,
            "key_quotes": [],
        }

    # Marqueurs de provenance
    analysis["_provider"] = "external"
    analysis["_model_used"] = source
    analysis.pop("_fallback_reason", None)

    now = datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        conn.execute(
            "UPDATE transcriptions SET status='done', progress=100, stage='Terminé', "
            "analysis_json=?, analysis_model=?, error_message=NULL, "
            "completed_at=?, updated_at=? WHERE id=?;",
            (
                json.dumps(analysis, ensure_ascii=False),
                source,
                now,
                now,
                tid,
            ),
        )
        conn.commit()
    logger.info("Analyse externe collée pour %s (source=%s)", tid, source)
    return jsonify(ok=True, applied=True, has_narrative=bool(analysis.get("narrative_markdown")))


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
