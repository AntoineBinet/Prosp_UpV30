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

        # CRUCIAL : pyannote 4.x utilise huggingface_hub qui regarde EN
        # PRIORITÉ le token cache disque (~/.cache/huggingface/token) et
        # les variables d'environnement, AVANT le `token=` passé à
        # from_pretrained. Si le user a un autre token en cache (ex.
        # créé via `huggingface-cli login`), pyannote l'utilise et nous
        # voyons un 401 alors que notre token est valide. On force donc
        # à la fois l'env var et le login programmatique.
        os.environ["HF_TOKEN"] = hf_token
        os.environ["HUGGING_FACE_HUB_TOKEN"] = hf_token
        os.environ["HUGGINGFACE_HUB_TOKEN"] = hf_token
        try:
            from huggingface_hub import login as _hf_login  # type: ignore
            _hf_login(token=hf_token, add_to_git_credential=False, new_session=False)
            logger.info("HuggingFace login forcé OK")
        except Exception as exc:
            logger.warning("HuggingFace login programmatique a échoué (poursuite avec env vars) : %s", exc)

        try:
            from pyannote.audio import Pipeline  # type: ignore
            import torch  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "pyannote.audio n'est pas installé. Lancer : pip install pyannote.audio"
            ) from e
        logger.info("Chargement pyannote/speaker-diarization-3.1")
        # API du paramètre token a changé selon les versions de pyannote :
        #   pyannote.audio < 3.0 : use_auth_token
        #   pyannote.audio >= 3.0 : token
        # On essaie le nouveau nom d'abord puis on retombe sur l'ancien.
        pipeline = None
        last_err: Exception | None = None
        for kwargs in ({"token": hf_token}, {"use_auth_token": hf_token}, {"auth_token": hf_token}):
            try:
                pipeline = Pipeline.from_pretrained(
                    "pyannote/speaker-diarization-3.1",
                    **kwargs,
                )
                break
            except TypeError as e:
                last_err = e
                continue
        if pipeline is None:
            raise RuntimeError(
                f"Impossible de charger pyannote (signature from_pretrained inconnue) : {last_err}"
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


_ANALYSIS_SYSTEM_PROMPT = """Tu es un expert en rédaction de comptes-rendus de réunions B2B \
(prospection commerciale, entretiens de recrutement, RDV clients).

Tu reçois un transcript de réunion (avec timestamps et orateurs si la diarisation a fonctionné).
Ton job est de produire un compte-rendu DÉTAILLÉ et NARRATIF, comme un journaliste professionnel \
qui relate fidèlement la rencontre. Le format attendu est inspiré des CR Genspark / Otter Pilot : \
**un titre descriptif**, **une synthèse longue**, puis **10 à 25 sections H2 thématiques** \
chacune avec 1-3 paragraphes de prose narrative (PAS juste des bullets).

═══════════════════════════════════════════════════════════════════════
RÈGLES DE FIDÉLITÉ (NON NÉGOCIABLES)
═══════════════════════════════════════════════════════════════════════
- N'invente JAMAIS d'information. Si quelque chose n'est pas dans le transcript, ne le mentionne pas.
- Garde les chiffres, noms d'entreprises, noms de personnes, lieux, technologies, dates EXACTS.
- Si tu n'es pas sûr d'un mot (transcription Whisper imparfaite), garde l'orthographe la plus probable.
- Pas de paraphrase inutile, pas de remplissage. Concis mais complet.

═══════════════════════════════════════════════════════════════════════
STRUCTURE NARRATIVE ATTENDUE (markdown)
═══════════════════════════════════════════════════════════════════════
Le champ `narrative_markdown` doit contenir un compte-rendu COMPLET au format markdown :

# {Titre principal contextuel}

## Synthèse de la réunion

Paragraphe de 4-8 phrases relatant globalement la réunion : qui, quoi, pourquoi, \
quels sujets, quelles décisions clés, quelle conclusion.

## {Section thématique 1, ex. "Présentation du candidat"}

Paragraphe(s) narratif(s). Tu peux insérer ponctuellement des bullets si une liste \
est plus claire (compétences, options, etc.), mais la majorité du CR est en prose.

## {Section thématique 2, ex. "Parcours académique"}

...

## {... 10 à 25 sections, structurées par sujet, dans l'ordre logique de la réunion}

## Prochaines étapes

Récap des actions / suivis convenus.

═══════════════════════════════════════════════════════════════════════
EXEMPLES DE TITRES DE SECTIONS POUR ENTRETIEN RH
═══════════════════════════════════════════════════════════════════════
- Synthèse de l'entretien
- Présentation du candidat — Parcours académique
- Stage / Première expérience chez {entreprise}
- Rôle d'{poste} chez {entreprise}
- Compétences techniques et outils maîtrisés
- Aspirations professionnelles
- Présentation de l'entreprise {ESN}
- Modèle de management et suivi des consultants
- Discussion sur la rémunération et avantages
- Mission proposée chez {client}
- Contexte et objectifs de la mission
- Responsabilités détaillées du poste
- Intérêt du candidat pour la mission
- Disponibilité et situation
- Expériences passées avec d'autres ESN
- Processus de recrutement et prochaines étapes
- Évaluation interne post-entretien (si mentionnée)

═══════════════════════════════════════════════════════════════════════
FORMATAGE MARKDOWN
═══════════════════════════════════════════════════════════════════════
- Mets en **gras** : noms d'entreprises, technologies, chiffres clés (salaires, durées, dates).
- Utilise des bullets `- ` ou listes numérotées `1.` quand c'est plus clair qu'un paragraphe.
- Italique `*...*` pour les citations courtes intégrées au texte.
- Évite les titres H3/H4, reste sur H2 pour la lisibilité.

═══════════════════════════════════════════════════════════════════════
RÉPONDS UNIQUEMENT PAR UN OBJET JSON VALIDE (rien avant ni après)
═══════════════════════════════════════════════════════════════════════
{
  "title": "Titre descriptif et contextuel de la réunion",
  "synthesis": "Paragraphe synthèse de 4-8 phrases factuelles",
  "narrative_markdown": "Compte-rendu complet en markdown, du # titre jusqu'à la dernière section",
  "participants": [{"label": "SPEAKER_00", "guessed_name": "string|null", "guessed_role": "string|null"}],
  "topics": ["string court"],
  "decisions": ["string"],
  "action_items": [{"task": "string", "assignee": "string|null", "due_date": "string|null", "priority": "haute|moyenne|basse"}],
  "next_steps": ["string"],
  "sentiment": "positif|neutre|négatif",
  "quality_score": 0-100,
  "key_quotes": ["string courte du transcript"]
}"""


# Plafond max_tokens connu par modèle (output). À adapter si Anthropic
# augmente les limites. Valeur conservatrice : on prend la borne la plus
# basse documentée.
_MAX_TOKENS_BY_MODEL = {
    "claude-haiku-4-5":  8192,
    "claude-sonnet-4-6": 16000,
    "claude-opus-4-7":   16000,
    # Anciennes versions au cas où
    "claude-3-5-haiku-latest":   8192,
    "claude-3-5-sonnet-latest":  8192,
}


# v32.9 — Prompts Ollama optimisés. Stratégie en 2 passes pour les longs
# transcripts (>4000 tokens) : on chunk en morceaux de ~3000 tokens, on
# extrait un mini-CR factuel par chunk, puis on synthétise. Plus fiable
# que demander direct un CR de 25 sections à un 7-8B.
_OLLAMA_CHUNK_PROMPT = """Tu reçois un EXTRAIT de transcript de réunion B2B. Extrais les faits importants AU FORMAT MARKDOWN structuré, sans paraphrase.

RÈGLES STRICTES :
- N'INVENTE RIEN : si une info n'est pas dans l'extrait, ne la mentionne pas.
- Garde les chiffres, noms, lieux, technologies EXACTS.
- Sois BREF — ce sera synthétisé après.

Format de sortie (markdown, pas de JSON) :

**Sujets abordés dans cet extrait** :
- bullet 1
- bullet 2

**Faits / chiffres mentionnés** :
- bullet (avec le chiffre/nom exact)

**Décisions / accords** :
- bullet (ou "Aucune" si rien)

**Tâches mentionnées** :
- bullet (ou "Aucune")

Extrait :
"""


_OLLAMA_SYNTHESIZE_PROMPT = """Tu reçois plusieurs notes factuelles extraites d'un transcript de réunion (chronologiquement). Rédige un COMPTE-RENDU narratif et DÉTAILLÉ au format markdown.

Structure :
# {Titre descriptif court de la réunion}

## Synthèse
Paragraphe de 4-8 phrases qui résume globalement la réunion.

## {Section thématique 1}
Paragraphe(s) narratif(s).

## {Section thématique 2}
...

(8 à 15 sections H2 typiquement)

## Prochaines étapes
Liste à puces des actions / suivis.

RÈGLES STRICTES :
- Ne mentionne QUE ce qui est dans les notes — n'invente rien.
- Garde les chiffres, noms, lieux EXACTS.
- Mets en **gras** noms d'entreprises, technologies, chiffres.
- Réponds uniquement par le markdown, pas de balises ```.

Notes factuelles :
"""


_OLLAMA_DIRECT_PROMPT = """Tu es un expert en rédaction de comptes-rendus de réunions B2B.

À partir du transcript ci-dessous, rédige un CR détaillé et NARRATIF au format markdown :
- Un titre H1
- Une section `## Synthèse` (4-8 phrases)
- 8-15 sections H2 thématiques (1-2 paragraphes de prose chacune, pas seulement des bullets)
- Une section `## Prochaines étapes`

RÈGLES STRICTES :
- N'INVENTE RIEN — tout doit venir du transcript.
- Garde noms / chiffres / lieux EXACTS.
- Mets en **gras** noms d'entreprises, technologies, chiffres clés.
- Réponds uniquement par le markdown, pas de balises ```.

Transcript :
"""


def _call_ollama_for_analysis(transcript: str, config: dict, timeout: int = 300) -> dict:
    """Analyse Ollama avec stratégie adaptée à la longueur :
    - transcript court (<12 000 caractères ≈ 3000 tokens) → 1 passe directe
    - transcript long → chunking en morceaux + synthèse

    NOTE : la qualité reste tributaire du modèle Ollama. llama3.2:3B
    hallucine sur les longs CR, qwen2.5:7b et llama3.1:8b sont nettement
    meilleurs. À documenter dans l'UI.
    """
    from app import _call_ollama_direct  # type: ignore

    text = (transcript or "").strip()
    if not text:
        return {"narrative_markdown": ""}

    # ─── Passe directe si court ───
    if len(text) < 12_000:
        prompt = _OLLAMA_DIRECT_PROMPT + text[:200_000]
        out = (_call_ollama_direct(prompt, config, timeout) or "").strip()
        if out.startswith("```"):
            out = out.strip("`").lstrip("markdown\n").lstrip("md\n").strip()
        return _wrap_ollama_markdown(out)

    # ─── Chunking + synthèse pour les longs ───
    logger.info("Ollama analyse en 2 passes (transcript %d chars)", len(text))
    chunk_size = 9000  # ~2200 tokens
    chunks: list[str] = []
    i = 0
    while i < len(text):
        # Coupe à un saut de ligne / fin de phrase si possible (±300 chars)
        end = min(len(text), i + chunk_size)
        if end < len(text):
            cut = text.rfind("\n", i, end)
            if cut < 0 or cut - i < chunk_size - 600:
                cut = text.rfind(". ", i, end)
            if cut > i:
                end = cut + 1
        chunks.append(text[i:end].strip())
        i = end
    logger.info("Ollama : %d chunks", len(chunks))

    notes: list[str] = []
    for idx, ch in enumerate(chunks):
        try:
            note = _call_ollama_direct(_OLLAMA_CHUNK_PROMPT + ch, config, timeout)
            if note and note.strip():
                notes.append(f"### Extrait {idx + 1}/{len(chunks)}\n\n" + note.strip())
        except Exception as exc:
            logger.warning("Ollama chunk %d échoué : %s", idx, exc)

    if not notes:
        return {"narrative_markdown": "(Ollama n'a rien produit. Vérifie qu'Ollama tourne et que le modèle est chargé.)"}

    # Synthèse finale
    notes_blob = "\n\n".join(notes)
    if len(notes_blob) > 30_000:
        notes_blob = notes_blob[:30_000]
    final = (_call_ollama_direct(_OLLAMA_SYNTHESIZE_PROMPT + notes_blob, config, timeout) or "").strip()
    if final.startswith("```"):
        final = final.strip("`").lstrip("markdown\n").lstrip("md\n").strip()
    return _wrap_ollama_markdown(final)


def _wrap_ollama_markdown(md: str) -> dict:
    """Encapsule un markdown brut dans un dict d'analyse compatible avec
    le schéma standard."""
    return {
        "narrative_markdown": md,
        "title": None,
        "synthesis": None,
        "participants": [],
        "topics": [],
        "decisions": [],
        "action_items": [],
        "next_steps": [],
        "key_quotes": [],
        "sentiment": "neutre",
        "quality_score": None,
    }


def _call_anthropic(api_key: str, model: str, transcript: str, timeout: int = 240) -> dict:
    """Appelle l'API Messages d'Anthropic. Retourne le JSON parsé de l'analyse."""
    if not api_key:
        raise RuntimeError("Clé API Anthropic non configurée (Paramètres > IA).")
    user_msg = (
        "Voici le transcript d'une réunion (avec timestamps et orateurs). "
        "Analyse-le et retourne le JSON demandé. "
        "N'oublie pas le champ narrative_markdown qui doit contenir le CR complet "
        "structuré en sections H2 narratives.\n\n---\n"
        + transcript[:300_000]  # garde-fou ~300k chars (≈75k tokens)
    )
    # Le max_tokens dépend du modèle : Haiku 4.5 plafonne à 8192,
    # Sonnet/Opus permettent plus. Si modèle inconnu, on prend la valeur
    # la plus conservatrice.
    max_tokens = _MAX_TOKENS_BY_MODEL.get(model, 8192)
    body = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
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
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        # Capture le message d'erreur Anthropic structuré pour qu'il
        # remonte proprement aux callers.
        err_body = ""
        try:
            if e.fp:
                err_body = e.read().decode("utf-8")
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
        raise RuntimeError(
            f"HTTP {e.code} : {api_msg or err_body[:300] or 'erreur Anthropic inconnue'}"
        ) from e
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


# ─── Helper analyse avec fallback Ollama ──────────────────────────────


def run_analysis_with_fallback(transcript_text: str, config: dict) -> tuple[dict | None, str | None]:
    """Tente Claude. Fallback Ollama UNIQUEMENT si activé explicitement
    (`transcription_fallback_ollama=True`).

    Pure function — aucune écriture DB.
    Retourne (analysis_dict_or_None, error_message_or_None).
    L'analysis dict inclut `_provider` ('anthropic' ou 'ollama') et
    éventuellement `_fallback_reason`.

    Note v32.8 : le fallback Ollama est désactivé par défaut car
    llama3.2:3B (modèle par défaut) produit des CR truffés
    d'hallucinations sur les longs transcripts. Mieux vaut une erreur
    claire qu'un faux CR.
    """
    if not (transcript_text or "").strip():
        return None, "Transcript vide — analyse impossible."
    anth_key = (config.get("anthropic_api_key") or "").strip()
    anth_model = (config.get("anthropic_model") or "claude-haiku-4-5").strip()
    fallback_tx = bool(config.get("transcription_fallback_ollama", False))

    # 1. Tentative Claude
    if anth_key:
        try:
            analysis = _call_anthropic(anth_key, anth_model, transcript_text)
            analysis["_provider"] = "anthropic"
            analysis["_model_used"] = anth_model
            return analysis, None
        except Exception as exc:
            claude_msg = str(exc)
            logger.warning("Claude analyse échouée : %s", claude_msg)
            low = claude_msg.lower()
            is_credit_err = (
                "credit balance" in low
                or "insufficient" in low
                or "quota" in low
                or "billing" in low
            )
    else:
        claude_msg = "Clé Anthropic non configurée"
        is_credit_err = False

    # 2. Fallback Ollama UNIQUEMENT si activé
    if not fallback_tx:
        suffix = (
            " Recharge des crédits sur console.anthropic.com/settings/billing "
            "puis clique « Re-analyser (Claude seul) »."
            if is_credit_err
            else " Vérifie la clé / le modèle dans Paramètres > IA puis « Re-analyser »."
        )
        return None, f"Analyse Claude KO : {claude_msg[:300]}.{suffix}"

    logger.info("Bascule sur Ollama (raison Claude : %s)", claude_msg[:200])
    try:
        analysis = _call_ollama_for_analysis(transcript_text, config)
        analysis["_provider"] = "ollama"
        analysis["_model_used"] = config.get("ollama_model", "ollama")
        analysis["_fallback_reason"] = (
            "Crédits Claude épuisés" if is_credit_err
            else f"Claude indisponible : {claude_msg[:200]}"
        )
        msg = (
            "⚠ Analyse Ollama (fallback) — qualité moindre, peut contenir des hallucinations. "
            f"Raison : {analysis['_fallback_reason']}"
        )
        return analysis, msg
    except Exception as ollama_exc:
        logger.warning("Fallback Ollama aussi échoué : %s", ollama_exc)
        return None, (
            f"Claude KO : {claude_msg[:200]}. Fallback Ollama KO : {ollama_exc}."
        )


def _run_analysis_with_fallback(
    transcript_text: str,
    anth_key: str,
    anth_model: str,
    config: dict,
    update_fn,
) -> tuple[dict | None, str | None]:
    """Wrapper qui appelle run_analysis_with_fallback() et persiste le
    résultat via update_fn(analysis_json=..., analysis_model=...)."""
    analysis, err_msg = run_analysis_with_fallback(transcript_text, config)
    if analysis is not None:
        update_fn(
            analysis_json=json.dumps(analysis, ensure_ascii=False),
            analysis_model=str(analysis.get("_model_used") or anth_model),
        )
    return analysis, err_msg


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
        diarization_warning: str | None = None
        if diarize and hf_token:
            try:
                speaker_turns = _diarize(audio_path, hf_token, _progress)
            except Exception as exc:
                err_str = str(exc)
                logger.warning("Diarisation échouée (job %s) : %s", transcription_id, err_str)
                # Détection des erreurs courantes pour aider l'utilisateur
                low = err_str.lower()
                if "401" in err_str or "unauthorized" in low or "403" in err_str:
                    diarization_warning = (
                        "Diarisation échouée : token HuggingFace rejeté (401/403). "
                        "Vérifie que tu as accepté les conditions d'utilisation sur "
                        "https://huggingface.co/pyannote/speaker-diarization-3.1 et "
                        "https://huggingface.co/pyannote/segmentation-3.0 (bouton « Agree and access repository »)."
                    )
                elif "out of memory" in low or "cuda out of memory" in low or "oom" in low:
                    diarization_warning = (
                        "Diarisation échouée : VRAM saturée. Whisper large-v3 prend déjà ~3 GB, "
                        "pyannote en demande +1-2 GB. Bascule sur Whisper large-v3-turbo ou medium "
                        "dans Paramètres > IA > Modèle Whisper."
                    )
                elif "repositorynotfounderror" in low or "404" in err_str or "gated" in low:
                    diarization_warning = (
                        "Diarisation échouée : modèle pyannote inaccessible. Conditions d'utilisation "
                        "à accepter sur huggingface.co/pyannote/speaker-diarization-3.1 ET "
                        "huggingface.co/pyannote/segmentation-3.0."
                    )
                else:
                    diarization_warning = f"Diarisation échouée : {err_str[:300]}"
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

        # 4. Analyse — Anthropic en priorité, Ollama en fallback
        analysis, analysis_error = _run_analysis_with_fallback(
            transcript_text, anth_key, anth_model, config, _update,
        )

        # Concaténer les warnings dans error_message (séparés par \n\n)
        warnings_msg = "\n\n".join([w for w in (diarization_warning, analysis_error) if w])
        if warnings_msg:
            _update(error_message=warnings_msg)

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
