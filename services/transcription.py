"""
ProspUp v32.1 — Transcription de réunions
==========================================

Pipeline 100% en arrière-plan (worker thread) :

  1. faster-whisper            → speech-to-text (GPU CUDA recommandé)
  2. pyannote.audio (3.1)      → diarisation (qui parle quand)
  3. fusion segments + speakers → transcript par orateur
  4. Anthropic Claude API      → analyse structurée (résumé, tâches, décisions…)

Les imports lourds (torch, faster_whisper, pyannote) sont **différés** :
si le serveur tourne sans GPU ou sans dépendances, l'app reste fonctionnelle
et on remonte un message d'erreur clair côté UI au moment du traitement.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger("prospup.transcription")

# Singletons modèles — chargés une seule fois (allouent VRAM)
_WHISPER_MODEL = None
_WHISPER_KEY: tuple[str, str, str] | None = None  # (model_name, device, compute_type)
_DIARIZATION_PIPELINE = None
_DIARIZATION_TOKEN: str | None = None
_MODELS_LOCK = threading.Lock()

# Lock global : on ne traite qu'un job à la fois (VRAM partagée)
_PROCESSING_LOCK = threading.Lock()


# ─── Chargement modèles (différés) ────────────────────────────────────


def _load_whisper(model_name: str, device: str, compute_type: str):
    """Charge faster-whisper en lazy init. Lève une exception explicite si manquant."""
    global _WHISPER_MODEL, _WHISPER_KEY
    key = (model_name, device, compute_type)
    with _MODELS_LOCK:
        if _WHISPER_MODEL is not None and _WHISPER_KEY == key:
            return _WHISPER_MODEL
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "faster-whisper n'est pas installé. Lancer : pip install faster-whisper"
            ) from e
        logger.info("Chargement Whisper model=%s device=%s compute=%s", model_name, device, compute_type)
        _WHISPER_MODEL = WhisperModel(model_name, device=device, compute_type=compute_type)
        _WHISPER_KEY = key
        return _WHISPER_MODEL


def _load_diarization(hf_token: str):
    """Charge pyannote/speaker-diarization-3.1 en lazy init. Token HF requis."""
    global _DIARIZATION_PIPELINE, _DIARIZATION_TOKEN
    with _MODELS_LOCK:
        if _DIARIZATION_PIPELINE is not None and _DIARIZATION_TOKEN == hf_token:
            return _DIARIZATION_PIPELINE
        if not hf_token:
            raise RuntimeError(
                "Token HuggingFace requis pour la diarisation. Configurer dans Paramètres > IA."
            )
        try:
            from pyannote.audio import Pipeline  # type: ignore
            import torch  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "pyannote.audio n'est pas installé. Lancer : pip install pyannote.audio"
            ) from e
        logger.info("Chargement pyannote/speaker-diarization-3.1")
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
        # Bascule sur GPU si dispo
        try:
            if torch.cuda.is_available():
                pipeline.to(torch.device("cuda"))
                logger.info("pyannote → CUDA")
        except Exception as exc:
            logger.warning("Impossible de basculer pyannote sur CUDA : %s", exc)
        _DIARIZATION_PIPELINE = pipeline
        _DIARIZATION_TOKEN = hf_token
        return pipeline


# ─── Étapes du pipeline ───────────────────────────────────────────────


def _whisper_transcribe(audio_path: str, model_name: str, device: str, compute_type: str,
                        progress_cb: Callable[[int, str], None]) -> tuple[list[dict], str, float]:
    """Transcrit l'audio. Retourne (segments, langue, durée_sec)."""
    progress_cb(15, "Chargement Whisper…")
    model = _load_whisper(model_name, device, compute_type)
    progress_cb(25, "Transcription en cours…")
    seg_iter, info = model.transcribe(
        audio_path,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    language = getattr(info, "language", "fr") or "fr"
    segments: list[dict] = []
    for seg in seg_iter:
        segments.append({
            "start": float(seg.start or 0),
            "end":   float(seg.end or 0),
            "text":  (seg.text or "").strip(),
        })
        if duration > 0:
            ratio = min(1.0, float(seg.end or 0) / duration)
            progress_cb(25 + int(40 * ratio), f"Transcription {int(ratio * 100)}%…")
    progress_cb(65, "Transcription terminée")
    return segments, language, duration


def _diarize(audio_path: str, hf_token: str, progress_cb: Callable[[int, str], None]) -> list[dict]:
    """Identifie les orateurs. Retourne une liste de tours { speaker, start, end }."""
    progress_cb(67, "Chargement pyannote…")
    pipeline = _load_diarization(hf_token)
    progress_cb(70, "Identification des orateurs…")
    diar = pipeline(audio_path)
    turns: list[dict] = []
    for turn, _, speaker in diar.itertracks(yield_label=True):
        turns.append({
            "speaker": str(speaker),
            "start":   float(turn.start),
            "end":     float(turn.end),
        })
    progress_cb(80, "Diarisation terminée")
    return turns


def _merge_segments_with_speakers(segments: list[dict], speaker_turns: list[dict]) -> list[dict]:
    """Attribue à chaque segment Whisper l'orateur dominant (overlap temporel max)."""
    if not speaker_turns:
        return [{**s, "speaker": "Speaker 1"} for s in segments]
    out: list[dict] = []
    for s in segments:
        s_start, s_end = s["start"], s["end"]
        best_speaker = "Speaker 1"
        best_overlap = 0.0
        for turn in speaker_turns:
            overlap = min(s_end, turn["end"]) - max(s_start, turn["start"])
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = turn["speaker"]
        out.append({**s, "speaker": best_speaker})
    return out


def _format_transcript_text(segments: list[dict]) -> str:
    """Formate un transcript lisible groupé par tour d'orateur."""
    if not segments:
        return ""
    lines: list[str] = []
    current_speaker: str | None = None
    buffer: list[str] = []
    start_time: float | None = None

    def flush():
        if current_speaker and buffer:
            ts = _fmt_timestamp(start_time or 0)
            lines.append(f"[{ts}] {current_speaker} : {' '.join(buffer).strip()}")

    for s in segments:
        sp = s.get("speaker", "Speaker 1")
        if sp != current_speaker:
            flush()
            current_speaker = sp
            buffer = [s["text"]]
            start_time = s["start"]
        else:
            buffer.append(s["text"])
    flush()
    return "\n".join(lines)


def _fmt_timestamp(seconds: float) -> str:
    seconds = max(0, int(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


# ─── Analyse Anthropic ────────────────────────────────────────────────


_ANALYSIS_SYSTEM_PROMPT = """Tu es un assistant expert en analyse de réunions B2B (prospection, vente, RH).
Tu reçois un transcript de réunion. Ton job :
1. Identifier les vrais participants (déduis prénoms/rôles à partir du contexte ; à défaut, garde les labels SPEAKER_xx).
2. Résumer fidèlement la réunion (3-5 phrases factuelles, sans inventer).
3. Lister les sujets abordés (titres courts).
4. Lister les décisions actées (claires, fermes).
5. Lister les tâches à faire (action + responsable + échéance si mentionnée).
6. Lister les prochaines étapes / RDV (si évoqués).
7. Évaluer le sentiment global (positif/neutre/négatif) et la qualité de la réunion.

Sois précis, concis, sans paraphrase inutile. N'invente rien : si une info n'est pas dans le transcript, écris "Non mentionné".

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ou après, au format exact suivant :
{
  "summary": "string (3-5 phrases)",
  "participants": [{"label": "SPEAKER_00", "guessed_name": "string|null", "guessed_role": "string|null"}],
  "topics": ["string"],
  "decisions": ["string"],
  "action_items": [{"task": "string", "assignee": "string|null", "due_date": "string|null", "priority": "haute|moyenne|basse"}],
  "next_steps": ["string"],
  "sentiment": "positif|neutre|négatif",
  "quality_score": 0-100,
  "key_quotes": ["string"]
}"""


def _call_anthropic(api_key: str, model: str, transcript: str, timeout: int = 180) -> dict:
    """Appelle l'API Messages d'Anthropic. Retourne le JSON parsé de l'analyse."""
    if not api_key:
        raise RuntimeError("Clé API Anthropic non configurée (Paramètres > IA).")
    user_msg = (
        "Voici le transcript d'une réunion (avec timestamps et orateurs). "
        "Analyse-le et retourne le JSON demandé.\n\n---\n"
        + transcript[:200_000]  # garde-fou ~200k chars (≈50k tokens)
    )
    body = json.dumps({
        "model": model,
        "max_tokens": 4096,
        "system": _ANALYSIS_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_msg}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    payload = json.loads(raw)
    chunks = payload.get("content") or []
    text = "".join(c.get("text", "") for c in chunks if c.get("type") == "text").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fallback : on extrait le premier bloc JSON
        i, j = text.find("{"), text.rfind("}")
        if i >= 0 and j > i:
            return json.loads(text[i:j + 1])
        raise


# ─── Worker — pipeline complet ────────────────────────────────────────


def process_transcription(
    transcription_id: int,
    audio_path: str,
    db_path: str,
    config: dict,
) -> None:
    """Pipeline complet : transcription → diarisation → analyse. Met à jour la DB en continu.

    Lock global : un seul job traité simultanément (la VRAM est partagée).
    Toutes les exceptions sont attrapées et stockées dans la colonne error_message.
    """
    if not _PROCESSING_LOCK.acquire(blocking=False):
        # Quelqu'un d'autre tourne déjà → on attend (file d'attente naturelle)
        logger.info("Job %s en file d'attente (autre transcription en cours)", transcription_id)
        _PROCESSING_LOCK.acquire()
    try:
        _process_locked(transcription_id, audio_path, db_path, config)
    finally:
        _PROCESSING_LOCK.release()


def _process_locked(transcription_id: int, audio_path: str, db_path: str, config: dict) -> None:
    def _update(**fields: Any) -> None:
        fields["updated_at"] = datetime.now().isoformat(timespec="seconds")
        cols = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [transcription_id]
        with sqlite3.connect(db_path, timeout=30) as conn:
            conn.execute(f"UPDATE transcriptions SET {cols} WHERE id=?;", vals)
            conn.commit()

    def _progress(pct: int, stage: str) -> None:
        _update(progress=max(0, min(100, int(pct))), stage=stage)

    try:
        if not Path(audio_path).exists():
            raise FileNotFoundError(f"Fichier audio introuvable : {audio_path}")

        _update(status="processing", progress=5, stage="Démarrage…", error_message=None)

        whisper_model = config.get("whisper_model", "large-v3")
        whisper_device = config.get("whisper_device", "cuda")
        whisper_compute = config.get("whisper_compute_type", "float16")
        diarize = bool(config.get("diarization_enabled", True))
        hf_token = (config.get("huggingface_token") or "").strip()
        anth_key = (config.get("anthropic_api_key") or "").strip()
        anth_model = (config.get("anthropic_model") or "claude-haiku-4-5").strip()

        # 1. Transcription
        segments, language, duration = _whisper_transcribe(
            audio_path, whisper_model, whisper_device, whisper_compute, _progress,
        )
        _update(
            language=language,
            duration_sec=duration,
            whisper_model=whisper_model,
        )

        # 2. Diarisation
        speaker_turns: list[dict] = []
        if diarize and hf_token:
            try:
                speaker_turns = _diarize(audio_path, hf_token, _progress)
            except Exception as exc:
                logger.warning("Diarisation échouée (job %s), poursuite sans : %s", transcription_id, exc)
                _progress(80, "Diarisation indisponible — un seul orateur")
        else:
            _progress(80, "Diarisation désactivée")

        # 3. Fusion
        segments = _merge_segments_with_speakers(segments, speaker_turns)
        transcript_text = _format_transcript_text(segments)
        speakers_set = sorted({s.get("speaker") for s in segments if s.get("speaker")})
        _update(
            segments_json=json.dumps(segments, ensure_ascii=False),
            speakers_json=json.dumps(list(speakers_set), ensure_ascii=False),
            transcript_text=transcript_text,
        )
        _progress(85, "Analyse Claude en cours…")

        # 4. Analyse Anthropic
        analysis: dict | None = None
        if anth_key and transcript_text.strip():
            try:
                analysis = _call_anthropic(anth_key, anth_model, transcript_text)
                _update(
                    analysis_json=json.dumps(analysis, ensure_ascii=False),
                    analysis_model=anth_model,
                )
            except urllib.error.HTTPError as e:
                err_body = ""
                try:
                    if e.fp:
                        err_body = e.read().decode("utf-8")
                except Exception:
                    pass
                logger.warning("Anthropic HTTP %s: %s", e.code, err_body[:300])
                _update(error_message=f"Analyse Claude échouée (HTTP {e.code}). Transcript disponible.")
            except Exception as exc:
                logger.warning("Anthropic analyse échouée : %s", exc)
                _update(error_message=f"Analyse Claude échouée : {exc}. Transcript disponible.")
        else:
            _update(error_message="Clé Anthropic absente — analyse non générée.")

        _update(
            status="done",
            progress=100,
            stage="Terminé",
            completed_at=datetime.now().isoformat(timespec="seconds"),
        )
        logger.info("Transcription %s terminée (durée=%.1fs, %d segments, %d orateurs)",
                    transcription_id, duration, len(segments), len(speakers_set))
    except Exception as exc:
        logger.exception("Transcription %s échouée", transcription_id)
        try:
            _update(
                status="error",
                error_message=str(exc),
                stage="Erreur",
            )
        except Exception:
            pass


def start_job_async(
    transcription_id: int,
    audio_path: str,
    db_path: str,
    config: dict,
) -> threading.Thread:
    """Démarre le pipeline dans un thread daemon. Retourne le thread (pour tests)."""
    t = threading.Thread(
        target=process_transcription,
        args=(transcription_id, audio_path, db_path, config),
        name=f"transcription-{transcription_id}",
        daemon=True,
    )
    t.start()
    return t


# ─── Re-prise des jobs interrompus (au démarrage app) ─────────────────


def resume_pending_jobs(db_path: str, config_loader: Callable[[], dict]) -> int:
    """Marque les jobs `processing` (orphelins suite à crash/restart) comme `error`.
    Les jobs `pending` restent en attente — ils seront repris manuellement par l'utilisateur.
    Retourne le nombre de jobs marqués."""
    n = 0
    try:
        with sqlite3.connect(db_path, timeout=10) as conn:
            cur = conn.execute(
                "UPDATE transcriptions SET status='error', "
                "error_message='Interrompu par redémarrage du serveur — relancer la transcription.', "
                "stage='Erreur' "
                "WHERE status IN ('processing','pending');"
            )
            n = cur.rowcount or 0
            conn.commit()
    except Exception as exc:
        logger.warning("resume_pending_jobs: %s", exc)
    if n:
        logger.info("Transcriptions interrompues marquées en erreur : %d", n)
    return n
