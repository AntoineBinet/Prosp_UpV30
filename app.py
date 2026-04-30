from __future__ import annotations

import json
import sqlite3
from io import BytesIO
from copy import copy
import datetime
import csv
import re
import sys
import unicodedata
import shutil
import zipfile
import threading
import time
import difflib
import math
from pathlib import Path
from typing import Any, Dict, List

from flask import Flask, jsonify, request, send_from_directory, send_file, redirect, session, g, Response, render_template, stream_with_context

# ReportLab pour génération PDF
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
from markupsafe import escape as escape_html
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import secrets
import hmac
import base64
from services.dashboard_goals import build_goals_payload as _build_goals_payload, get_goals_config as _get_goals_config

APP_DIR = Path(__file__).resolve().parent
APP_VERSION = "32.17.0"
import os
import uuid
import subprocess
import traceback
import hashlib
import urllib.error
import urllib.request
import logging
from logging.handlers import RotatingFileHandler

# ═══════════════════════════════════════════════════════════════════
# v24.1: Structured logging with file rotation (24/7 production)
# ═══════════════════════════════════════════════════════════════════
_log_dir = APP_DIR / "logs"
_log_dir.mkdir(exist_ok=True)
_log_handler = RotatingFileHandler(
    str(_log_dir / "prospup.log"), maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
_log_handler.setFormatter(logging.Formatter(
    "[%(asctime)s] %(levelname)s %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
))
_log_handler.setLevel(logging.INFO)
logging.getLogger().addHandler(_log_handler)
logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger("prospup")

def _resolve_db_path() -> Path:
    """
    Resolve database path in this order:
      1) PROSPECTION_DB env var
      2) db_path.txt file at project root
      3) local ./prospects.db
    """
    env = os.environ.get("PROSPECTION_DB")
    if env:
        p = env.strip().strip('"')
        return Path(p)

    cfg = APP_DIR / "db_path.txt"
    if cfg.exists():
        try:
            p = cfg.read_text(encoding="utf-8").strip().strip('"')
        except Exception:
            p = cfg.read_text().strip().strip('"')
        if p:
            return Path(p)

    return APP_DIR / "prospects.db"

DB_PATH = _resolve_db_path()
DATA_DIR = APP_DIR / "data"
INITIAL_JSON = APP_DIR / "initial_data.json"
TEMPLATE_PATH = APP_DIR / "excel_template.xlsx"
SNAPSHOT_DIR = APP_DIR / "snapshots"

# Ollama (IA locale) — proxy backend vers 127.0.0.1:11434
OLLAMA_URL = (os.environ.get("OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL") or "llama3.2"
OLLAMA_TIMEOUT = int(os.environ.get("OLLAMA_TIMEOUT") or "120")

# Tavily (recherche web cloud) — enrichit Ollama avec des données web
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY") or ""
TAVILY_URL = "https://api.tavily.com/search"

# ═══════════════════════════════════════════════════════════════════
# v27.x PARTIE 2: Détection Outlook (win32com) au démarrage
# Méthode principale: win32com.client.Dispatch pour générer .msg
# Méthode fallback: génération .eml (RFC 2822) si Outlook absent
# ═══════════════════════════════════════════════════════════════════
def _detect_outlook() -> bool:
    """Tente d'importer win32com.client pour détecter la présence d'Outlook."""
    try:
        import win32com.client  # type: ignore
        # Vérification supplémentaire: essayer d'accéder à l'objet Outlook
        app = win32com.client.Dispatch("Outlook.Application")
        del app
        return True
    except Exception:
        return False

OUTLOOK_AVAILABLE: bool = _detect_outlook()
logger.info("Outlook disponible (win32com): %s", OUTLOOK_AVAILABLE)

# ═══════════════════════════════════════════════════════════════════
# v28.0: IA simplifiée — Ollama (local) + Tavily (recherche web)
# ═══════════════════════════════════════════════════════════════════
_AI_CONFIG_FILE = DATA_DIR / "ai_config.json"
_ai_config_cache: dict | None = None


def _clear_ai_config_cache() -> None:
    """Invalide le cache IA (utilisé par routes/ai.py après modification de config)."""
    global _ai_config_cache
    _ai_config_cache = None


def _load_ai_config() -> dict:
    """Charge la config IA depuis le fichier ou les variables d'environnement."""
    global _ai_config_cache
    if _ai_config_cache is not None:
        return _ai_config_cache
    defaults = {
        "provider": "ollama",
        "fallback_enabled": True,
        "ollama_url": OLLAMA_URL,
        "ollama_model": OLLAMA_MODEL,
        "tavily_api_key": TAVILY_API_KEY,
        "candidate_description_prompt": "",  # vide = prompt intégré par défaut
        "candidate_pdf_max_chars": 6000,
        # v32.1 — Transcription : Anthropic (analyse) + faster-whisper (transcription)
        "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY") or "",
        "anthropic_model": os.environ.get("ANTHROPIC_MODEL") or "claude-haiku-4-5",
        "whisper_model": os.environ.get("WHISPER_MODEL") or "large-v3",
        "whisper_compute_type": os.environ.get("WHISPER_COMPUTE_TYPE") or "float16",
        "whisper_device": os.environ.get("WHISPER_DEVICE") or "cuda",
        "diarization_enabled": True,
        "huggingface_token": os.environ.get("HUGGINGFACE_TOKEN") or "",
        # v32.8 — Fallback Ollama pour transcription DÉSACTIVÉ par défaut.
        # Avec llama3.2:3B (modèle Ollama par défaut), l'analyse de
        # réunions longues hallucine massivement et produit des CR
        # truffés d'erreurs (cf. v32.7). Mieux vaut une erreur claire +
        # bouton « Recharger crédits » qu'un faux CR. L'utilisateur
        # peut le réactiver explicitement s'il a un gros modèle local.
        "transcription_fallback_ollama": False,
    }
    if _AI_CONFIG_FILE.exists():
        try:
            with open(_AI_CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            for k, v in saved.items():
                if v is not None and v != "":
                    defaults[k] = v
            # Migration: ancien provider "sonar" → "ollama"
            if defaults.get("provider") == "sonar":
                defaults["provider"] = "ollama"
            # Migration: supprimer les anciennes clés Sonar (incompatibles avec Tavily)
            defaults.pop("sonar_api_key", None)
            defaults.pop("sonar_model", None)
        except Exception:
            pass
    _ai_config_cache = defaults
    return defaults

def _save_ai_config(config: dict):
    """Persiste la config IA sur disque et rafraîchit le cache."""
    global _ai_config_cache
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(_AI_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    _ai_config_cache = config

def _call_ai(prompt: str, timeout: int = 120) -> str:
    """Appel IA non-streaming unifié (Ollama). Retourne le texte généré."""
    config = _load_ai_config()
    return _call_ollama_direct(prompt, config, timeout)

def _call_ai_web(prompt: str, timeout: int = 120, search_query: str | None = None) -> str:
    """Appel IA avec recherche web. Tavily + Ollama si configuré, sinon Ollama seul.

    `search_query` (optionnel) : requête dédiée envoyée à Tavily, distincte du
    prompt complet. Utile quand le prompt contient des instructions JSON
    techniques qui pollueraient la query (ex: enrichissement prospect).
    """
    config = _load_ai_config()
    if config.get("tavily_api_key"):
        try:
            logger.info("IA web: recherche Tavily + génération Ollama")
            tavily_query = (search_query or "").strip() or prompt
            search_results = _call_tavily_search(tavily_query, config, timeout=30)
            enriched_prompt = _build_web_enriched_prompt(prompt, search_results)
            result = _call_ollama_direct(enriched_prompt, config, timeout)
            sources = search_results.get("sources", [])
            if sources:
                result += "\n\nSources :\n" + "\n".join(f"- {s['title']}: {s['url']}" for s in sources[:5])
            logger.info("IA web: Tavily+Ollama réussi (%d caractères)", len(result))
            return result
        except Exception as e:
            logger.warning("Tavily+Ollama failed, falling back to Ollama seul: %s", str(e))
    else:
        logger.info("IA web: Tavily non configuré, utilisation d'Ollama seul")
    return _call_ai(prompt, timeout)

# ═══════════════════════════════════════════════════════════════════
# Phase 1: Système d'embeddings pour matching sémantique
# Cache mémoire process-level pour éviter les requêtes DB répétées
_embedding_mem_cache: dict = {}
# ═══════════════════════════════════════════════════════════════════

def _cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Calcule la similarité cosinus entre deux vecteurs."""
    if len(vec1) != len(vec2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    magnitude1 = math.sqrt(sum(a * a for a in vec1))
    magnitude2 = math.sqrt(sum(a * a for a in vec2))
    if magnitude1 == 0 or magnitude2 == 0:
        return 0.0
    return dot_product / (magnitude1 * magnitude2)

def _get_embedding_for_text(text: str, entity_type: str, entity_id: int = None, config: dict = None) -> List[float] | None:
    """Génère ou récupère un embedding pour un texte donné.
    
    Phase 1: Utilise une approche simplifiée basée sur la fréquence des caractères et mots-clés.
    Pour une vraie solution d'embeddings, il faudrait utiliser un modèle dédié (sentence-transformers, OpenAI, etc.).
    """
    if not text or not text.strip():
        return None
    
    text_key = text.strip().lower()
    # Vérifier le cache mémoire d'abord (évite les requêtes DB répétées)
    if text_key in _embedding_mem_cache:
        return _embedding_mem_cache[text_key]

    config = config or _load_ai_config()

    # Vérifier le cache DB
    with _conn() as conn:
        cache_row = conn.execute(
            "SELECT embedding FROM embeddings_cache WHERE entity_type=? AND text_key=? AND (entity_id=? OR entity_id IS NULL) LIMIT 1;",
            (entity_type, text_key, entity_id)
        ).fetchone()
        if cache_row:
            try:
                return json.loads(cache_row["embedding"])
            except Exception:
                pass
    
    # Phase 1: Générer un embedding simplifié (basé sur fréquence caractères + mots-clés techniques)
    # Cette approche est rapide et fonctionne bien pour la similarité basique
    embedding = _get_text_embedding_simple(text)
    
    if embedding:
        # Sauvegarder en cache
        with _conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO embeddings_cache (entity_type, entity_id, text_key, embedding) VALUES (?, ?, ?, ?);",
                (entity_type, entity_id, text_key, json.dumps(embedding))
            )
        return embedding
    
    return None

def _get_text_embedding_simple(text: str) -> List[float] | None:
    """Version simplifiée : génère un embedding basique basé sur les caractères (fallback rapide)."""
    if not text:
        return None
    key = text.strip().lower()
    if key in _embedding_mem_cache:
        return _embedding_mem_cache[key]
    
    # Embedding basique basé sur la fréquence des caractères et mots-clés
    # 128 dimensions : 26 lettres (maj/min), 10 chiffres, 92 autres caractères
    text_lower = text.lower()
    embedding = [0.0] * 128
    
    # Fréquence des caractères (premières 64 dimensions)
    for i, char in enumerate(text_lower[:64]):
        if i < 64:
            char_code = ord(char) % 64
            embedding[char_code] += 0.1
    
    # Mots-clés techniques communs (dernières 64 dimensions)
    tech_keywords = ["c++", "python", "java", "linux", "embedded", "fpga", "autosar", "rtos", 
                     "microcontroller", "arm", "c", "javascript", "docker", "kubernetes", "aws",
                     "git", "agile", "scrum", "test", "validation", "qualification", "safety",
                     "automotive", "aerospace", "defense", "medical", "iot", "ai", "ml", "deep learning"]
    for i, keyword in enumerate(tech_keywords):
        if i < 64 and keyword in text_lower:
            embedding[64 + i] = 1.0
    
    # Normaliser
    max_val = max(abs(x) for x in embedding) if embedding else 1.0
    if max_val > 0:
        embedding = [x / max_val for x in embedding]

    _embedding_mem_cache[key] = embedding
    return embedding

def _compute_semantic_similarity(text1: str, text2: str, entity_type: str = "tag") -> float:
    """Calcule la similarité sémantique entre deux textes en utilisant les embeddings."""
    if not text1 or not text2:
        return 0.0
    
    # Essayer d'obtenir les embeddings (avec fallback simple)
    emb1 = _get_embedding_for_text(text1, entity_type) or _get_text_embedding_simple(text1)
    emb2 = _get_embedding_for_text(text2, entity_type) or _get_text_embedding_simple(text2)
    
    if not emb1 or not emb2:
        # Fallback : similarité basique basée sur les mots communs
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        if not words1 or not words2:
            return 0.0
        intersection = len(words1 & words2)
        union = len(words1 | words2)
        return intersection / union if union > 0 else 0.0
    
    return _cosine_similarity(emb1, emb2)

def _call_ai_provider(provider: str, prompt: str, config: dict, timeout: int) -> str:
    """Appelle un provider spécifique (non-streaming). Seul Ollama est supporté comme provider de chat."""
    return _call_ollama_direct(prompt, config, timeout)

def _call_ollama_direct(prompt: str, config: dict, timeout: int) -> str:
    """Appel direct à Ollama (non-streaming)."""
    url = config.get("ollama_url", OLLAMA_URL)
    model = config.get("ollama_model", OLLAMA_MODEL)
    body = json.dumps({"model": model, "prompt": prompt, "stream": False}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/api/generate", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("response", "").strip()

def _call_tavily_search(query: str, config: dict, timeout: int = 30, max_results: int = 5) -> dict:
    """Recherche web via Tavily. Retourne {answer, sources: [{title, url, content}]}."""
    api_key = config.get("tavily_api_key", "")
    if not api_key:
        raise ValueError("Clé API Tavily non configurée. Ajoutez-la dans Paramètres > Configuration IA.")
    body = json.dumps({
        "query": query[:2000],
        "include_answer": True,
        "search_depth": "advanced",
        "max_results": max_results,
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        TAVILY_URL, data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        sources = [{"title": r.get("title", ""), "url": r.get("url", ""), "content": r.get("content", "")}
                    for r in data.get("results", [])[:max_results]]
        logger.info("Tavily: %d résultats trouvés", len(sources))
        return {"answer": data.get("answer", ""), "sources": sources}
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            if e.fp:
                error_body = e.read().decode("utf-8")
        except Exception:
            pass
        logger.error("Tavily HTTP error %d: %s", e.code, error_body[:500] if error_body else e.reason)
        raise ValueError(f"Erreur Tavily {e.code}: {error_body[:200] if error_body else e.reason}")
    except Exception as e:
        logger.error("Tavily error: %s", str(e))
        raise

def _parse_linkedin_name(url: str) -> str | None:
    """Extrait nom/prénom depuis une URL LinkedIn /in/slug. Retourne None pour les autres formats."""
    try:
        from urllib.parse import urlparse
        path = urlparse(url).path
        m = re.search(r'/in/([^/?#]+)', path)
        if not m:
            return None
        parts = [p for p in m.group(1).strip('/').split('-') if p]
        # Supprime le suffixe ID numérique LinkedIn (ex. "12345678")
        if parts and re.fullmatch(r'\d{4,}', parts[-1]):
            parts.pop()
        if not parts:
            return None
        return ' '.join(p.capitalize() for p in parts)
    except Exception:
        return None


def _build_web_enriched_prompt(original_prompt: str, search_results: dict) -> str:
    """Construit un prompt enrichi avec les résultats de recherche web Tavily."""
    context_parts = []
    if search_results.get("answer"):
        context_parts.append(f"Résumé web : {search_results['answer']}")
    for s in search_results.get("sources", [])[:5]:
        if s.get("content"):
            context_parts.append(f"Source ({s.get('title', 'Sans titre')}) : {s['content'][:500]}")
    web_context = "\n\n".join(context_parts)
    return f"""Voici des informations trouvées sur internet pour enrichir ta réponse :

{web_context}

---

En utilisant ces informations web comme contexte, réponds à la demande suivante :

{original_prompt}"""

def _stream_ai_web_sse(prompt: str, model_override: str | None, timeout: int, temperature: float | None = None, search_query: str | None = None):
    """Stream SSE pour recherche web (Tavily + Ollama si configuré, sinon Ollama seul).

    `search_query` (optionnel) : query Tavily dédiée si distincte du prompt.
    """
    config = _load_ai_config()
    if config.get("tavily_api_key"):
        try:
            yield from _stream_tavily_ollama_sse(prompt, model_override, config, timeout, temperature=temperature, search_query=search_query)
            return
        except Exception as e:
            logger.warning("Tavily+Ollama stream failed, falling back to Ollama seul: %s", e)
    yield from _stream_ai_sse(prompt, model_override, timeout, temperature=temperature)

def _stream_ai_sse(prompt: str, model_override: str | None, timeout: int, temperature: float | None = None):
    """Générateur SSE unifié (Ollama). Yield des lignes SSE."""
    config = _load_ai_config()
    try:
        yield from _stream_ollama_sse(prompt, model_override, config, timeout, temperature=temperature)
    except Exception as err:
        yield f"data: {json.dumps({'type': 'error', 'message': str(err)}, ensure_ascii=False)}\n\n"

def _stream_ollama_sse(prompt: str, model_override: str | None, config: dict, timeout: int, temperature: float | None = None):
    """Stream SSE via Ollama."""
    url = config.get("ollama_url", OLLAMA_URL)
    model = model_override or config.get("ollama_model", OLLAMA_MODEL)
    ollama_body: dict = {"model": model, "prompt": prompt, "stream": True}
    if temperature is not None:
        ollama_body["options"] = {"temperature": temperature}
    body = json.dumps(ollama_body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/api/generate", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        yield f"data: {json.dumps({'type': 'start', 'message': f'Génération IA en cours ({model})…'}, ensure_ascii=False)}\n\n"
        buffer = b""
        for chunk in resp:
            buffer += chunk
            while b"\n" in buffer:
                line_bytes, buffer = buffer.split(b"\n", 1)
                line_json = line_bytes.decode("utf-8", errors="ignore").strip()
                if not line_json:
                    continue
                try:
                    data = json.loads(line_json)
                    if data.get("done", False):
                        full_text = data.get("response", "")
                        if full_text:
                            yield f"data: {json.dumps({'type': 'token', 'text': full_text, 'done': True}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'end', 'message': 'Génération terminée'}, ensure_ascii=False)}\n\n"
                        return
                    else:
                        token = data.get("response", "")
                        if token:
                            yield f"data: {json.dumps({'type': 'token', 'text': token, 'done': False}, ensure_ascii=False)}\n\n"
                except json.JSONDecodeError:
                    continue
    yield f"data: {json.dumps({'type': 'end', 'message': 'Génération terminée'}, ensure_ascii=False)}\n\n"

def _stream_tavily_ollama_sse(prompt: str, model_override: str | None, config: dict, timeout: int, temperature: float | None = None, search_query: str | None = None):
    """Stream SSE : recherche web Tavily puis génération streaming via Ollama.

    `search_query` (optionnel) : query Tavily dédiée si distincte du prompt.
    """
    yield f"data: {json.dumps({'type': 'start', 'message': 'Recherche web Tavily en cours…'}, ensure_ascii=False)}\n\n"
    tavily_query = (search_query or "").strip() or prompt
    search_results = _call_tavily_search(tavily_query, config, timeout=30)
    nb_sources = len(search_results.get("sources", []))
    yield f"data: {json.dumps({'type': 'status', 'message': f'Tavily : {nb_sources} source(s) trouvée(s)', 'provider': 'tavily'}, ensure_ascii=False)}\n\n"
    enriched_prompt = _build_web_enriched_prompt(prompt, search_results)
    yield from _stream_ollama_sse(enriched_prompt, model_override, config, timeout, temperature=temperature)
    sources = search_results.get("sources", [])
    if sources:
        citations_text = "\n\nSources :\n" + "\n".join(f"- {s['title']}: {s['url']}" for s in sources[:5])
        yield f"data: {json.dumps({'type': 'token', 'text': citations_text, 'done': False}, ensure_ascii=False)}\n\n"

# Cache temporaire en mémoire pour les analyses RDV (clé: "{uid}_{prospect_id}")
# Utilisé à la place de session[] car la session n'est pas persistée dans les réponses SSE streaming
_rdv_analysis_cache: Dict[str, str] = {}

app = Flask(__name__, static_folder=str(APP_DIR / 'static'), static_url_path='/static', template_folder=str(APP_DIR / 'templates'))

# ═══════════════════════════════════════════════════════════════════
# Session & Auth configuration
# ═══════════════════════════════════════════════════════════════════
_secret_file = APP_DIR / ".secret_key"
if _secret_file.exists():
    app.secret_key = _secret_file.read_text().strip()
else:
    app.secret_key = secrets.token_hex(32)
    _secret_file.write_text(app.secret_key)

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = True   # v23.4: requires HTTPS (Cloudflare Tunnel)
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(hours=8)  # v23.4: reduced from 30d for security
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # v32.1 : 500 MB pour les uploads audio
app.json.ensure_ascii = False  # v27.12: caractères Unicode non échappés dans les réponses JSON

# v22: Compute content hashes for static assets (auto cache busters)
_static_hashes: Dict[str, str] = {}


def _compute_static_hashes():
    static_dir = APP_DIR / 'static'
    for f in static_dir.rglob('*'):
        if f.is_file() and f.suffix in ('.css', '.js', '.png', '.ico', '.json'):
            h = hashlib.md5(f.read_bytes()).hexdigest()[:8]
            rel = str(f.relative_to(static_dir)).replace('\\', '/')
            _static_hashes[rel] = h


_compute_static_hashes()

# Helper function for Jinja2 templates to get static file hash
def _get_static_hash(static_path: str) -> str:
    """Get the hash for a static file path (e.g., 'css/style.css' -> 'a1b2c3d4')."""
    return _static_hashes.get(static_path, '')

# Register the helper in Jinja2
app.jinja_env.globals['static_hash'] = _get_static_hash

# Regex to match ?v=XXXX in /static/ paths
_CACHE_BUSTER_RE = re.compile(r'(/static/[^"\'?]+)\?v=\d+')

# ═══════════════════════════════════════════════════════════════════
# Validation centralisée des uploads (B4 — sécurité)
# ═══════════════════════════════════════════════════════════════════
_UPLOAD_RULES: Dict[str, Dict] = {
    "image": {
        "extensions": {".jpg", ".jpeg", ".png", ".webp", ".gif"},
        "mimes": {"image/jpeg", "image/png", "image/webp", "image/gif"},
        "max_bytes": 5 * 1024 * 1024,   # 5 Mo
        "label": "jpg, png, webp, gif",
    },
    "document": {
        "extensions": {".pdf", ".doc", ".docx"},
        "mimes": {
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        "max_bytes": 20 * 1024 * 1024,  # 20 Mo
        "label": "pdf, doc, docx",
    },
    "document_or_excel": {
        "extensions": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt"},
        "mimes": {
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain",
        },
        "max_bytes": 20 * 1024 * 1024,  # 20 Mo
        "label": "pdf, doc, docx, xls, xlsx, txt",
    },
    "csv": {
        "extensions": {".csv"},
        "mimes": {"text/csv", "text/plain", "application/csv", "application/octet-stream"},
        "max_bytes": 10 * 1024 * 1024,  # 10 Mo
        "label": "csv",
    },
    "mail_template": {
        "extensions": {".msg", ".eml", ".oft", ".htm", ".html"},
        "mimes": {
            "application/vnd.ms-outlook",
            "message/rfc822",
            "text/html",
            "text/plain",
            "application/octet-stream",
        },
        "max_bytes": 10 * 1024 * 1024,  # 10 Mo
        "label": "msg, eml, oft, htm, html",
    },
    "prospect_attachment": {
        "extensions": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".pptx", ".ppt", ".odt", ".ods"},
        "mimes": {
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.oasis.opendocument.text",
            "application/vnd.oasis.opendocument.spreadsheet",
            "text/plain",
            "image/jpeg", "image/png", "image/webp",
        },
        "max_bytes": 50 * 1024 * 1024,  # 50 Mo
        "label": "pdf, doc, docx, xls, xlsx, pptx, txt, jpg, png…",
    },
}

# Magic bytes (premiers octets) pour vérification MIME indépendante du Content-Type déclaré
_MAGIC_BYTES: list = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"RIFF", "image/webp"),   # WebP : RIFF....WEBP
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", None),     # ZIP container → docx / xlsx / odt (None = accepté si ext valide)
    (b"\xd0\xcf\x11\xe0", None),  # OLE2 compound → doc / xls / msg / oft
]


def _sniff_mime(header: bytes) -> str | None:
    """Retourne le MIME détecté à partir des magic bytes (premier 8 octets)."""
    for magic, mime in _MAGIC_BYTES:
        if header[:len(magic)] == magic:
            return mime  # peut être None pour les containers ZIP/OLE
    return None


def _attachment_dir(owner_id: int, prospect_id: int) -> Path:
    """Retourne (et crée) le dossier de pièces jointes isolé par user et prospect."""
    p = Path("data") / f"user_{owner_id}" / "attachments" / f"prospect_{prospect_id}"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _thumb_dir(owner_id: int, prospect_id: int) -> Path:
    """Sous-dossier pour les miniatures."""
    p = _attachment_dir(owner_id, prospect_id) / ".thumbs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _generate_thumbnail(src_path: Path, mime_type: str, target_path: Path) -> bool:
    """Génère une miniature 320x240 PNG. Retourne True si succès.

    Supporte : PDF (1ère page via PyMuPDF), images (via Pillow).
    Échec silencieux si lib non dispo ou format non supporté.
    """
    try:
        m = (mime_type or "").lower()
        if m == "application/pdf":
            try:
                import fitz  # PyMuPDF
            except ImportError:
                return False
            try:
                doc = fitz.open(str(src_path))
                if doc.page_count == 0:
                    doc.close()
                    return False
                page = doc.load_page(0)
                # Matrice : zoom 2x pour qualité raisonnable
                mat = fitz.Matrix(1.5, 1.5)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                pix.save(str(target_path))
                doc.close()
                return True
            except Exception as e:
                logger.warning("[thumb] PDF render failed: %s", e)
                return False
        if m.startswith("image/"):
            try:
                from PIL import Image
            except ImportError:
                return False
            try:
                with Image.open(str(src_path)) as img:
                    img = img.convert("RGB")
                    img.thumbnail((480, 360))
                    img.save(str(target_path), "PNG", optimize=True)
                    return True
            except Exception as e:
                logger.warning("[thumb] image render failed: %s", e)
                return False
    except Exception as e:
        logger.warning("[thumb] unexpected error: %s", e)
    return False


def _extract_pdf_text(src_path: Path, max_chars: int = 50000) -> str:
    """Extrait le texte d'un PDF. Limité à max_chars pour la DB.

    Retourne '' si lib indisponible ou erreur.
    """
    try:
        import fitz
    except ImportError:
        return ""
    try:
        doc = fitz.open(str(src_path))
        texts = []
        total = 0
        for page in doc:
            t = page.get_text() or ""
            texts.append(t)
            total += len(t)
            if total >= max_chars:
                break
        doc.close()
        return "\n".join(texts)[:max_chars]
    except Exception as e:
        logger.warning("[extract] PDF text failed: %s", e)
        return ""


def _validate_upload(file_storage, rule_name: str):
    """Valide un FileStorage Werkzeug (extension, MIME, taille).

    Retourne (True, None) si tout est OK, (False, (message, http_code)) sinon.
    Lit les premiers octets puis seek(0) pour ne pas consommer le flux.
    """
    rules = _UPLOAD_RULES[rule_name]

    # 1. Extension
    ext = os.path.splitext(file_storage.filename or "")[1].lower()
    if ext not in rules["extensions"]:
        return False, (f"Extension non autorisée. Formats acceptés : {rules['label']}", 400)

    # 2. Taille : lit le fichier complet en mémoire pour mesurer, puis rembobine
    data = file_storage.read()
    file_storage.seek(0)
    if len(data) > rules["max_bytes"]:
        limit_mb = rules["max_bytes"] // (1024 * 1024)
        return False, (f"Fichier trop volumineux (max {limit_mb} Mo)", 413)

    # 3. MIME réel via magic bytes
    sniffed = _sniff_mime(data[:8])
    # sniffed == None → container ZIP ou OLE valide selon extension, on laisse passer
    if sniffed is not None and sniffed not in rules["mimes"]:
        return False, ("Type de fichier non autorisé (contenu invalide)", 415)

    return True, None


@app.after_request
def _after_request(response):
    # ── Security headers (v23.4) ──
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    # HSTS: only when served behind Cloudflare Tunnel (HTTPS)
    if request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https':
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    # CSP: restrictive but allows inline styles/scripts (needed for current architecture)
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "img-src 'self' data: blob:; "
        "connect-src 'self' https://api.tavily.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "frame-ancestors 'self'"
    )

    # ── CORS for mobile JWT auth (v24.0) ──
    if request.headers.get("Authorization", "").startswith("Bearer ") or request.method == "OPTIONS":
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"

    # Cache headers for API GET responses (30s private cache)
    if request.path.startswith('/api/') and request.method == 'GET':
        response.headers.setdefault('Cache-Control', 'private, max-age=30')
    # Auto cache busters: replace ?v=XXXX with ?v=<hash> in HTML responses
    if response.content_type and 'text/html' in response.content_type and _static_hashes:
        try:
            data = response.get_data(as_text=True)

            def _replace_hash(m):
                path = m.group(1)  # e.g. /static/css/style.css
                rel = path.lstrip('/static/')
                # Try to find the hash for this path
                h = _static_hashes.get(rel)
                if not h:
                    # Try without leading slash
                    rel2 = path.replace('/static/', '', 1)
                    h = _static_hashes.get(rel2)
                return f'{path}?v={h}' if h else m.group(0)

            data = _CACHE_BUSTER_RE.sub(_replace_hash, data)
            response.set_data(data)
        except Exception:
            pass  # Don't break pages if hash replacement fails
    return response


# Roles: admin > editor (reader supprimé)
ROLE_LEVELS = {'admin': 3, 'editor': 2}

def _get_current_user():
    """Get current user from session, returns dict or None."""
    uid = session.get('user_id')
    if not uid:
        return None
    try:
        with _auth_conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE id=?;", (uid,)).fetchone()
            return dict(row) if row else None
    except Exception:
        return None


def _uid():
    """ID de l'utilisateur connecté (pour isolation prospects/candidates). None si non authentifié."""
    return session.get("user_id")


def _prospect_owned(prospect_id: int) -> bool:
    """True si le prospect appartient à l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return False
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid),
        ).fetchone()
    return row is not None


def _candidate_owned(candidate_id: int) -> bool:
    """True si le candidat appartient à l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return False
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM candidates WHERE id=? AND owner_id=?;",
            (candidate_id, uid),
        ).fetchone()
    return row is not None


def _company_owned(company_id: int) -> bool:
    """True si l'entreprise appartient à l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return False
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM companies WHERE id=? AND owner_id=?;",
            (company_id, uid),
        ).fetchone()
    return row is not None

def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get('user_id'):
            if request.path.startswith('/api/'):
                return jsonify(ok=False, error="Non authentifié"), 401
            return redirect('/login')
        g.user = _get_current_user()
        if not g.user:
            session.clear()
            return redirect('/login')
        return f(*args, **kwargs)
    return wrapper

def role_required(min_role):
    """Decorator: require minimum role level."""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            user = getattr(g, 'user', None) or _get_current_user()
            if not user:
                return jsonify(ok=False, error="Non authentifié"), 401
            user_level = ROLE_LEVELS.get(user.get('role', ''), 0)
            min_level = ROLE_LEVELS.get(min_role, 99)
            if user_level < min_level:
                return jsonify(ok=False, error="Permissions insuffisantes"), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator

# Origines autorisées quand l'app est derrière le tunnel (request.host = localhost, Origin = prospup.work)
# Variable d'environnement PROSPUP_ALLOWED_ORIGINS = URLs séparées par des virgules (ex. https://mon-domaine.fr)
_origins_list = [
    "https://prospup.work", "https://www.prospup.work", "https://crm.prospup.work",
    "http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:8000/", "http://127.0.0.1:8000/",
]
_env_origins = os.environ.get("PROSPUP_ALLOWED_ORIGINS", "").strip()
if _env_origins:
    for o in _env_origins.split(","):
        o = o.strip().rstrip("/")
        if o:
            _origins_list.append(o)
            _origins_list.append(o + "/")
_ALLOWED_ORIGINS = frozenset(_origins_list)

def _require_same_origin():
    """Anti-CSRF léger : si l'en-tête Origin est présent, exiger une origine autorisée."""
    origin = (request.headers.get("Origin") or "").strip().rstrip("/")
    if not origin:
        return None
    try:
        host = (request.host_url or "").rstrip("/")
        if origin == host:
            return None
        if origin in _ALLOWED_ORIGINS or origin.rstrip("/") in _ALLOWED_ORIGINS:
            return None
        return jsonify(ok=False, error="Origine non autorisée"), 403
    except Exception:
        return jsonify(ok=False, error="Origine non autorisée"), 403

def validate_payload(required_fields: dict):
    """Helper de validation légère des payloads JSON (v27.8).

    required_fields = {'nom': str, 'email': str} — type peut être un tuple ex. (str, int).
    Retourne (data, None) si valide, (None, response_erreur) sinon.
    """
    data = request.get_json(silent=True)
    if data is None:
        return None, (jsonify({'error': 'Payload JSON manquant ou invalide'}), 400)
    errors = []
    for field, ftype in required_fields.items():
        if field not in data:
            errors.append(f"Champ requis manquant : '{field}'")
        elif data[field] is not None and not isinstance(data[field], ftype):
            if isinstance(ftype, tuple):
                type_name = '/'.join(t.__name__ for t in ftype)
            else:
                type_name = ftype.__name__ if hasattr(ftype, '__name__') else str(ftype)
            errors.append(f"'{field}' doit être de type {type_name}")
    if errors:
        return None, (jsonify({'error': 'Validation échouée', 'details': errors}), 422)
    return data, None


@app.before_request
def _require_auth():
    """Protect all routes except login, static, and favicon.
    Supports both session cookies (web) and JWT Bearer tokens (mobile v24.0).
    CSRF is enforced for cookie auth; JWT Bearer is inherently CSRF-safe."""
    # ── CORS preflight ──
    if request.method == "OPTIONS":
        return

    allowed = ('/login', '/v30/login', '/static/', '/favicon.ico', '/api/auth/', '/api/app-version', '/api/system/check-deployment', '/api/system/logs',
               '/api/deploy/health', '/api/deploy/pull-from-404', '/api/deploy/rollback',
               '/api/deploy/validation-status', '/api/deploy/confirm-validation',
               '/prospects/mode-prosp', '/api/mode-prosp/')
    if any(request.path.startswith(p) for p in allowed):
        return

    # ── JWT auth (mobile v24.0) ──
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        result = _verify_access_token(token)
        if result == "expired":
            return jsonify(ok=False, error="token_expired"), 401
        if result is None:
            return jsonify(ok=False, error="invalid_token"), 401
        # Populate session-like context so _uid() and g.user work transparently
        g.jwt_user = result
        g.user = {"id": result["user_id"], "role": result["user_role"],
                   "display_name": result["user_name"], "username": result["user_name"]}
        session["user_id"] = result["user_id"]
        session["user_role"] = result["user_role"]
        session["user_name"] = result["user_name"]
        return  # JWT auth OK — skip session & CSRF checks

    # ── CSRF protection on mutations (cookie auth only, v23.4) ──
    if request.method in ('POST', 'PUT', 'DELETE') and request.path.startswith('/api/'):
        chk = _require_same_origin()
        if chk:
            return chk

    # ── Session auth (web, unchanged) ──
    if not session.get('user_id'):
        if request.path.startswith('/api/'):
            return jsonify(ok=False, error="Non authentifié"), 401
        return redirect('/login')
    g.user = _get_current_user()
    if not g.user:
        session.clear()
        return redirect('/login')


@app.route("/api/<path:path>", methods=["OPTIONS"])
def api_cors_preflight(path):
    """Handle CORS preflight requests for mobile app (v24.0)."""
    resp = app.make_default_options_response()
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return resp

@app.context_processor
def _inject_user():
    """Make current user available to all templates."""
    return {'current_user': getattr(g, 'user', None)}

@app.get("/favicon.ico")
def favicon():
    # Serve app icon (tab favicon)
    return send_from_directory(str(APP_DIR / "static"), "favicon.ico", mimetype="image/vnd.microsoft.icon")


# /api/deploy/pull-from-404 et /api/deploy/rollback — déplacés dans routes/deploy.py


@app.errorhandler(404)
def page_not_found(e):
    """Custom 404 page (v23.4)."""
    if request.path.startswith('/api/'):
        return jsonify(ok=False, error="Endpoint introuvable"), 404
    return send_from_directory(APP_DIR, "404.html"), 404


@app.errorhandler(400)
def bad_request(e):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Requête invalide', 'detail': str(e)}), 400
    return send_from_directory(APP_DIR, "400.html"), 400


@app.errorhandler(500)
def server_error(e):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Erreur serveur interne'}), 500
    return send_from_directory(APP_DIR, "500.html"), 500


# ═══════════════════════════════════════════════════════════════════
# Auth routes
# ═══════════════════════════════════════════════════════════════════

@app.get("/login")
def page_login():
    if session.get('user_id'):
        # v30 est l'interface par defaut depuis 30.1. L'opt-out client
        # (localStorage.prospup_ui_mode === 'v29') est gere par base.html
        # legacy qui redirige vers l'equivalent legacy si necessaire.
        return redirect('/v30/dashboard')
    return send_from_directory(APP_DIR, "login.html")

# v23.4: Simple in-memory rate limiter for login (IP-based)
_login_attempts: Dict[str, List[float]] = {}
_login_lock = threading.Lock()
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 300  # 5 minutes

def _check_login_rate_limit() -> bool:
    """Returns True if rate limited (thread-safe)."""
    ip = request.remote_addr or "unknown"
    now = time.time()
    with _login_lock:
        # Periodic cleanup: purge expired IPs when dict grows large
        if len(_login_attempts) > 500:
            expired = [k for k, ts in _login_attempts.items()
                       if all(now - t >= _LOGIN_WINDOW_SECONDS for t in ts)]
            for k in expired:
                del _login_attempts[k]
        attempts = _login_attempts.get(ip, [])
        attempts = [t for t in attempts if now - t < _LOGIN_WINDOW_SECONDS]
        _login_attempts[ip] = attempts
        return len(attempts) >= _LOGIN_MAX_ATTEMPTS

def _record_login_attempt():
    ip = request.remote_addr or "unknown"
    with _login_lock:
        _login_attempts.setdefault(ip, []).append(time.time())

# ── JWT auth helpers (v24.0 — mobile app support) ──────────────────
# Minimal HS256 JWT implementation (no PyJWT dependency needed)
_JWT_ACCESS_EXPIRY = 900        # 15 minutes
_JWT_REFRESH_EXPIRY = 2592000   # 30 days


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    s += "=" * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)


def _jwt_encode(payload: dict, secret: str) -> str:
    """Encode a JWT with HS256."""
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64url_encode(json.dumps(payload).encode())
    msg = f"{header}.{body}"
    sig = hmac.new(secret.encode(), msg.encode(), "sha256").digest()
    return f"{msg}.{_b64url_encode(sig)}"


def _jwt_decode(token: str, secret: str) -> dict | str | None:
    """Decode and verify a JWT. Returns payload dict, 'expired', or None."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        msg = f"{parts[0]}.{parts[1]}"
        sig = hmac.new(secret.encode(), msg.encode(), "sha256").digest()
        expected_sig = _b64url_decode(parts[2])
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload = json.loads(_b64url_decode(parts[1]))
        if payload.get("exp") and payload["exp"] < int(time.time()):
            return "expired"
        return payload
    except Exception:
        return None


def _generate_access_token(user):
    """Generate a short-lived JWT access token."""
    payload = {
        "user_id": user["id"],
        "user_role": user["role"],
        "user_name": user.get("display_name") or user.get("username") or "",
        "type": "access",
        "iat": int(time.time()),
        "exp": int(time.time()) + _JWT_ACCESS_EXPIRY,
    }
    return _jwt_encode(payload, app.secret_key)


def _generate_refresh_token(user, device=None):
    """Generate a long-lived refresh token, store its hash in DB."""
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = (datetime.datetime.now() + datetime.timedelta(seconds=_JWT_REFRESH_EXPIRY)).isoformat(timespec="seconds")
    with _auth_conn() as conn:
        conn.execute(
            "INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device, createdAt) VALUES (?, ?, ?, ?, ?);",
            (user["id"], token_hash, expires_at, device, datetime.datetime.now().isoformat(timespec="seconds"))
        )
    return raw


def _verify_access_token(token):
    """Decode and verify an access token. Returns payload dict, 'expired', or None."""
    result = _jwt_decode(token, app.secret_key)
    if isinstance(result, dict) and result.get("type") != "access":
        return None
    return result


def _verify_refresh_token(raw_token):
    """Verify a refresh token. Returns user_id or None."""
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    now_iso = datetime.datetime.now().isoformat(timespec="seconds")
    with _auth_conn() as conn:
        row = conn.execute(
            "SELECT * FROM refresh_tokens WHERE token_hash=? AND revoked=0;",
            (token_hash,)
        ).fetchone()
    if not row:
        return None
    if row["expires_at"] < now_iso:
        return None
    return row["user_id"]


# /api/auth/* — déplacé dans routes/auth.py (Blueprint enregistré en bas de ce fichier)

# ═══════════════════════════════════════════════════════════════════
# User management (admin only)
# ═══════════════════════════════════════════════════════════════════

@app.get("/users")
@login_required
@role_required('admin')
def page_users():
    return redirect("/v30/users", code=302)

@app.get("/api/users")
@login_required
@role_required('admin')
def api_users_list():
    user = getattr(g, 'user', None) or _get_current_user()
    with _auth_conn() as conn:
        rows = conn.execute("SELECT id, username, display_name, role, is_active, createdAt, lastLoginAt FROM users ORDER BY id;").fetchall()
    is_admin = user and user.get('role') == 'admin'
    current_user_id = int(user["id"]) if user and user.get("id") is not None else None
    users_list = []
    for r in rows:
        u = dict(r)
        u['lastLoginAt'] = u.get('lastLoginAt') or ''
        users_list.append(u)
    return jsonify(ok=True, users=users_list, is_admin=is_admin, current_user_id=current_user_id)

@app.get("/api/users/for-push")
@login_required
def api_users_for_push():
    """Liste minimale des utilisateurs actifs pour la sélection de consultants dans le push modal.
    Accessible à tous les utilisateurs authentifiés (admin et editor)."""
    user = getattr(g, 'user', None) or _get_current_user()
    current_user_id = int(user["id"]) if user and user.get("id") is not None else None
    with _auth_conn() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name FROM users WHERE is_active=1 ORDER BY display_name, username;"
        ).fetchall()
    users_list = [dict(r) for r in rows]
    return jsonify(ok=True, users=users_list, current_user_id=current_user_id)

@app.post("/api/users/save")
@login_required
@role_required('admin')
def api_users_save():
    payload, err = validate_payload({'username': str})
    if err:
        return err
    uid = payload.get("id")
    username = (payload.get("username") or "").strip().lower()
    display_name = (payload.get("display_name") or "").strip()
    role = payload.get("role", "editor")
    password = payload.get("password", "")
    is_active = 1 if payload.get("is_active", True) else 0

    if not username:
        return jsonify(ok=False, error="Username requis"), 400
    if role not in ROLE_LEVELS:
        return jsonify(ok=False, error="Rôle invalide"), 400

    new_user_id = None
    with _auth_conn() as conn:
        if uid:
            existing = conn.execute("SELECT * FROM users WHERE id=?;", (uid,)).fetchone()
            if not existing:
                return jsonify(ok=False, error="Utilisateur introuvable"), 404
            conn.execute("UPDATE users SET username=?, display_name=?, role=?, is_active=? WHERE id=?;",
                         (username, display_name, role, is_active, uid))
            if password and password.strip():
                conn.execute("UPDATE users SET password_hash=? WHERE id=?;",
                             (generate_password_hash(password), uid))
            return jsonify(ok=True, action="updated")
        else:
            if not password or len(password) < 8:
                return jsonify(ok=False, error="Mot de passe requis (min 8 caractères, avec au moins 1 chiffre et 1 lettre)"), 400
            if not any(c.isdigit() for c in password):
                return jsonify(ok=False, error="Le mot de passe doit contenir au moins un chiffre"), 400
            if not any(c.isalpha() for c in password):
                return jsonify(ok=False, error="Le mot de passe doit contenir au moins une lettre"), 400
            dup = conn.execute("SELECT id FROM users WHERE LOWER(username)=?;", (username,)).fetchone()
            if dup:
                return jsonify(ok=False, error="Username déjà pris"), 409
            now = datetime.datetime.now().isoformat(timespec="seconds")
            cur = conn.execute(
                "INSERT INTO users (username, display_name, password_hash, role, is_active, createdAt, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1);",
                (username, display_name, generate_password_hash(password), role, is_active, now)
            )
            new_user_id = cur.lastrowid

    if new_user_id:
        try:
            _init_user_db(new_user_id)
        except Exception as e:
            print(f"[WARN] Erreur creation DB utilisateur {new_user_id}: {e}")
        return jsonify(ok=True, action="created", user_id=new_user_id)

    return jsonify(ok=True, action="created")

@app.post("/api/users/delete")
@login_required
@role_required('admin')
def api_users_delete():
    """Supprime un utilisateur et toutes ses données, en gérant correctement les données collaboratives."""
    payload = request.get_json(force=True, silent=True) or {}
    uid = payload.get("id")
    if not uid:
        return jsonify(ok=False, error="ID requis"), 400
    if uid == session.get('user_id'):
        return jsonify(ok=False, error="Impossible de supprimer votre propre compte"), 400
    
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="ID invalide"), 400
    
    with _auth_conn() as conn:
        # Vérifier que l'utilisateur existe
        user = conn.execute("SELECT id, username, display_name FROM users WHERE id=?;", (uid,)).fetchone()
        if not user:
            return jsonify(ok=False, error="Utilisateur introuvable"), 404
        
        username = user["username"] or user["display_name"] or f"user_{uid}"
        
        # 1. Nettoyer shared_companies
        # - Supprimer les partages où from_user_id = uid (partages envoyés)
        #   Les données restent dans la DB du collaborateur (to_user_id)
        sent_shares = conn.execute(
            "SELECT id, company_id, to_user_id FROM shared_companies WHERE from_user_id=?;",
            (uid,)
        ).fetchall()
        conn.execute("DELETE FROM shared_companies WHERE from_user_id=?;", (uid,))
        
        # - Supprimer les partages où to_user_id = uid (partages reçus)
        #   Supprimer aussi les données copiées dans la DB de l'utilisateur supprimé
        received_shares = conn.execute(
            "SELECT id, company_id, from_user_id FROM shared_companies WHERE to_user_id=?;",
            (uid,)
        ).fetchall()
        conn.execute("DELETE FROM shared_companies WHERE to_user_id=?;", (uid,))
        
        # Supprimer les entreprises et prospects partagés de la DB de l'utilisateur supprimé
        # (ces données ont été copiées via _sync_shared_company_to_collaborator)
        if received_shares:
            user_db_path = _user_db_path(uid)
            if user_db_path.exists():
                try:
                    user_conn = sqlite3.connect(user_db_path)
                    user_conn.row_factory = sqlite3.Row
                    user_conn.execute("PRAGMA foreign_keys = OFF;")
                    try:
                        # Supprimer les prospects des entreprises partagées
                        company_ids = [s["company_id"] for s in received_shares]
                        if company_ids:
                            placeholders = ','.join(['?'] * len(company_ids))
                            user_conn.execute(
                                f"DELETE FROM prospects WHERE company_id IN ({placeholders}) AND owner_id=?;",
                                (*company_ids, uid)
                            )
                            # Supprimer les entreprises partagées
                            user_conn.execute(
                                f"DELETE FROM companies WHERE id IN ({placeholders}) AND owner_id=?;",
                                (*company_ids, uid)
                            )
                        user_conn.commit()
                    finally:
                        user_conn.execute("PRAGMA foreign_keys = ON;")
                        user_conn.close()
                except Exception as e:
                    logger.warning(f"Erreur nettoyage données partagées user {uid}: {e}")
        
        # 2. Nettoyer audit_log
        conn.execute("DELETE FROM audit_log WHERE user_id=?;", (uid,))
        
        # 3. Nettoyer refresh_tokens (CASCADE devrait le faire, mais on le fait explicitement)
        conn.execute("DELETE FROM refresh_tokens WHERE user_id=?;", (uid,))
        
        # 4. Supprimer l'utilisateur (CASCADE supprimera aussi refresh_tokens)
        conn.execute("DELETE FROM users WHERE id=?;", (uid,))
        
        logger.info(f"Utilisateur {uid} ({username}) supprimé : {len(sent_shares)} partages envoyés, {len(received_shares)} partages reçus nettoyés")
    
    # 5. Supprimer le dossier utilisateur avec retry
    user_dir = DATA_DIR / f"user_{uid}"
    if user_dir.exists():
        max_retries = 3
        retry_delay = 1.0  # secondes
        for attempt in range(max_retries):
            try:
                shutil.rmtree(user_dir)
                logger.info(f"DB utilisateur supprimée : {user_dir}")
                break
            except (OSError, PermissionError) as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Tentative {attempt + 1}/{max_retries} échouée pour {user_dir}, retry dans {retry_delay}s...")
                    time.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    logger.warning(f"Impossible de supprimer {user_dir} après {max_retries} tentatives: {e}")
                    # Le dossier sera nettoyé au prochain redémarrage par _migrate_all_user_dbs()

    return jsonify(ok=True, message=f"Utilisateur {username} supprimé avec succès")

# Admin: View another user's data (read-only)
@app.get("/api/users/<int:target_user_id>/data")
@login_required
@role_required('admin')
def api_users_view_data(target_user_id):
    """Admin can view another user's prospect/candidate data in read-only mode."""
    with _auth_conn() as conn:
        user = conn.execute("SELECT id, username, display_name, role FROM users WHERE id=?;", (target_user_id,)).fetchone()
        if not user:
            return jsonify(ok=False, error="Utilisateur introuvable"), 404

    with _conn_for_user(target_user_id) as uconn:
        prospects = uconn.execute("SELECT COUNT(*) AS n FROM prospects;").fetchone()["n"]
        candidates = uconn.execute("SELECT COUNT(*) AS n FROM candidates;").fetchone()["n"]
    has_own_db = (DATA_DIR / f"user_{target_user_id}" / "prospects.db").exists()
    return jsonify(ok=True, user=dict(user), stats={"prospects": prospects, "candidates": candidates}, has_own_db=has_own_db)


@app.post("/api/admin/reassign-ownership")
@login_required
@role_required('admin')
def api_admin_reassign_ownership():
    """Admin endpoint: reassign prospects/companies ownership from one user to another."""
    chk = _require_same_origin()
    if chk:
        return chk

    payload = request.get_json(force=True, silent=True) or {}
    from_user_id = payload.get("from_user_id")
    to_user_id = payload.get("to_user_id")
    try:
        from_user_id = int(from_user_id)
        to_user_id = int(to_user_id)
    except Exception:
        return jsonify(ok=False, error="from_user_id et to_user_id requis"), 400

    if from_user_id == to_user_id:
        return jsonify(ok=False, error="Les utilisateurs source et destination doivent être différents"), 400

    src_has_own_db = (DATA_DIR / f"user_{from_user_id}" / "prospects.db").exists()
    dst_has_own_db = (DATA_DIR / f"user_{to_user_id}" / "prospects.db").exists()
    if src_has_own_db or dst_has_own_db:
        return jsonify(ok=False, error="Réattribution non supportée entre utilisateurs ayant des bases de données séparées. Contactez l'administrateur."), 400

    with _auth_conn() as conn:
        src = conn.execute(
            "SELECT id, username, display_name FROM users WHERE id=?;",
            (from_user_id,),
        ).fetchone()
        dst = conn.execute(
            "SELECT id, username, display_name FROM users WHERE id=?;",
            (to_user_id,),
        ).fetchone()
        if not src:
            return jsonify(ok=False, error="Utilisateur source introuvable"), 404
        if not dst:
            return jsonify(ok=False, error="Utilisateur destination introuvable"), 404

    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("BEGIN;")
        try:
            prospects_n = int(cur.execute(
                "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=?;",
                (from_user_id,),
            ).fetchone()["n"])
            companies_n = int(cur.execute(
                "SELECT COUNT(*) AS n FROM companies WHERE owner_id=?;",
                (from_user_id,),
            ).fetchone()["n"])

            cur.execute(
                "UPDATE prospects SET owner_id=? WHERE owner_id=?;",
                (to_user_id, from_user_id),
            )
            cur.execute(
                "UPDATE companies SET owner_id=? WHERE owner_id=?;",
                (to_user_id, from_user_id),
            )
            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise

    return jsonify(
        ok=True,
        moved={"prospects": prospects_n, "companies": companies_n},
        from_user={"id": int(src["id"]), "username": src["username"], "display_name": src["display_name"]},
        to_user={"id": int(dst["id"]), "username": dst["username"], "display_name": dst["display_name"]},
    )


def _auth_conn() -> sqlite3.Connection:
    """Connexion à la DB centrale (users, auth). Toujours DB_PATH."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 20000;")  # 20 s retry on lock (multi-device)
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def _user_db_path(user_id: int) -> Path:
    """Chemin de la DB d'un utilisateur. Retourne la per-user DB UNIQUEMENT
    si elle contient déjà des données métier (prospects ou companies).

    v32.14 — Avant on se contentait d'un `st_size > 0`, mais une DB SQLite
    « vide » peut peser plusieurs centaines de Ko si init_db y a tourné
    sans qu'aucune ligne ne soit insérée. Ça pouvait masquer la DB
    principale (où sont vraiment les données) et faire disparaître
    prospects/companies/candidates côté UI. Désormais on vérifie
    explicitement qu'au moins une table métier a au moins une ligne ;
    sinon on fallback sur DB_PATH.
    """
    user_db = DATA_DIR / f"user_{user_id}" / "prospects.db"
    if not user_db.exists():
        return DB_PATH
    try:
        if user_db.stat().st_size <= 0:
            return DB_PATH
    except OSError:
        return DB_PATH
    # Sanity check : la DB user doit contenir au moins quelques lignes
    # dans une des tables principales. Sinon → fallback DB_PATH.
    try:
        probe = sqlite3.connect(user_db)
        try:
            for tbl in ("prospects", "companies", "candidates"):
                try:
                    n = probe.execute(f"SELECT COUNT(*) FROM {tbl};").fetchone()[0]
                    if n and n > 0:
                        return user_db
                except sqlite3.OperationalError:
                    # Table absente → on continue avec la suivante
                    continue
        finally:
            probe.close()
    except Exception as exc:
        logger.warning("Probe per-user DB %s a échoué : %s — fallback DB_PATH", user_db, exc)
        return DB_PATH
    # Aucune table métier ne contient de données → DB user vide → DB_PATH
    return DB_PATH


def _conn_for_user(user_id: int) -> sqlite3.Connection:
    """Connexion à la DB d'un utilisateur spécifique (pour admin viewing another user's data)."""
    db_path = _user_db_path(user_id)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 20000;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def _conn() -> sqlite3.Connection:
    """Connexion à la DB de l'utilisateur courant (per-user si elle existe, sinon DB_PATH)."""
    try:
        uid = session.get("user_id")
        if uid:
            db_path = _user_db_path(uid)
        else:
            db_path = DB_PATH
    except RuntimeError:
        db_path = DB_PATH
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 20000;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_db() -> None:
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    # Créer le dossier pour les dossiers de compétences
    (APP_DIR / "dossiers_competence").mkdir(exist_ok=True)

    with _conn() as conn:
        conn.executescript(
            '''
            CREATE TABLE IF NOT EXISTS companies (
                id        INTEGER PRIMARY KEY,
                groupe    TEXT NOT NULL,
                site      TEXT NOT NULL,
                phone     TEXT,
                notes     TEXT,
                tags      TEXT
            );

            CREATE TABLE IF NOT EXISTS prospects (
                id            INTEGER PRIMARY KEY,
                name          TEXT NOT NULL,
                company_id    INTEGER NOT NULL,
                fonction      TEXT,
                telephone     TEXT,
                email         TEXT,
                linkedin      TEXT,
                pertinence    TEXT,
                statut        TEXT,
                lastContact   TEXT,
                nextFollowUp  TEXT,
                priority      INTEGER,
                notes         TEXT,
                callNotes     TEXT,
                pushEmailSentAt TEXT,
                tags          TEXT,
                template_id   INTEGER,
                FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS candidates (
                id        INTEGER PRIMARY KEY,
                name      TEXT NOT NULL,
                role      TEXT,
                location  TEXT,
                seniority TEXT,
                tech      TEXT,
                linkedin  TEXT,
                source    TEXT,
                status    TEXT,
                notes     TEXT,
                createdAt TEXT,
                updatedAt TEXT
            );

            CREATE TABLE IF NOT EXISTS push_logs (
                id            INTEGER PRIMARY KEY,
                prospect_id   INTEGER NOT NULL,
                sentAt        TEXT NOT NULL,
                channel       TEXT,
                to_email      TEXT,
                subject       TEXT,
                body          TEXT,
                template_id   INTEGER,
                template_name TEXT,
                createdAt     TEXT NOT NULL,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS call_logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                prospect_id INTEGER NOT NULL,
                owner_id    INTEGER NOT NULL,
                date        TEXT NOT NULL,
                called_at   TEXT NOT NULL,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_call_logs_owner_date ON call_logs(owner_id, date);
            CREATE INDEX IF NOT EXISTS idx_call_logs_prospect ON call_logs(prospect_id);

            CREATE TABLE IF NOT EXISTS templates (
                id         INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                subject    TEXT,
                body       TEXT,
                is_default INTEGER DEFAULT 0,
                createdAt  TEXT,
                updatedAt  TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_push_logs_prospect_id ON push_logs(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_push_logs_sentAt ON push_logs(sentAt);
            CREATE INDEX IF NOT EXISTS idx_templates_default ON templates(is_default);

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

CREATE TABLE IF NOT EXISTS saved_views (
    id        INTEGER PRIMARY KEY,
    page      TEXT NOT NULL,
    name      TEXT NOT NULL,
    state     TEXT NOT NULL,
    createdAt TEXT,
    updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_saved_views_page ON saved_views(page);

CREATE TABLE IF NOT EXISTS opportunities (
    id             INTEGER PRIMARY KEY,
    company_id      INTEGER NOT NULL,
    title          TEXT NOT NULL,
    stage          TEXT NOT NULL,
    candidate_name TEXT,
    candidate_link TEXT,
    amount         REAL,
    notes          TEXT,
    createdAt      TEXT,
    updatedAt      TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(company_id);

CREATE TABLE IF NOT EXISTS company_events (
    id        INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL,
    date      TEXT NOT NULL,
    type      TEXT,
    title     TEXT,
    content   TEXT,
    meta      TEXT,
    createdAt TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_company_events_company ON company_events(company_id);
CREATE INDEX IF NOT EXISTS idx_company_events_date ON company_events(date);

CREATE TABLE IF NOT EXISTS prospect_events (
    id         INTEGER PRIMARY KEY,
    prospect_id INTEGER NOT NULL,
    date       TEXT NOT NULL,
    type       TEXT,
    title      TEXT,
    content    TEXT,
    meta       TEXT,
    createdAt  TEXT,
    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prospect_events_prospect ON prospect_events(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_events_date ON prospect_events(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_events_unique ON prospect_events(prospect_id, type, date);

CREATE TABLE IF NOT EXISTS prospect_attachments (
    id            INTEGER PRIMARY KEY,
    prospect_id   INTEGER NOT NULL,
    owner_id      INTEGER NOT NULL,
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size          INTEGER,
    mime_type     TEXT,
    description   TEXT,
    meeting_id    INTEGER,
    tags          TEXT,
    thumbnail     TEXT,
    extracted_text TEXT,
    createdAt     TEXT NOT NULL,
    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prospect_attachments_prospect ON prospect_attachments(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_attachments_owner ON prospect_attachments(owner_id);

CREATE TABLE IF NOT EXISTS prospect_summaries (
    prospect_id INTEGER PRIMARY KEY,
    owner_id    INTEGER NOT NULL,
    summary     TEXT,
    generatedAt TEXT,
    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidate_events (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL,
    date         TEXT NOT NULL,
    type         TEXT,
    title        TEXT,
    content      TEXT,
    meta         TEXT,
    createdAt    TEXT,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_candidate_events_candidate ON candidate_events(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_events_date ON candidate_events(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_events_unique ON candidate_events(candidate_id, type, date);

CREATE TABLE IF NOT EXISTS push_categories (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    keywords       TEXT,
    auto_detected  INTEGER DEFAULT 0,
    owner_id       INTEGER,
    candidate1_id  INTEGER,
    candidate2_id  INTEGER,
    no_candidates  INTEGER DEFAULT 0,
    createdAt      TEXT,
    updatedAt      TEXT,
    UNIQUE(name, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_push_categories_name ON push_categories(name);

CREATE TABLE IF NOT EXISTS rdv_checklists (
    id          INTEGER PRIMARY KEY,
    prospect_id INTEGER NOT NULL UNIQUE,
    data        TEXT,
    updatedAt   TEXT,
    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rdv_checklists_prospect ON rdv_checklists(prospect_id);

-- Candidate EC1 checklist (v15.1)
CREATE TABLE IF NOT EXISTS candidate_ec1_checklists (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL UNIQUE,
    interviewAt  TEXT,
    data         TEXT,
    updatedAt    TEXT,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_candidate_ec1_candidate ON candidate_ec1_checklists(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_ec1_interviewAt ON candidate_ec1_checklists(interviewAt);

-- Candidate tabs (EC1 + note libre, v25) — onglets fiche candidat
CREATE TABLE IF NOT EXISTS candidate_tabs (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    type         TEXT NOT NULL,
    title        TEXT NOT NULL,
    payload      TEXT,
    updated_at   TEXT,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_candidate_tabs_candidate ON candidate_tabs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_tabs_sort ON candidate_tabs(candidate_id, sort_order);

-- Candidate experiences (v26.6: enrichissement IA structuré)
CREATE TABLE IF NOT EXISTS candidate_experiences (
    id           INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    role         TEXT,
    start_date   TEXT,
    end_date     TEXT,
    description  TEXT,
    technologies TEXT,
    owner_id     INTEGER,
    createdAt    TEXT,
    updatedAt    TEXT,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_candidate_experiences_candidate ON candidate_experiences(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_experiences_owner ON candidate_experiences(owner_id);

-- Candidate educations (v26.6: enrichissement IA structuré)
CREATE TABLE IF NOT EXISTS candidate_educations (
    id            INTEGER PRIMARY KEY,
    candidate_id  INTEGER NOT NULL,
    degree        TEXT,
    school        TEXT NOT NULL,
    year          TEXT,
    specialization TEXT,
    owner_id      INTEGER,
    createdAt     TEXT,
    updatedAt     TEXT,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_candidate_educations_candidate ON candidate_educations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_educations_owner ON candidate_educations(owner_id);

-- Candidate certifications (v26.6: enrichissement IA structuré)
CREATE TABLE IF NOT EXISTS candidate_certifications (
    id            INTEGER PRIMARY KEY,
    candidate_id  INTEGER NOT NULL,
    name          TEXT NOT NULL,
    issuer        TEXT,
    obtained_date TEXT,
    expiry_date   TEXT,
    owner_id      INTEGER,
    createdAt     TEXT,
    updatedAt     TEXT,
    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_candidate_certifications_candidate ON candidate_certifications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_certifications_owner ON candidate_certifications(owner_id);

CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    comment     TEXT,
    due_date    TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    linked_ids  TEXT,
    createdAt   TEXT,
    updatedAt   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Embeddings cache (Phase 1: matching sémantique)
CREATE TABLE IF NOT EXISTS embeddings_cache (
    id          INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,  -- 'prospect', 'candidate', 'tag', 'metier'
    entity_id   INTEGER,        -- ID de l'entité (prospect_id, candidate_id, ou NULL pour tag/metier)
    text_key    TEXT NOT NULL,  -- Texte ou tag pour lequel on a l'embedding
    embedding   TEXT NOT NULL,  -- JSON array de floats
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(entity_type, entity_id, text_key)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_lookup ON embeddings_cache(entity_type, text_key);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

CREATE TABLE IF NOT EXISTS task_rules (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    trigger_type  TEXT NOT NULL,
    conditions    TEXT NOT NULL,
    template_title TEXT NOT NULL,
    template_comment TEXT,
    priority      INTEGER DEFAULT 2,
    enabled       INTEGER DEFAULT 1,
    owner_id      INTEGER,
    createdAt     TEXT,
    updatedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_rules_trigger ON task_rules(trigger_type, enabled);
CREATE INDEX IF NOT EXISTS idx_task_rules_owner ON task_rules(owner_id);

-- v23.5: search performance indexes (columns that exist in CREATE TABLE)
CREATE INDEX IF NOT EXISTS idx_prospects_name ON prospects(name);
CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email);
CREATE INDEX IF NOT EXISTS idx_companies_groupe ON companies(groupe);
CREATE INDEX IF NOT EXISTS idx_push_logs_sentAt ON push_logs(sentAt);

-- v23.5: audit trail table
CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    action    TEXT NOT NULL,
    entity    TEXT NOT NULL,
    entity_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    ip        TEXT,
    createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_date ON audit_log(createdAt);

-- v27.2: Assistant virtuel — historique des conversations
CREATE TABLE IF NOT EXISTS assistant_history (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    session_id TEXT,
    role      TEXT NOT NULL,
    content   TEXT NOT NULL,
    metadata  TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_history_user ON assistant_history(user_id);
CREATE INDEX IF NOT EXISTS idx_assistant_history_session ON assistant_history(session_id);
CREATE INDEX IF NOT EXISTS idx_assistant_history_date ON assistant_history(createdAt);

-- v27.10: journal d'activité multi-utilisateurs
CREATE TABLE IF NOT EXISTS activity_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    username     TEXT NOT NULL,
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    INTEGER,
    entity_label TEXT,
    details      TEXT,
    ip_address   TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user   ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_date   ON activity_logs(created_at);
'''
        )

        # --- Migrations légères ---
        def _add_col(table: str, col: str, ddl: str):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl};")

        # Companies (v6) – champs enrichis pour la fiche entreprise
        ccols = [r["name"] for r in conn.execute("PRAGMA table_info(companies);").fetchall()]
        if "website" not in ccols:
            _add_col("companies", "website", "TEXT")
        if "linkedin" not in ccols:
            _add_col("companies", "linkedin", "TEXT")
        if "industry" not in ccols:
            _add_col("companies", "industry", "TEXT")
        if "size" not in ccols:
            _add_col("companies", "size", "TEXT")
        if "address" not in ccols:
            _add_col("companies", "address", "TEXT")
        if "city" not in ccols:
            _add_col("companies", "city", "TEXT")
        if "country" not in ccols:
            _add_col("companies", "country", "TEXT")
        if "stack" not in ccols:
            _add_col("companies", "stack", "TEXT")
        if "pain_points" not in ccols:
            _add_col("companies", "pain_points", "TEXT")
        if "budget" not in ccols:
            _add_col("companies", "budget", "TEXT")
        if "urgency" not in ccols:
            _add_col("companies", "urgency", "TEXT")
        if "owner_id" not in ccols:
            _add_col("companies", "owner_id", "INTEGER")

        # Prospects (v4→v6)
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(prospects);").fetchall()]

        if "nextFollowUp" not in cols:
            _add_col("prospects", "nextFollowUp", "TEXT")
        if "priority" not in cols:
            _add_col("prospects", "priority", "INTEGER")
        if "pushEmailSentAt" not in cols:
            _add_col("prospects", "pushEmailSentAt", "TEXT")
        if "tags" not in cols:
            _add_col("prospects", "tags", "TEXT")
        if "template_id" not in cols:
            _add_col("prospects", "template_id", "INTEGER")
        if "nextAction" not in cols:
            _add_col("prospects", "nextAction", "TEXT")
        if "pushLinkedInSentAt" not in cols:
            _add_col("prospects", "pushLinkedInSentAt", "TEXT")
        if "photo_url" not in cols:
            _add_col("prospects", "photo_url", "TEXT")
        if "push_category_id" not in cols:
            _add_col("prospects", "push_category_id", "INTEGER")
        if "fixedMetier" not in cols:
            _add_col("prospects", "fixedMetier", "TEXT")
        if "rdvDate" not in cols:
            _add_col("prospects", "rdvDate", "TEXT")
        # Migration: renommer is_contact en is_archived
        if "is_contact" in cols and "is_archived" not in cols:
            conn.execute("ALTER TABLE prospects ADD COLUMN is_archived INTEGER")
            conn.execute("UPDATE prospects SET is_archived = is_contact")
        elif "is_archived" not in cols:
            _add_col("prospects", "is_archived", "INTEGER")
        # Cas où les deux colonnes coexistent (is_archived ajouté vide avant la copie)
        if "is_contact" in cols and "is_archived" in cols:
            conn.execute("UPDATE prospects SET is_archived = is_contact WHERE is_contact = 1 AND (is_archived IS NULL OR is_archived = 0)")
        if "owner_id" not in cols:
            _add_col("prospects", "owner_id", "INTEGER")

        # Custom metiers (user-added tags/specialties)
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS custom_metiers (
                id        INTEGER PRIMARY KEY,
                type      TEXT NOT NULL,
                category  TEXT NOT NULL,
                specialty TEXT,
                tech_group TEXT,
                value     TEXT NOT NULL,
                createdAt TEXT
            );
        ''')

        lcols = [r["name"] for r in conn.execute("PRAGMA table_info(push_logs);").fetchall()]
        if "template_id" not in lcols:
            _add_col("push_logs", "template_id", "INTEGER")
        if "template_name" not in lcols:
            _add_col("push_logs", "template_name", "TEXT")
        # v25.3: Traçabilité candidats et consultants dans push_logs
        if "candidate_id1" not in lcols:
            _add_col("push_logs", "candidate_id1", "INTEGER")
        if "candidate_id2" not in lcols:
            _add_col("push_logs", "candidate_id2", "INTEGER")
        if "consultant1_id" not in lcols:
            _add_col("push_logs", "consultant1_id", "INTEGER")
        if "consultant2_id" not in lcols:
            _add_col("push_logs", "consultant2_id", "INTEGER")
        # v26.6: Optimisation mailing (timing et A/B testing)
        if "sent_at_hour" not in lcols:
            _add_col("push_logs", "sent_at_hour", "INTEGER")
        if "sent_at_day_of_week" not in lcols:
            _add_col("push_logs", "sent_at_day_of_week", "INTEGER")
        if "variant_id" not in lcols:
            _add_col("push_logs", "variant_id", "TEXT")
        if "opened_at" not in lcols:
            _add_col("push_logs", "opened_at", "TEXT")
        if "clicked_at" not in lcols:
            _add_col("push_logs", "clicked_at", "TEXT")
        if "replied_at" not in lcols:
            _add_col("push_logs", "replied_at", "TEXT")
        if "tracking_pixel_id" not in lcols:
            _add_col("push_logs", "tracking_pixel_id", "TEXT")

        cand_cols = [r["name"] for r in conn.execute("PRAGMA table_info(candidates);").fetchall()]
        # Links & matching (v5.1+)
        if "onenote_url" not in cand_cols:
            _add_col("candidates", "onenote_url", "TEXT")
        if "vsa_url" not in cand_cols:
            _add_col("candidates", "vsa_url", "TEXT")
        # JSON list of skills (e.g. ["c++","rtos"]) stored as TEXT
        if "skills" not in cand_cols:
            _add_col("candidates", "skills", "TEXT")
        # JSON list of company ids (e.g. [12, 42]) stored as TEXT
        if "company_ids" not in cand_cols:
            _add_col("candidates", "company_ids", "TEXT")
        if "is_archived" not in cand_cols:
            _add_col("candidates", "is_archived", "INTEGER")
        # v11: years of experience (numeric) replaces seniority text
        if "years_experience" not in cand_cols:
            _add_col("candidates", "years_experience", "INTEGER")
        if "sector" not in cand_cols:
            _add_col("candidates", "sector", "TEXT")
        if "phone" not in cand_cols:
            _add_col("candidates", "phone", "TEXT")
        if "email" not in cand_cols:
            _add_col("candidates", "email", "TEXT")
        if "dossier_competence_pdf" not in cand_cols:
            _add_col("candidates", "dossier_competence_pdf", "TEXT")
        if "owner_id" not in cand_cols:
            _add_col("candidates", "owner_id", "INTEGER")
        # v27.x PARTIE 3: champs pour extraction DC + génération push .msg
        if "prenom" not in cand_cols:
            _add_col("candidates", "prenom", "TEXT")
        if "titre" not in cand_cols:
            _add_col("candidates", "titre", "TEXT")
        if "annees_experience" not in cand_cols:
            _add_col("candidates", "annees_experience", "INTEGER")
        if "domaine_principal" not in cand_cols:
            _add_col("candidates", "domaine_principal", "TEXT")
        # v27.4: description push IA (cache Ollama)
        if "description_push" not in cand_cols:
            _add_col("candidates", "description_push", "TEXT")
        # v28.1: champs fiche entretien candidat
        for _col, _ddl in [
            ("disponibilite", "TEXT"),
            ("mobilite", "TEXT"),
            ("permis_conduire", "INTEGER"),
            ("vehicule", "INTEGER"),
            ("permis_travail", "TEXT"),
            ("fonctions_recherchees", "TEXT"),
            ("motif_recherche", "TEXT"),
            ("avancement_recherches", "TEXT"),
            ("remuneration_actuelle", "TEXT"),
            ("pretentions_salariales", "TEXT"),
            ("propal_a", "TEXT"),
            ("eval_technique", "TEXT"),
            ("eval_personnalite", "TEXT"),
            ("eval_communication", "TEXT"),
            ("langues", "TEXT"),
            ("references_candidat", "TEXT"),
            ("avis_perso", "TEXT"),
        ]:
            if _col not in cand_cols:
                _add_col("candidates", _col, _ddl)

        # v30.0: champs entretien inline
        for _col, _ddl in [
            ("entretien_date", "TEXT"),
            ("entretien_lieu", "TEXT"),
            ("entretien_notes", "TEXT"),
        ]:
            if _col not in cand_cols:
                _add_col("candidates", _col, _ddl)

        # v29.0: DC Generator — dossier généré par le générateur interne
        if "dossier_path" not in cand_cols:
            _add_col("candidates", "dossier_path", "TEXT")
        if "dossier_generated_at" not in cand_cols:
            _add_col("candidates", "dossier_generated_at", "DATETIME")

        # v23.5: Soft delete — add deleted_at column to main tables
        for tbl in ("prospects", "companies", "candidates"):
            tbl_cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({tbl});").fetchall()]
            if "deleted_at" not in tbl_cols:
                _add_col(tbl, "deleted_at", "TEXT")

        # v23.3+: indexes on owner_id (created after migration adds the column)
        conn.executescript('''
            CREATE INDEX IF NOT EXISTS idx_prospects_owner ON prospects(owner_id);
            CREATE INDEX IF NOT EXISTS idx_prospects_owner_statut ON prospects(owner_id, statut);
            CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_id);
            CREATE INDEX IF NOT EXISTS idx_candidates_owner ON candidates(owner_id);
        ''')

        # v27.9: indexes on high-frequency filter/join columns (added after deleted_at migration)
        conn.executescript('''
            CREATE INDEX IF NOT EXISTS idx_prospects_company_id ON prospects(company_id);
            CREATE INDEX IF NOT EXISTS idx_prospects_next_followup ON prospects(nextFollowUp);
            CREATE INDEX IF NOT EXISTS idx_prospects_last_contact ON prospects(lastContact);
            CREATE INDEX IF NOT EXISTS idx_prospects_owner_deleted ON prospects(owner_id, deleted_at);
            CREATE INDEX IF NOT EXISTS idx_companies_owner_deleted ON companies(owner_id, deleted_at);
            CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
            CREATE INDEX IF NOT EXISTS idx_candidates_owner_deleted ON candidates(owner_id, deleted_at);
            CREATE INDEX IF NOT EXISTS idx_push_logs_prospect_sentAt ON push_logs(prospect_id, sentAt);
        ''')
        
        # v25.9: Add owner_id to push_categories for per-user categories
        pc_cols = [r["name"] for r in conn.execute("PRAGMA table_info(push_categories);").fetchall()]
        if "owner_id" not in pc_cols:
            _add_col("push_categories", "owner_id", "INTEGER")
            # Migrate existing categories: assign to first admin user, or NULL if no users
            with _auth_conn() as auth_conn:
                admin_user = auth_conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1;").fetchone()
                if admin_user:
                    conn.execute("UPDATE push_categories SET owner_id=? WHERE owner_id IS NULL;", (admin_user["id"],))
            conn.executescript('''
                CREATE INDEX IF NOT EXISTS idx_push_categories_owner ON push_categories(owner_id);
            ''')
        # v27.3: Add default candidate slots to push categories
        if "candidate1_id" not in pc_cols:
            _add_col("push_categories", "candidate1_id", "INTEGER")
        if "candidate2_id" not in pc_cols:
            _add_col("push_categories", "candidate2_id", "INTEGER")

        # App settings (v11) — key/value config store
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            );
        ''')

        # Users table (v15) — multi-user auth
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id           INTEGER PRIMARY KEY,
                username     TEXT NOT NULL UNIQUE,
                display_name TEXT,
                password_hash TEXT NOT NULL,
                role         TEXT NOT NULL DEFAULT 'reader',
                is_active    INTEGER DEFAULT 1,
                createdAt    TEXT,
                lastLoginAt  TEXT
            );
        ''')

        # Refresh tokens for mobile JWT auth (v24.0)
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id         INTEGER PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                revoked    INTEGER DEFAULT 0,
                device     TEXT,
                createdAt  TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        ''')

        # Mode Prosp sessions persistées (v28.1) — survivent aux redémarrages serveur
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS mode_prosp_sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                ids        TEXT NOT NULL,
                created_at REAL NOT NULL
            );
        ''')

        # Paires de prospects marquées "pas un doublon" (v27.3)
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS duplicate_ignores (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id       INTEGER NOT NULL,
                prospect_id_a  INTEGER NOT NULL,
                prospect_id_b  INTEGER NOT NULL,
                created_at     TEXT DEFAULT (datetime(\'now\')),
                UNIQUE(owner_id, prospect_id_a, prospect_id_b)
            );
            CREATE INDEX IF NOT EXISTS idx_dup_ignores_owner ON duplicate_ignores(owner_id);
        ''')

        # Shared companies for collaboration (v25.5+)
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS shared_companies (
                id          INTEGER PRIMARY KEY,
                company_id  INTEGER NOT NULL,
                from_user_id INTEGER NOT NULL,
                to_user_id  INTEGER NOT NULL,
                shared_at   TEXT NOT NULL,
                FOREIGN KEY(from_user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(to_user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_shared_companies_from ON shared_companies(from_user_id);
            CREATE INDEX IF NOT EXISTS idx_shared_companies_to ON shared_companies(to_user_id);
            CREATE INDEX IF NOT EXISTS idx_shared_companies_company ON shared_companies(company_id);
        ''')

        # Manual KPI entries table (v16.5)
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS manual_kpi (
                id          INTEGER PRIMARY KEY,
                user_id     INTEGER,
                type        TEXT NOT NULL,
                date        TEXT NOT NULL,
                count       INTEGER DEFAULT 1,
                description TEXT,
                createdAt   TEXT
            );
        ''')
        
        # Meetings table (v25.10) — historique des réunions avec grille de qualification
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS meetings (
                id            INTEGER PRIMARY KEY,
                prospect_id  INTEGER NOT NULL,
                owner_id     INTEGER NOT NULL,
                date         TEXT NOT NULL,
                title        TEXT NOT NULL,
                checklist_data TEXT,
                notes        TEXT,
                createdAt    TEXT NOT NULL,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
                FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_meetings_prospect ON meetings(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_meetings_owner ON meetings(owner_id);
            CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(date);
            
            CREATE TABLE IF NOT EXISTS meeting_action_items (
                id            INTEGER PRIMARY KEY,
                meeting_id    INTEGER NOT NULL,
                prospect_id   INTEGER NOT NULL,
                task          TEXT NOT NULL,
                assignee      TEXT,
                due_date      TEXT,
                priority      TEXT,
                status        TEXT NOT NULL DEFAULT 'pending',
                owner_id      INTEGER NOT NULL,
                createdAt     TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
                FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting ON meeting_action_items(meeting_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_action_items_prospect ON meeting_action_items(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_action_items_owner ON meeting_action_items(owner_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_action_items_status ON meeting_action_items(status);
            
            CREATE TABLE IF NOT EXISTS meeting_opportunities (
                id              INTEGER PRIMARY KEY,
                meeting_id      INTEGER NOT NULL,
                prospect_id     INTEGER NOT NULL,
                type            TEXT NOT NULL,
                estimated_value REAL,
                probability     INTEGER,
                description     TEXT,
                owner_id        INTEGER NOT NULL,
                createdAt       TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
                FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_meeting_opportunities_meeting ON meeting_opportunities(meeting_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_opportunities_prospect ON meeting_opportunities(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_opportunities_owner ON meeting_opportunities(owner_id);
        ''')

        # LinkedIn InMails (dashboard objectifs sourcing)
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS linkedin_inmails (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                url        TEXT NOT NULL,
                note       TEXT,
                sent_at    TEXT NOT NULL,
                owner_id   INTEGER NOT NULL,
                created_at REAL
            );
            CREATE INDEX IF NOT EXISTS idx_linkedin_inmails_owner_date ON linkedin_inmails(owner_id, sent_at);

            -- v31: persistent DC generation history (replaces in-session list)
            CREATE TABLE IF NOT EXISTS dc_generations (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_id INTEGER,
                filename     TEXT,
                file_path    TEXT NOT NULL,
                used_ollama  INTEGER DEFAULT 0,
                generated_at TEXT NOT NULL,
                owner_id     INTEGER NOT NULL,
                deleted_at   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_dc_gen_owner_date ON dc_generations(owner_id, generated_at);
            CREATE INDEX IF NOT EXISTS idx_dc_gen_candidate ON dc_generations(candidate_id, owner_id);

            -- v31: standalone calendar events (créés depuis l'UI v30)
            CREATE TABLE IF NOT EXISTS calendar_events (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT NOT NULL,
                event_date   TEXT NOT NULL,
                event_time   TEXT,
                duration_min INTEGER,
                location     TEXT,
                notes        TEXT,
                status       TEXT DEFAULT 'planifie',
                event_type   TEXT DEFAULT 'rdv',
                prospect_id  INTEGER,
                candidate_id INTEGER,
                company_id   INTEGER,
                owner_id     INTEGER NOT NULL,
                created_at   TEXT,
                updated_at   TEXT,
                deleted_at   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_cal_evt_owner_date ON calendar_events(owner_id, event_date);

            -- v32.1 : Transcription de réunions (pipeline Whisper + pyannote + Claude)
            CREATE TABLE IF NOT EXISTS transcriptions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                title           TEXT NOT NULL,
                audio_filename  TEXT NOT NULL,
                audio_path      TEXT NOT NULL,
                audio_size      INTEGER,
                duration_sec    REAL,
                language        TEXT,
                status          TEXT NOT NULL DEFAULT 'pending',
                progress        INTEGER NOT NULL DEFAULT 0,
                stage           TEXT,
                error_message   TEXT,
                transcript_text TEXT,
                segments_json   TEXT,
                speakers_json   TEXT,
                analysis_json   TEXT,
                whisper_model   TEXT,
                analysis_model  TEXT,
                owner_id        INTEGER NOT NULL,
                created_at      TEXT NOT NULL,
                updated_at      TEXT,
                completed_at    TEXT,
                deleted_at      TEXT,
                FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_transcriptions_owner ON transcriptions(owner_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);
        ''')

        # Seed default admin if no users exist
        user_count = conn.execute("SELECT COUNT(*) AS n FROM users;").fetchone()["n"]
        if user_count == 0:
            now = datetime.datetime.now().isoformat(timespec="seconds")
            conn.execute(
                "INSERT INTO users (username, display_name, password_hash, role, is_active, createdAt) VALUES (?, ?, ?, ?, 1, ?);",
                ("admin", "Antoine (Admin)", generate_password_hash("admin"), "admin", now)
            )
            print("Compte admin cree — login: admin / mdp: admin (a changer !)")

        # Migration: reader -> editor (rôles simplifiés à admin + editor uniquement)
        try:
            conn.execute("UPDATE users SET role='editor' WHERE role='reader';")
        except Exception:
            pass

        # Migration: attribuer prospects/candidats/companies/saved_views/tasks sans owner au premier utilisateur (admin)
        try:
            first_user = conn.execute("SELECT id FROM users WHERE is_active=1 ORDER BY id LIMIT 1;").fetchone()
            if first_user:
                uid = first_user["id"]
                conn.execute("UPDATE prospects SET owner_id=? WHERE owner_id IS NULL;", (uid,))
                conn.execute("UPDATE candidates SET owner_id=? WHERE owner_id IS NULL;", (uid,))
                conn.execute("UPDATE companies SET owner_id=? WHERE owner_id IS NULL;", (uid,))
                try:
                    vcols = [r["name"] for r in conn.execute("PRAGMA table_info(saved_views);").fetchall()]
                    if "owner_id" in vcols:
                        conn.execute("UPDATE saved_views SET owner_id=? WHERE owner_id IS NULL;", (uid,))
                except Exception:
                    pass
                try:
                    tcols = [r["name"] for r in conn.execute("PRAGMA table_info(tasks);").fetchall()]
                    if "owner_id" in tcols:
                        conn.execute("UPDATE tasks SET owner_id=? WHERE owner_id IS NULL;", (uid,))
                except Exception:
                    pass
        except Exception:
            pass

        # saved_views et tasks : colonne owner_id (isolation par user)
        try:
            vcols = [r["name"] for r in conn.execute("PRAGMA table_info(saved_views);").fetchall()]
            if "owner_id" not in vcols:
                _add_col("saved_views", "owner_id", "INTEGER")
                first = conn.execute("SELECT id FROM users WHERE is_active=1 ORDER BY id LIMIT 1;").fetchone()
                if first:
                    conn.execute("UPDATE saved_views SET owner_id=? WHERE owner_id IS NULL;", (first["id"],))
        except Exception:
            pass
        try:
            tcols = [r["name"] for r in conn.execute("PRAGMA table_info(tasks);").fetchall()]
            if "owner_id" not in tcols:
                _add_col("tasks", "owner_id", "INTEGER")
                first = conn.execute("SELECT id FROM users WHERE is_active=1 ORDER BY id LIMIT 1;").fetchone()
                if first:
                    conn.execute("UPDATE tasks SET owner_id=? WHERE owner_id IS NULL;", (first["id"],))
        except Exception:
            pass

        tpl_cols = [r["name"] for r in conn.execute("PRAGMA table_info(templates);").fetchall()]
        if "linkedin_body" not in tpl_cols:
            _add_col("templates", "linkedin_body", "TEXT")

        # Users: must_change_password flag (v25.1)
        try:
            ucols_check = [r["name"] for r in conn.execute("PRAGMA table_info(users);").fetchall()]
            if "must_change_password" not in ucols_check:
                _add_col("users", "must_change_password", "INTEGER DEFAULT 0")
        except Exception:
            pass

        # Users: onboarding (popup bienvenue / visite guidée pour nouveaux utilisateurs uniquement)
        try:
            ucols = [r["name"] for r in conn.execute("PRAGMA table_info(users);").fetchall()]
            if "onboarding_seen" not in ucols:
                _add_col("users", "onboarding_seen", "INTEGER DEFAULT 0")
                conn.execute("UPDATE users SET onboarding_seen=1;")
            else:
                # Backfill une seule fois : utilisateurs existants = déjà vus (évite popup aux collègues actuels)
                try:
                    row = conn.execute("SELECT value FROM app_settings WHERE key=?;", ("onboarding_backfill_done",)).fetchone()
                    if not row or row["value"] != "1":
                        conn.execute("UPDATE users SET onboarding_seen=1;")
                        conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);", ("onboarding_backfill_done", "1"))
                except Exception:
                    pass
        except Exception:
            pass

        # Meetings (v31.8) — colonnes pour CR détaillés (raw transcript, summary IA, next_action, tags snapshot, documents)
        try:
            mcols = [r["name"] for r in conn.execute("PRAGMA table_info(meetings);").fetchall()]
            if "summary" not in mcols:
                _add_col("meetings", "summary", "TEXT")
            if "raw_transcript" not in mcols:
                _add_col("meetings", "raw_transcript", "TEXT")
            if "next_action" not in mcols:
                _add_col("meetings", "next_action", "TEXT")
            if "tags" not in mcols:
                _add_col("meetings", "tags", "TEXT")
            if "documents" not in mcols:
                _add_col("meetings", "documents", "TEXT")
        except Exception:
            pass

        # prospect_attachments (v31.9) — pièces jointes par prospect, isolées par owner
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS prospect_attachments (
                    id            INTEGER PRIMARY KEY,
                    prospect_id   INTEGER NOT NULL,
                    owner_id      INTEGER NOT NULL,
                    filename      TEXT NOT NULL,
                    original_name TEXT NOT NULL,
                    size          INTEGER,
                    mime_type     TEXT,
                    description   TEXT,
                    meeting_id    INTEGER,
                    createdAt     TEXT NOT NULL,
                    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
                );
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_prospect_attachments_prospect ON prospect_attachments(prospect_id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_prospect_attachments_owner ON prospect_attachments(owner_id);")
        except Exception:
            pass

        # prospect_attachments (v32.0) — colonnes tags / thumbnail / extracted_text
        try:
            acols = [r["name"] for r in conn.execute("PRAGMA table_info(prospect_attachments);").fetchall()]
            if "tags" not in acols:
                _add_col("prospect_attachments", "tags", "TEXT")
            if "thumbnail" not in acols:
                _add_col("prospect_attachments", "thumbnail", "TEXT")
            if "extracted_text" not in acols:
                _add_col("prospect_attachments", "extracted_text", "TEXT")
        except Exception:
            pass

        # prospect_summaries (v32.0) — cache résumés IA des fiches
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS prospect_summaries (
                    prospect_id INTEGER PRIMARY KEY,
                    owner_id    INTEGER NOT NULL,
                    summary     TEXT,
                    generatedAt TEXT,
                    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
                );
            """)
        except Exception:
            pass

        # push_categories (v32.3) — colonnes candidats par défaut + flag no_candidates
        try:
            pc_cols = [r["name"] for r in conn.execute("PRAGMA table_info(push_categories);").fetchall()]
            if "candidate1_id" not in pc_cols:
                _add_col("push_categories", "candidate1_id", "INTEGER")
            if "candidate2_id" not in pc_cols:
                _add_col("push_categories", "candidate2_id", "INTEGER")
            if "no_candidates" not in pc_cols:
                _add_col("push_categories", "no_candidates", "INTEGER DEFAULT 0")
        except Exception:
            pass

        # Seed template par défaut si besoin
        n = conn.execute("SELECT COUNT(*) AS n FROM templates;").fetchone()["n"]
        if n == 0:
            now = datetime.datetime.now().isoformat(timespec="seconds")
            default_subject = "Prospection - {{entreprise}}"

            default_body = """Bonjour {{civilite}} {{nom}},

Je vous contacte en tant qu'ingénieur d'affaires au sein d'Up Technologies.

Up Technologies est une société de conseil en ingénierie spécialisée en électronique (hardware et software), informatique et systèmes.

Je souhaiterais échanger avec vous pour étudier des pistes de collaboration.
Pourriez-vous me communiquer vos prochains créneaux disponibles afin de planifier un échange s’il vous plaît ?

Cordialement,"""
            conn.execute(
                '''
                INSERT INTO templates (name, subject, body, linkedin_body, is_default, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, 1, ?, ?);
                ''',
                (
                    "Template par défaut",
                    default_subject,
                    default_body,
                    # Par défaut, on réutilise le body email pour LinkedIn (modifiable ensuite)
                    default_body,
                    now,
                    now,
                ),
            )

        # Migration: corriger les templates dont la phrase d'intro est incomplète.
        # Remplace toute variante de "au sein … Technologies." (avec ou sans HTML, avec ou sans "d'Up")
        # par la version correcte avec mise en forme orange.
        try:
            import re as _re_tmpl
            _PHRASE_PATTERN = _re_tmpl.compile(
                r"au sein\s*(?:<[^>]*>\s*)*(?:d['']Up\s+)?(?:\s*)Technologies\.",
                _re_tmpl.DOTALL | _re_tmpl.IGNORECASE
            )
            _PHRASE_REPLACE = "au sein <span style=\"color:#E07020;font-weight:bold;\">d'Up Technologies.</span>"
            _tmpl_rows = conn.execute("SELECT id, body, linkedin_body FROM templates;").fetchall()
            _tmpl_updated = False
            for _tr in _tmpl_rows:
                _bid, _body, _lbody = _tr["id"], _tr["body"] or "", _tr["linkedin_body"] or ""
                _new_body  = _PHRASE_PATTERN.sub(_PHRASE_REPLACE, _body)
                _new_lbody = _PHRASE_PATTERN.sub(_PHRASE_REPLACE, _lbody)
                if _new_body != _body or _new_lbody != _lbody:
                    conn.execute(
                        "UPDATE templates SET body=?, linkedin_body=? WHERE id=?;",
                        (_new_body, _new_lbody, _bid)
                    )
                    _tmpl_updated = True
            if _tmpl_updated:
                conn.commit()
        except Exception:
            pass

        # v25: candidate_tabs (onglets fiche candidat) — migration depuis candidate_ec1_checklists
        _migrate_candidate_tabs(conn)



def _migrate_candidate_tabs(conn: sqlite3.Connection) -> None:
    """Crée candidate_tabs si absent et migre les données depuis candidate_ec1_checklists (v25)."""
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS candidate_tabs (
                id           INTEGER PRIMARY KEY,
                candidate_id INTEGER NOT NULL,
                sort_order   INTEGER NOT NULL DEFAULT 0,
                type         TEXT NOT NULL,
                title        TEXT NOT NULL,
                payload      TEXT,
                updated_at   TEXT,
                FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_candidate_tabs_candidate ON candidate_tabs(candidate_id);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_candidate_tabs_sort ON candidate_tabs(candidate_id, sort_order);")
        conn.commit()
    except Exception:
        pass
    # Migrer chaque EC1 existant vers le premier onglet
    try:
        rows = conn.execute(
            "SELECT candidate_id, interviewAt, data, updatedAt FROM candidate_ec1_checklists;"
        ).fetchall()
        now = datetime.datetime.now().isoformat(timespec="seconds")
        for row in rows:
            cid = row["candidate_id"]
            existing = conn.execute(
                "SELECT id FROM candidate_tabs WHERE candidate_id=? AND sort_order=0;",
                (cid,),
            ).fetchone()
            if existing:
                continue
            try:
                data = json.loads(row["data"]) if row["data"] else {}
            except Exception:
                data = {}
            payload = json.dumps(
                {"interviewAt": row["interviewAt"] or None, "data": data},
                ensure_ascii=False,
            )
            conn.execute(
                """INSERT INTO candidate_tabs (candidate_id, sort_order, type, title, payload, updated_at)
                   VALUES (?, 0, 'ec1', 'EC1', ?, ?);""",
                (cid, payload, row["updatedAt"] or now),
            )
        conn.commit()
    except Exception:
        pass


def _migrate_user_db_schema(db_path: Path) -> None:
    """Ajoute deleted_at aux tables companies, prospects, candidates si absent (v23.5).
    Ajoute aussi dossier_competence_pdf à la table candidates si absent.
    v25: candidate_tabs + migration depuis candidate_ec1_checklists.
    v27: migration is_contact → is_archived pour les DBs per-user."""
    if not db_path.exists():
        return
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        for tbl in ("companies", "prospects", "candidates"):
            try:
                cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({tbl});").fetchall()]
            except Exception:
                continue
            # PRAGMA renvoie [] si la table n'existe pas (DB user vide) — skip
            # pour éviter un ALTER TABLE qui échoue.
            if not cols:
                continue
            if "deleted_at" not in cols:
                conn.execute(f"ALTER TABLE {tbl} ADD COLUMN deleted_at TEXT;")
                conn.commit()
        # Migration: is_contact → is_archived pour prospects (per-user DBs)
        try:
            pros_cols = [r["name"] for r in conn.execute("PRAGMA table_info(prospects);").fetchall()]
            if "is_contact" in pros_cols and "is_archived" not in pros_cols:
                conn.execute("ALTER TABLE prospects ADD COLUMN is_archived INTEGER;")
                conn.execute("UPDATE prospects SET is_archived = is_contact;")
                conn.commit()
                print(f"[OK] Migration is_contact -> is_archived (add+copy) sur {db_path}")
            elif "is_archived" not in pros_cols:
                conn.execute("ALTER TABLE prospects ADD COLUMN is_archived INTEGER;")
                conn.commit()
            # Cas où les deux colonnes coexistent : copier les valeurs manquantes
            if "is_contact" in pros_cols and "is_archived" in pros_cols:
                conn.execute("UPDATE prospects SET is_archived = is_contact WHERE is_contact = 1 AND (is_archived IS NULL OR is_archived = 0);")
                conn.commit()
        except Exception as e:
            print(f"[WARN] Migration is_archived prospects ({db_path}): {e}")
        # Migration: ajouter colonnes candidates (schéma complet aligné sur la main DB)
        try:
            cand_cols = [r["name"] for r in conn.execute("PRAGMA table_info(candidates);").fetchall()]
            _cand_migrations = [
                ("dossier_competence_pdf", "TEXT"),
                ("description_push", "TEXT"),
                ("prenom", "TEXT"),
                ("titre", "TEXT"),
                ("annees_experience", "INTEGER"),
                ("domaine_principal", "TEXT"),
                ("disponibilite", "TEXT"),
                ("mobilite", "TEXT"),
                ("permis_conduire", "INTEGER"),
                ("vehicule", "INTEGER"),
                ("permis_travail", "TEXT"),
                ("fonctions_recherchees", "TEXT"),
                ("motif_recherche", "TEXT"),
                ("avancement_recherches", "TEXT"),
                ("remuneration_actuelle", "TEXT"),
                ("pretentions_salariales", "TEXT"),
                ("propal_a", "TEXT"),
                ("eval_technique", "TEXT"),
                ("eval_personnalite", "TEXT"),
                ("eval_communication", "TEXT"),
                ("langues", "TEXT"),
                ("references_candidat", "TEXT"),
                ("avis_perso", "TEXT"),
                ("entretien_date", "TEXT"),
                ("entretien_lieu", "TEXT"),
                ("entretien_notes", "TEXT"),
                ("dossier_path", "TEXT"),
                ("dossier_generated_at", "DATETIME"),
            ]
            for col, typ in _cand_migrations:
                if col not in cand_cols:
                    conn.execute(f"ALTER TABLE candidates ADD COLUMN {col} {typ};")
            conn.commit()
        except Exception as e:
            print(f"[WARN] Migration candidates columns ({db_path}): {e}")
        _migrate_candidate_tabs(conn)
        # Migration: créer custom_metiers si absent (v27.22 — tag management)
        try:
            conn.execute('''CREATE TABLE IF NOT EXISTS custom_metiers (
                id        INTEGER PRIMARY KEY,
                type      TEXT NOT NULL,
                category  TEXT NOT NULL,
                specialty TEXT,
                tech_group TEXT,
                value     TEXT NOT NULL,
                createdAt TEXT
            )''')
            conn.commit()
        except Exception:
            pass
        # Migration: créer call_logs si absent (stats appels per-user)
        try:
            conn.execute('''CREATE TABLE IF NOT EXISTS call_logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                prospect_id INTEGER NOT NULL,
                owner_id    INTEGER NOT NULL,
                date        TEXT NOT NULL,
                called_at   TEXT NOT NULL,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
            )''')
            conn.execute("CREATE INDEX IF NOT EXISTS idx_call_logs_owner_date ON call_logs(owner_id, date);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_call_logs_prospect ON call_logs(prospect_id);")
            conn.commit()
        except Exception:
            pass
        # Migration v25.3+: push_logs (traçabilité + analytics + tracking pixel) per-user
        try:
            pl_cols = {r["name"] for r in conn.execute("PRAGMA table_info(push_logs);").fetchall()}
            for col, typ in (
                ("candidate_id1", "INTEGER"),
                ("candidate_id2", "INTEGER"),
                ("consultant1_id", "INTEGER"),
                ("consultant2_id", "INTEGER"),
                ("sent_at_hour", "INTEGER"),
                ("sent_at_day_of_week", "INTEGER"),
                ("variant_id", "TEXT"),
                ("opened_at", "TEXT"),
                ("clicked_at", "TEXT"),
                ("replied_at", "TEXT"),
                ("tracking_pixel_id", "TEXT"),
                ("campaign_id", "INTEGER"),
            ):
                if col not in pl_cols:
                    conn.execute(f"ALTER TABLE push_logs ADD COLUMN {col} {typ};")
            conn.commit()
        except Exception as e:
            print(f"[WARN] Migration push_logs columns ({db_path}): {e}")

        # Migration v27.3: push_categories default candidate slots
        # Migration v32.2: no_candidates flag (push categorie "sans consultant")
        try:
            pc_cols = {r["name"] for r in conn.execute("PRAGMA table_info(push_categories);").fetchall()}
            for col, typ in (
                ("candidate1_id", "INTEGER"),
                ("candidate2_id", "INTEGER"),
                ("no_candidates", "INTEGER DEFAULT 0"),
            ):
                if col not in pc_cols:
                    conn.execute(f"ALTER TABLE push_categories ADD COLUMN {col} {typ};")
            conn.commit()
        except Exception as e:
            print(f"[WARN] Migration push_categories candidates ({db_path}): {e}")

        # Migration: tables diverses souvent absentes des vieilles per-user DBs
        try:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS mode_prosp_sessions (
                    token      TEXT PRIMARY KEY,
                    user_id    INTEGER NOT NULL,
                    ids        TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS candidate_skills (
                    id           INTEGER PRIMARY KEY,
                    candidate_id INTEGER NOT NULL,
                    name         TEXT NOT NULL,
                    category     TEXT,
                    level        INTEGER DEFAULT 3,
                    UNIQUE(candidate_id, name),
                    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS candidate_availability (
                    id           INTEGER PRIMARY KEY,
                    candidate_id INTEGER NOT NULL,
                    week_iso     TEXT NOT NULL,
                    status       TEXT NOT NULL,
                    UNIQUE(candidate_id, week_iso),
                    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS duplicate_ignores (
                    id             INTEGER PRIMARY KEY,
                    owner_id       INTEGER NOT NULL,
                    prospect_id_a  INTEGER NOT NULL,
                    prospect_id_b  INTEGER NOT NULL,
                    created_at     TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_duplicate_ignores_owner ON duplicate_ignores(owner_id);
                CREATE TABLE IF NOT EXISTS embeddings_cache (
                    id          INTEGER PRIMARY KEY,
                    entity_type TEXT NOT NULL,
                    entity_id   INTEGER,
                    text_key    TEXT NOT NULL,
                    embedding   TEXT NOT NULL,
                    created_at  TEXT DEFAULT (datetime('now')),
                    UNIQUE(entity_type, entity_id, text_key)
                );
                CREATE INDEX IF NOT EXISTS idx_embeddings_lookup ON embeddings_cache(entity_type, text_key);
            ''')
            conn.commit()
        except Exception as e:
            print(f"[WARN] Migration tables diverses ({db_path}): {e}")
        # Migration v29+: créer toutes les tables d'événements et KPI manquantes dans les DBs per-user existantes
        # Ces tables sont essentielles pour les KPIs et la gamification (prospect_events, candidate_events, etc.)
        try:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS company_events (
                    id        INTEGER PRIMARY KEY,
                    company_id INTEGER NOT NULL,
                    date      TEXT NOT NULL,
                    type      TEXT,
                    title     TEXT,
                    content   TEXT,
                    meta      TEXT,
                    createdAt TEXT,
                    FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_company_events_company ON company_events(company_id);
                CREATE INDEX IF NOT EXISTS idx_company_events_date ON company_events(date);

                CREATE TABLE IF NOT EXISTS prospect_events (
                    id         INTEGER PRIMARY KEY,
                    prospect_id INTEGER NOT NULL,
                    date       TEXT NOT NULL,
                    type       TEXT,
                    title      TEXT,
                    content    TEXT,
                    meta       TEXT,
                    createdAt  TEXT,
                    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_prospect_events_prospect ON prospect_events(prospect_id);
                CREATE INDEX IF NOT EXISTS idx_prospect_events_date ON prospect_events(date);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_events_unique ON prospect_events(prospect_id, type, date);

                CREATE TABLE IF NOT EXISTS candidate_events (
                    id           INTEGER PRIMARY KEY,
                    candidate_id INTEGER NOT NULL,
                    date         TEXT NOT NULL,
                    type         TEXT,
                    title        TEXT,
                    content      TEXT,
                    meta         TEXT,
                    createdAt    TEXT,
                    FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_candidate_events_candidate ON candidate_events(candidate_id);
                CREATE INDEX IF NOT EXISTS idx_candidate_events_date ON candidate_events(date);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_events_unique ON candidate_events(candidate_id, type, date);

                CREATE TABLE IF NOT EXISTS push_logs (
                    id            INTEGER PRIMARY KEY,
                    prospect_id   INTEGER NOT NULL,
                    sentAt        TEXT NOT NULL,
                    channel       TEXT,
                    to_email      TEXT,
                    subject       TEXT,
                    body          TEXT,
                    template_id   INTEGER,
                    template_name TEXT,
                    createdAt     TEXT NOT NULL,
                    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_push_logs_prospect_id ON push_logs(prospect_id);
                CREATE INDEX IF NOT EXISTS idx_push_logs_sentAt ON push_logs(sentAt);

                CREATE TABLE IF NOT EXISTS push_categories (
                    id            INTEGER PRIMARY KEY,
                    name          TEXT NOT NULL,
                    keywords      TEXT,
                    auto_detected INTEGER DEFAULT 0,
                    owner_id      INTEGER,
                    candidate1_id INTEGER,
                    candidate2_id INTEGER,
                    no_candidates INTEGER DEFAULT 0,
                    createdAt     TEXT,
                    updatedAt     TEXT,
                    UNIQUE(name, owner_id)
                );
                CREATE INDEX IF NOT EXISTS idx_push_categories_name ON push_categories(name);
                CREATE INDEX IF NOT EXISTS idx_push_categories_owner ON push_categories(owner_id);

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

                CREATE TABLE IF NOT EXISTS rdv_checklists (
                    id          INTEGER PRIMARY KEY,
                    prospect_id INTEGER NOT NULL UNIQUE,
                    data        TEXT,
                    updatedAt   TEXT,
                    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS manual_kpi (
                    id          INTEGER PRIMARY KEY,
                    user_id     INTEGER,
                    type        TEXT NOT NULL,
                    date        TEXT NOT NULL,
                    count       INTEGER DEFAULT 1,
                    description TEXT,
                    createdAt   TEXT
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id          INTEGER PRIMARY KEY,
                    title       TEXT NOT NULL,
                    comment     TEXT,
                    due_date    TEXT,
                    status      TEXT NOT NULL DEFAULT 'pending',
                    linked_ids  TEXT,
                    createdAt   TEXT,
                    updatedAt   TEXT,
                    owner_id    INTEGER
                );

                CREATE TABLE IF NOT EXISTS task_rules (
                    id            INTEGER PRIMARY KEY,
                    name          TEXT NOT NULL,
                    trigger_type  TEXT NOT NULL,
                    conditions    TEXT NOT NULL,
                    template_title TEXT NOT NULL,
                    template_comment TEXT,
                    priority      INTEGER DEFAULT 2,
                    enabled       INTEGER DEFAULT 1,
                    owner_id      INTEGER,
                    createdAt     TEXT,
                    updatedAt     TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_task_rules_trigger ON task_rules(trigger_type, enabled);
                CREATE INDEX IF NOT EXISTS idx_task_rules_owner ON task_rules(owner_id);

                CREATE TABLE IF NOT EXISTS meetings (
                    id            INTEGER PRIMARY KEY,
                    prospect_id  INTEGER NOT NULL,
                    owner_id     INTEGER NOT NULL,
                    date         TEXT NOT NULL,
                    title        TEXT NOT NULL,
                    checklist_data TEXT,
                    notes        TEXT,
                    createdAt    TEXT NOT NULL,
                    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_action_items (
                    id            INTEGER PRIMARY KEY,
                    meeting_id    INTEGER NOT NULL,
                    prospect_id   INTEGER NOT NULL,
                    task          TEXT NOT NULL,
                    assignee      TEXT,
                    due_date      TEXT,
                    priority      TEXT,
                    status        TEXT NOT NULL DEFAULT 'pending',
                    owner_id      INTEGER NOT NULL,
                    createdAt     TEXT NOT NULL,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_opportunities (
                    id              INTEGER PRIMARY KEY,
                    meeting_id      INTEGER NOT NULL,
                    prospect_id     INTEGER NOT NULL,
                    type            TEXT NOT NULL,
                    estimated_value REAL,
                    probability     INTEGER,
                    description     TEXT,
                    owner_id        INTEGER NOT NULL,
                    createdAt       TEXT NOT NULL,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                    FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS linkedin_inmails (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    url        TEXT NOT NULL,
                    note       TEXT,
                    sent_at    TEXT NOT NULL,
                    owner_id   INTEGER NOT NULL,
                    created_at REAL
                );
                CREATE INDEX IF NOT EXISTS idx_linkedin_inmails_owner_date ON linkedin_inmails(owner_id, sent_at);

                CREATE TABLE IF NOT EXISTS dc_generations (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    candidate_id INTEGER,
                    filename     TEXT,
                    file_path    TEXT NOT NULL,
                    used_ollama  INTEGER DEFAULT 0,
                    generated_at TEXT NOT NULL,
                    owner_id     INTEGER NOT NULL,
                    deleted_at   TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_dc_gen_owner_date ON dc_generations(owner_id, generated_at);
                CREATE INDEX IF NOT EXISTS idx_dc_gen_candidate ON dc_generations(candidate_id, owner_id);

                CREATE TABLE IF NOT EXISTS calendar_events (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    title        TEXT NOT NULL,
                    event_date   TEXT NOT NULL,
                    event_time   TEXT,
                    duration_min INTEGER,
                    location     TEXT,
                    notes        TEXT,
                    status       TEXT DEFAULT 'planifie',
                    event_type   TEXT DEFAULT 'rdv',
                    prospect_id  INTEGER,
                    candidate_id INTEGER,
                    company_id   INTEGER,
                    owner_id     INTEGER NOT NULL,
                    created_at   TEXT,
                    updated_at   TEXT,
                    deleted_at   TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_cal_evt_owner_date ON calendar_events(owner_id, event_date);
            ''')
        except Exception as e:
            print(f"[WARN] Migration tables KPI manquantes ({db_path}): {e}")
    finally:
        conn.close()


_CANDIDATE_STATUS_MIGRATION = {
    "a_sourcer": "nouveau",
    "a_contacter": "proposition",
    "a_contacter_relance": "proposition",
    "en_cours": "entretien",
    "ec1": "entretien",
    "ec2": "entretien",
    "ed": "a_faire",
    "interesse": "oksi",
    "mission": "freelance_mission",
    "embauche": "valide_contrat",
    "refuse": "nok",
    "archive": "plus_disponible",
}


def _migrate_candidate_statuses(db_path: Path) -> None:
    """Migre les anciens statuts candidats vers les nouveaux slugs."""
    try:
        conn = sqlite3.connect(db_path)
        for old, new in _CANDIDATE_STATUS_MIGRATION.items():
            conn.execute(
                "UPDATE candidates SET status=? WHERE status=? AND deleted_at IS NULL;",
                (new, old),
            )
        # Sync is_archived for archive statuses
        archive_statuses = ("nok_prequal", "nok", "plus_disponible", "refus_contrat")
        placeholders = ",".join("?" * len(archive_statuses))
        conn.execute(
            f"UPDATE candidates SET is_archived=1 WHERE status IN ({placeholders}) AND deleted_at IS NULL;",
            archive_statuses,
        )
        conn.execute(
            f"UPDATE candidates SET is_archived=0 WHERE status NOT IN ({placeholders}) AND deleted_at IS NULL;",
            archive_statuses,
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning("migrate_candidate_statuses %s: %s", db_path, e)


def _migrate_call_logs_to_user_db(user_id: int, user_db: Path) -> None:
    """Copie les call_logs de la DB globale vers la DB per-user si la table est vide."""
    try:
        if not DB_PATH.exists():
            return
        conn = sqlite3.connect(user_db)
        conn.row_factory = sqlite3.Row
        count = conn.execute("SELECT COUNT(*) AS n FROM call_logs WHERE owner_id=?;", (user_id,)).fetchone()["n"]
        if count > 0:
            conn.close()
            return  # Déjà des données, pas besoin de migrer
        conn.close()
        global_conn = sqlite3.connect(DB_PATH)
        global_conn.row_factory = sqlite3.Row
        try:
            rows = global_conn.execute(
                "SELECT prospect_id, owner_id, date, called_at FROM call_logs WHERE owner_id=?;",
                (user_id,)
            ).fetchall()
        except Exception:
            rows = []
        finally:
            global_conn.close()
        if not rows:
            return
        conn = sqlite3.connect(user_db)
        conn.execute("PRAGMA foreign_keys = OFF;")
        conn.executemany(
            "INSERT OR IGNORE INTO call_logs (prospect_id, owner_id, date, called_at) VALUES (?, ?, ?, ?);",
            [(r["prospect_id"], r["owner_id"], r["date"], r["called_at"]) for r in rows]
        )
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.commit()
        conn.close()
        print(f"[OK] {len(rows)} call_logs récupérés depuis DB globale vers {user_db}")
    except Exception as e:
        print(f"[WARN] Migration call_logs ({user_db}): {e}")


def _v30_schema_sql() -> str:
    """Schémas additifs v30 (push_campaigns, saved_views colonnes, skills, availability)."""
    return '''
    CREATE TABLE IF NOT EXISTS push_campaigns (
        id           INTEGER PRIMARY KEY,
        owner_id     INTEGER NOT NULL,
        name         TEXT NOT NULL,
        category_id  INTEGER,
        template_id  INTEGER,
        filters_json TEXT,
        scheduled_at TEXT,
        sent_at      TEXT,
        stats_json   TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_push_campaigns_owner ON push_campaigns(owner_id);

    CREATE TABLE IF NOT EXISTS candidate_skills (
        id           INTEGER PRIMARY KEY,
        candidate_id INTEGER NOT NULL,
        name         TEXT NOT NULL,
        category     TEXT,
        level        INTEGER NOT NULL DEFAULT 3,
        UNIQUE(candidate_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_cand_skills_cid ON candidate_skills(candidate_id);

    CREATE TABLE IF NOT EXISTS candidate_availability (
        id           INTEGER PRIMARY KEY,
        candidate_id INTEGER NOT NULL,
        week_iso     TEXT NOT NULL,
        status       TEXT NOT NULL,
        UNIQUE(candidate_id, week_iso)
    );
    CREATE INDEX IF NOT EXISTS idx_cand_avail_cid ON candidate_availability(candidate_id);
    '''


def _v30_apply_migrations(conn) -> list[str]:
    """Applique les migrations v30 sur une connexion DB. Retourne la liste des changements effectués."""
    done: list[str] = []
    # 1. Tables additives
    cur = conn.cursor()
    existing = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    for t in ("push_campaigns", "candidate_skills", "candidate_availability"):
        if t not in existing:
            done.append(f"create:{t}")
    conn.executescript(_v30_schema_sql())
    conn.commit()

    # 2. saved_views : ajouter colonnes v30 (owner_id, filters_json, columns_json, is_shared)
    try:
        sv_cols = {r[1] for r in cur.execute("PRAGMA table_info(saved_views);").fetchall()}
        if sv_cols:
            if "owner_id" not in sv_cols:
                cur.execute("ALTER TABLE saved_views ADD COLUMN owner_id INTEGER;")
                done.append("alter:saved_views.owner_id")
            if "filters_json" not in sv_cols:
                cur.execute("ALTER TABLE saved_views ADD COLUMN filters_json TEXT;")
                done.append("alter:saved_views.filters_json")
            if "columns_json" not in sv_cols:
                cur.execute("ALTER TABLE saved_views ADD COLUMN columns_json TEXT;")
                done.append("alter:saved_views.columns_json")
            if "is_shared" not in sv_cols:
                cur.execute("ALTER TABLE saved_views ADD COLUMN is_shared INTEGER DEFAULT 0;")
                done.append("alter:saved_views.is_shared")
            # Backfill filters_json depuis state si ancienne colonne présente
            if "state" in sv_cols and "filters_json" in sv_cols:
                cur.execute(
                    "UPDATE saved_views SET filters_json = state "
                    "WHERE filters_json IS NULL AND state IS NOT NULL;"
                )
                if cur.rowcount:
                    done.append(f"backfill:saved_views.filters_json({cur.rowcount})")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_saved_views_owner_page "
                "ON saved_views(owner_id, page);"
            )
    except Exception as e:
        print(f"[v30_migrate] WARN saved_views ({e})")

    # 3. push_logs : ajouter colonne campaign_id
    try:
        pl_cols = {r[1] for r in cur.execute("PRAGMA table_info(push_logs);").fetchall()}
        if pl_cols and "campaign_id" not in pl_cols:
            cur.execute("ALTER TABLE push_logs ADD COLUMN campaign_id INTEGER;")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_push_logs_campaign "
                "ON push_logs(campaign_id);"
            )
            done.append("alter:push_logs.campaign_id")
    except Exception as e:
        print(f"[v30_migrate] WARN push_logs ({e})")

    # 4. linkedin_inmails : ajouter colonne name (enrichissement Tavily)
    try:
        li_cols = {r[1] for r in cur.execute("PRAGMA table_info(linkedin_inmails);").fetchall()}
        if li_cols and "name" not in li_cols:
            cur.execute("ALTER TABLE linkedin_inmails ADD COLUMN name TEXT;")
            done.append("alter:linkedin_inmails.name")
    except Exception as e:
        print(f"[v30_migrate] WARN linkedin_inmails ({e})")

    conn.commit()
    return done


def _v30_needs_migration() -> bool:
    """Retourne True si au moins une des nouvelles tables v30 n'existe pas dans la DB principale."""
    try:
        with _conn() as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name IN ('push_campaigns','candidate_skills','candidate_availability');"
            ).fetchall()
            return len(rows) < 3
    except Exception:
        return True


def _migrate_v30_all() -> None:
    """Orchestre la migration v30 : backup si nécessaire, puis apply sur toutes les DB."""
    need = _v30_needs_migration()
    if need:
        try:
            from scripts.v30_backup import backup_all_databases
            backup_path = backup_all_databases(reason="v30_auto_migration")
            if backup_path:
                print(f"[v30_migrate] Backup pre-migration : {backup_path}")
        except Exception as e:
            print(f"[v30_migrate] WARN backup impossible ({e}) — on continue quand meme")

    # DB principale
    try:
        with _conn() as conn:
            changes = _v30_apply_migrations(conn)
            if changes:
                print(f"[v30_migrate] main: {', '.join(changes)}")
    except Exception as e:
        print(f"[v30_migrate] ERR main DB: {e}")

    # DBs per-user (filtre sur existence + user valide)
    if not DATA_DIR.exists():
        return
    try:
        valid_ids: set[int] = set()
        try:
            with _auth_conn() as ac:
                for row in ac.execute("SELECT id FROM users;").fetchall():
                    valid_ids.add(int(row["id"]))
        except Exception:
            pass
        for p in DATA_DIR.iterdir():
            if not p.is_dir() or not p.name.startswith("user_"):
                continue
            try:
                uid = int(p.name.replace("user_", "", 1))
            except ValueError:
                continue
            if valid_ids and uid not in valid_ids:
                continue
            user_db = p / "prospects.db"
            if not user_db.exists():
                continue
            try:
                c2 = sqlite3.connect(user_db)
                c2.row_factory = sqlite3.Row
                changes = _v30_apply_migrations(c2)
                c2.close()
                if changes:
                    print(f"[v30_migrate] user_{uid}: {', '.join(changes)}")
            except Exception as e:
                print(f"[v30_migrate] ERR user_{uid}: {e}")
    except Exception as e:
        print(f"[v30_migrate] WARN per-user loop ({e})")


def _migrate_all_user_dbs() -> None:
    """Migre toutes les DB per-user (deleted_at) et supprime les dossiers orphelins."""
    if not DATA_DIR.exists():
        return
    valid_ids = set()
    with _auth_conn() as conn:
        for row in conn.execute("SELECT id FROM users;").fetchall():
            valid_ids.add(int(row["id"]))
    for p in DATA_DIR.iterdir():
        if not p.is_dir() or not p.name.startswith("user_"):
            continue
        try:
            uid = int(p.name.replace("user_", "", 1))
        except ValueError:
            continue
        user_db = p / "prospects.db"
        if user_db.exists():
            if uid not in valid_ids:
                try:
                    shutil.rmtree(p)
                    print(f"[OK] Dossier orphelin supprime : {p}")
                except Exception as e:
                    print(f"[WARN] Impossible de supprimer {p}: {e}")
            else:
                _migrate_user_db_schema(user_db)
                _migrate_candidate_statuses(user_db)
                _migrate_call_logs_to_user_db(uid, user_db)


def _migrate_users_schema() -> None:
    """Ajoute les colonnes email, phone, avatar à la table users si absentes (v27.7)."""
    with _auth_conn() as conn:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(users);")}
        if "email" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT;")
        if "phone" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN phone TEXT;")
        if "avatar" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT;")


def _init_user_db(user_id: int) -> Path:
    """Crée et initialise la DB isolée d'un nouvel utilisateur dans data/user_<id>/prospects.db."""
    user_dir = DATA_DIR / f"user_{user_id}"
    user_dir.mkdir(parents=True, exist_ok=True)
    user_db = user_dir / "prospects.db"

    conn = sqlite3.connect(user_db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 20000;")
    conn.execute("PRAGMA journal_mode = WAL;")
    try:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS companies (
                id        INTEGER PRIMARY KEY,
                groupe    TEXT NOT NULL,
                site      TEXT NOT NULL,
                phone     TEXT,
                notes     TEXT,
                tags      TEXT,
                website   TEXT,
                linkedin  TEXT,
                industry  TEXT,
                size      TEXT,
                address   TEXT,
                city      TEXT,
                country   TEXT,
                stack     TEXT,
                pain_points TEXT,
                budget    TEXT,
                urgency   TEXT,
                owner_id  INTEGER,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS prospects (
                id            INTEGER PRIMARY KEY,
                name          TEXT NOT NULL,
                company_id    INTEGER NOT NULL,
                fonction      TEXT,
                telephone     TEXT,
                email         TEXT,
                linkedin      TEXT,
                pertinence    TEXT,
                statut        TEXT,
                lastContact   TEXT,
                nextFollowUp  TEXT,
                priority      INTEGER,
                notes         TEXT,
                callNotes     TEXT,
                pushEmailSentAt TEXT,
                tags          TEXT,
                template_id   INTEGER,
                nextAction    TEXT,
                pushLinkedInSentAt TEXT,
                photo_url     TEXT,
                push_category_id INTEGER,
                fixedMetier   TEXT,
                rdvDate       TEXT,
                is_archived   INTEGER,
                owner_id      INTEGER,
                deleted_at    TEXT,
                FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
            );

            CREATE TABLE IF NOT EXISTS candidates (
                id        INTEGER PRIMARY KEY,
                name      TEXT NOT NULL,
                role      TEXT,
                location  TEXT,
                seniority TEXT,
                tech      TEXT,
                linkedin  TEXT,
                source    TEXT,
                status    TEXT,
                notes     TEXT,
                createdAt TEXT,
                updatedAt TEXT,
                onenote_url TEXT,
                vsa_url   TEXT,
                skills    TEXT,
                company_ids TEXT,
                is_archived INTEGER,
                years_experience INTEGER,
                sector    TEXT,
                phone     TEXT,
                email     TEXT,
                dossier_competence_pdf TEXT,
                owner_id  INTEGER,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS push_logs (
                id            INTEGER PRIMARY KEY,
                prospect_id   INTEGER NOT NULL,
                sentAt        TEXT NOT NULL,
                channel       TEXT,
                to_email      TEXT,
                subject       TEXT,
                body          TEXT,
                template_id   INTEGER,
                template_name TEXT,
                createdAt     TEXT NOT NULL,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS templates (
                id         INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                subject    TEXT,
                body       TEXT,
                is_default INTEGER DEFAULT 0,
                createdAt  TEXT,
                updatedAt  TEXT,
                linkedin_body TEXT
            );

            CREATE TABLE IF NOT EXISTS saved_views (
                id        INTEGER PRIMARY KEY,
                page      TEXT NOT NULL,
                name      TEXT NOT NULL,
                state     TEXT NOT NULL,
                createdAt TEXT,
                updatedAt TEXT,
                owner_id  INTEGER
            );

            CREATE TABLE IF NOT EXISTS opportunities (
                id             INTEGER PRIMARY KEY,
                company_id      INTEGER NOT NULL,
                title          TEXT NOT NULL,
                stage          TEXT NOT NULL,
                candidate_name TEXT,
                candidate_link TEXT,
                amount         REAL,
                notes          TEXT,
                createdAt      TEXT,
                updatedAt      TEXT,
                FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS company_events (
                id        INTEGER PRIMARY KEY,
                company_id INTEGER NOT NULL,
                date      TEXT NOT NULL,
                type      TEXT,
                title     TEXT,
                content   TEXT,
                meta      TEXT,
                createdAt TEXT,
                FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS prospect_events (
                id         INTEGER PRIMARY KEY,
                prospect_id INTEGER NOT NULL,
                date       TEXT NOT NULL,
                type       TEXT,
                title      TEXT,
                content    TEXT,
                meta       TEXT,
                createdAt  TEXT,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS candidate_events (
                id           INTEGER PRIMARY KEY,
                candidate_id INTEGER NOT NULL,
                date         TEXT NOT NULL,
                type         TEXT,
                title        TEXT,
                content      TEXT,
                meta         TEXT,
                createdAt    TEXT,
                FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS push_categories (
                id            INTEGER PRIMARY KEY,
                name          TEXT NOT NULL,
                keywords      TEXT,
                auto_detected INTEGER DEFAULT 0,
                owner_id      INTEGER,
                candidate1_id INTEGER,
                candidate2_id INTEGER,
                no_candidates INTEGER DEFAULT 0,
                createdAt     TEXT,
                updatedAt     TEXT,
                UNIQUE(name, owner_id)
            );

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

            CREATE TABLE IF NOT EXISTS rdv_checklists (
                id          INTEGER PRIMARY KEY,
                prospect_id INTEGER NOT NULL UNIQUE,
                data        TEXT,
                updatedAt   TEXT,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS candidate_ec1_checklists (
                id           INTEGER PRIMARY KEY,
                candidate_id INTEGER NOT NULL UNIQUE,
                interviewAt  TEXT,
                data         TEXT,
                updatedAt    TEXT,
                FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS candidate_tabs (
                id           INTEGER PRIMARY KEY,
                candidate_id INTEGER NOT NULL,
                sort_order   INTEGER NOT NULL DEFAULT 0,
                type         TEXT NOT NULL,
                title        TEXT NOT NULL,
                payload      TEXT,
                updated_at   TEXT,
                FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_candidate_tabs_candidate ON candidate_tabs(candidate_id);
            CREATE INDEX IF NOT EXISTS idx_candidate_tabs_sort ON candidate_tabs(candidate_id, sort_order);

            -- Candidate experiences (v26.6: enrichissement IA structuré)
            CREATE TABLE IF NOT EXISTS candidate_experiences (
                id           INTEGER PRIMARY KEY,
                candidate_id INTEGER NOT NULL,
                company_name TEXT NOT NULL,
                role         TEXT,
                start_date   TEXT,
                end_date     TEXT,
                description  TEXT,
                technologies TEXT,
                owner_id     INTEGER,
                createdAt    TEXT,
                updatedAt    TEXT,
                FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_candidate_experiences_candidate ON candidate_experiences(candidate_id);
            CREATE INDEX IF NOT EXISTS idx_candidate_experiences_owner ON candidate_experiences(owner_id);

            -- Candidate educations (v26.6: enrichissement IA structuré)
            CREATE TABLE IF NOT EXISTS candidate_educations (
                id            INTEGER PRIMARY KEY,
                candidate_id  INTEGER NOT NULL,
                degree        TEXT,
                school        TEXT NOT NULL,
                year          TEXT,
                specialization TEXT,
                owner_id      INTEGER,
                createdAt     TEXT,
                updatedAt     TEXT,
                FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_candidate_educations_candidate ON candidate_educations(candidate_id);
            CREATE INDEX IF NOT EXISTS idx_candidate_educations_owner ON candidate_educations(owner_id);

            -- Candidate certifications (v26.6: enrichissement IA structuré)
            CREATE TABLE IF NOT EXISTS candidate_certifications (
                id            INTEGER PRIMARY KEY,
                candidate_id  INTEGER NOT NULL,
                name          TEXT NOT NULL,
                issuer        TEXT,
                obtained_date TEXT,
                expiry_date   TEXT,
                owner_id      INTEGER,
                createdAt     TEXT,
                updatedAt     TEXT,
                FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_candidate_certifications_candidate ON candidate_certifications(candidate_id);
            CREATE INDEX IF NOT EXISTS idx_candidate_certifications_owner ON candidate_certifications(owner_id);

            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY,
                title       TEXT NOT NULL,
                comment     TEXT,
                due_date    TEXT,
                status      TEXT NOT NULL DEFAULT 'pending',
                linked_ids  TEXT,
                createdAt   TEXT,
                updatedAt   TEXT,
                owner_id    INTEGER
            );

            CREATE TABLE IF NOT EXISTS task_rules (
                id            INTEGER PRIMARY KEY,
                name          TEXT NOT NULL,
                trigger_type  TEXT NOT NULL,
                conditions    TEXT NOT NULL,
                template_title TEXT NOT NULL,
                template_comment TEXT,
                priority      INTEGER DEFAULT 2,
                enabled       INTEGER DEFAULT 1,
                owner_id      INTEGER,
                createdAt     TEXT,
                updatedAt     TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_task_rules_trigger ON task_rules(trigger_type, enabled);
            CREATE INDEX IF NOT EXISTS idx_task_rules_owner ON task_rules(owner_id);

            CREATE TABLE IF NOT EXISTS custom_metiers (
                id        INTEGER PRIMARY KEY,
                type      TEXT NOT NULL,
                category  TEXT NOT NULL,
                specialty TEXT,
                tech_group TEXT,
                value     TEXT NOT NULL,
                createdAt TEXT
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS manual_kpi (
                id          INTEGER PRIMARY KEY,
                user_id     INTEGER,
                type        TEXT NOT NULL,
                date        TEXT NOT NULL,
                count       INTEGER DEFAULT 1,
                description TEXT,
                createdAt   TEXT
            );

            CREATE TABLE IF NOT EXISTS meetings (
                id            INTEGER PRIMARY KEY,
                prospect_id  INTEGER NOT NULL,
                owner_id     INTEGER NOT NULL,
                date         TEXT NOT NULL,
                title        TEXT NOT NULL,
                checklist_data TEXT,
                notes        TEXT,
                createdAt    TEXT NOT NULL,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
                FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS meeting_action_items (
                id            INTEGER PRIMARY KEY,
                meeting_id    INTEGER NOT NULL,
                prospect_id   INTEGER NOT NULL,
                task          TEXT NOT NULL,
                assignee      TEXT,
                due_date      TEXT,
                priority      TEXT,
                status        TEXT NOT NULL DEFAULT 'pending',
                owner_id      INTEGER NOT NULL,
                createdAt     TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
                FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS meeting_opportunities (
                id              INTEGER PRIMARY KEY,
                meeting_id      INTEGER NOT NULL,
                prospect_id     INTEGER NOT NULL,
                type            TEXT NOT NULL,
                estimated_value REAL,
                probability     INTEGER,
                description     TEXT,
                owner_id        INTEGER NOT NULL,
                createdAt       TEXT NOT NULL,
                FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
                FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS call_logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                prospect_id INTEGER NOT NULL,
                owner_id    INTEGER NOT NULL,
                date        TEXT NOT NULL,
                called_at   TEXT NOT NULL,
                FOREIGN KEY(prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_push_logs_prospect_id ON push_logs(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_push_logs_sentAt ON push_logs(sentAt);
            CREATE INDEX IF NOT EXISTS idx_templates_default ON templates(is_default);
            CREATE INDEX IF NOT EXISTS idx_saved_views_page ON saved_views(page);
            CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(company_id);
            CREATE INDEX IF NOT EXISTS idx_company_events_company ON company_events(company_id);
            CREATE INDEX IF NOT EXISTS idx_company_events_date ON company_events(date);
            CREATE INDEX IF NOT EXISTS idx_prospect_events_prospect ON prospect_events(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_prospect_events_date ON prospect_events(date);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_events_unique ON prospect_events(prospect_id, type, date);
            CREATE INDEX IF NOT EXISTS idx_candidate_events_candidate ON candidate_events(candidate_id);
            CREATE INDEX IF NOT EXISTS idx_candidate_events_date ON candidate_events(date);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_events_unique ON candidate_events(candidate_id, type, date);
            CREATE INDEX IF NOT EXISTS idx_push_categories_name ON push_categories(name);
            CREATE INDEX IF NOT EXISTS idx_push_categories_owner ON push_categories(owner_id);
            CREATE INDEX IF NOT EXISTS idx_rdv_checklists_prospect ON rdv_checklists(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_meetings_prospect ON meetings(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_meetings_owner ON meetings(owner_id);
            CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(date);
            CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting ON meeting_action_items(meeting_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_action_items_prospect ON meeting_action_items(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_action_items_owner ON meeting_action_items(owner_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_action_items_status ON meeting_action_items(status);
            CREATE INDEX IF NOT EXISTS idx_meeting_opportunities_meeting ON meeting_opportunities(meeting_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_opportunities_prospect ON meeting_opportunities(prospect_id);
            CREATE INDEX IF NOT EXISTS idx_meeting_opportunities_owner ON meeting_opportunities(owner_id);
            CREATE INDEX IF NOT EXISTS idx_candidate_ec1_candidate ON candidate_ec1_checklists(candidate_id);
            CREATE INDEX IF NOT EXISTS idx_candidate_ec1_interviewAt ON candidate_ec1_checklists(interviewAt);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
            CREATE INDEX IF NOT EXISTS idx_call_logs_owner_date ON call_logs(owner_id, date);
            CREATE INDEX IF NOT EXISTS idx_call_logs_prospect ON call_logs(prospect_id);

            CREATE TABLE IF NOT EXISTS linkedin_inmails (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                url        TEXT NOT NULL,
                note       TEXT,
                sent_at    TEXT NOT NULL,
                owner_id   INTEGER NOT NULL,
                created_at REAL
            );
            CREATE INDEX IF NOT EXISTS idx_linkedin_inmails_owner_date ON linkedin_inmails(owner_id, sent_at);

            CREATE TABLE IF NOT EXISTS dc_generations (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_id INTEGER,
                filename     TEXT,
                file_path    TEXT NOT NULL,
                used_ollama  INTEGER DEFAULT 0,
                generated_at TEXT NOT NULL,
                owner_id     INTEGER NOT NULL,
                deleted_at   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_dc_gen_owner_date ON dc_generations(owner_id, generated_at);
            CREATE INDEX IF NOT EXISTS idx_dc_gen_candidate ON dc_generations(candidate_id, owner_id);

            CREATE TABLE IF NOT EXISTS calendar_events (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT NOT NULL,
                event_date   TEXT NOT NULL,
                event_time   TEXT,
                duration_min INTEGER,
                location     TEXT,
                notes        TEXT,
                status       TEXT DEFAULT 'planifie',
                event_type   TEXT DEFAULT 'rdv',
                prospect_id  INTEGER,
                candidate_id INTEGER,
                company_id   INTEGER,
                owner_id     INTEGER NOT NULL,
                created_at   TEXT,
                updated_at   TEXT,
                deleted_at   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_cal_evt_owner_date ON calendar_events(owner_id, event_date);
        ''')

        now = datetime.datetime.now().isoformat(timespec="seconds")
        n = conn.execute("SELECT COUNT(*) AS n FROM templates;").fetchone()["n"]
        if n == 0:
            default_subject = "Prospection - {{entreprise}}"
            default_body = """Bonjour {{civilite}} {{nom}},

Je vous contacte en tant qu'ingénieur d'affaires.

Cordialement,"""
            conn.execute(
                "INSERT INTO templates (name, subject, body, linkedin_body, is_default, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?);",
                ("Template par défaut", default_subject, default_body, default_body, now, now),
            )
        conn.commit()
    finally:
        conn.close()

    snap_dir = user_dir / "snapshots"
    snap_dir.mkdir(exist_ok=True)

    try:
        _migrate_user_db_schema(user_db)
    except Exception as e:
        print(f"[WARN] _migrate_user_db_schema sur nouvelle DB {user_db}: {e}")

    print(f"[OK] DB utilisateur creee : {user_db}")
    return user_db


def db_is_empty() -> bool:
    with _conn() as conn:
        c1 = conn.execute("SELECT COUNT(*) AS n FROM companies;").fetchone()["n"]
        c2 = conn.execute("SELECT COUNT(*) AS n FROM prospects;").fetchone()["n"]
    return (c1 == 0) and (c2 == 0)


def read_all(owner_id: int | None = None) -> Dict[str, Any]:
    """Retourne companies et prospects filtrés par owner_id si fourni (tout privé par user)."""
    def _parse_tags(v) -> List[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        s = str(v).strip()
        if not s:
            return []
        try:
            j = json.loads(s)
            if isinstance(j, list):
                return [str(x).strip() for x in j if str(x).strip()]
        except Exception:
            pass
        # fallback "tag1, tag2"
        return [t.strip() for t in s.split(",") if t.strip()]

    with _conn() as conn:
        if owner_id is not None:
            companies = [dict(r) for r in conn.execute("SELECT * FROM companies WHERE owner_id=? AND deleted_at IS NULL ORDER BY id;", (owner_id,)).fetchall()]
        else:
            companies = [dict(r) for r in conn.execute("SELECT * FROM companies WHERE deleted_at IS NULL ORDER BY id;").fetchall()]
        if owner_id is not None:
            prospects_rows = conn.execute(
                "SELECT * FROM prospects WHERE owner_id=? AND deleted_at IS NULL ORDER BY id;", (owner_id,)
            ).fetchall()
        else:
            prospects_rows = conn.execute("SELECT * FROM prospects WHERE deleted_at IS NULL ORDER BY id;").fetchall()

    for c in companies:
        c["tags"] = _parse_tags(c.get("tags"))

    prospects: List[Dict[str, Any]] = []
    for r in prospects_rows:
        d = dict(r)
        try:
            d["callNotes"] = json.loads(d.get("callNotes") or "[]")
        except Exception:
            d["callNotes"] = []
        d["tags"] = _parse_tags(d.get("tags"))
        d["is_archived"] = int(d.get("is_archived") or 0)
        prospects.append(d)

    return {"companies": companies, "prospects": prospects}






def upsert_all(data: Dict[str, Any]) -> None:
    """SAFE save: upsert companies/prospects and delete only missing ids.
    Prospects sont isolés par owner_id (utilisateur connecté)."""
    uid = _uid()
    if uid is None:
        raise ValueError("Authentification requise pour enregistrer")

    companies = data.get("companies") or []
    prospects = data.get("prospects") or []

    if not isinstance(companies, list) or not isinstance(prospects, list):
        raise ValueError("Invalid payload: companies/prospects must be lists")

    # Forcer owner_id sur tous les prospects et companies du payload
    for p in prospects:
        p["owner_id"] = uid
    for c in companies:
        c["owner_id"] = uid

    def _dump_tags(v) -> str:
        if v is None:
            return "[]"
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return "[]"
            if s.startswith("["):
                return s
            parts = [t.strip() for t in s.split(",") if t.strip()]
            return json.dumps(parts, ensure_ascii=False)
        if isinstance(v, list):
            parts = [str(t).strip() for t in v if str(t).strip()]
            return json.dumps(parts, ensure_ascii=False)
        return "[]"

    def _safe_int(v, default=0) -> int:
        try:
            return int(v)
        except Exception:
            return default

    for c in companies:
        c["tags"] = _dump_tags(c.get("tags"))

    for p in prospects:
        if isinstance(p.get("callNotes"), list):
            p["callNotes"] = json.dumps(p["callNotes"], ensure_ascii=False)
        else:
            # preserve if string else default
            p["callNotes"] = p.get("callNotes") if isinstance(p.get("callNotes"), str) else "[]"
        p["tags"] = _dump_tags(p.get("tags"))
        tid = p.get("template_id")
        try:
            p["template_id"] = int(tid) if tid not in (None, "", "null") else None
        except Exception:
            p["template_id"] = None

    with _conn() as conn:
        # Ownership safety: if an incoming id already belongs to another owner,
        # remap it to a fresh global id so we never "steal" rows via ON CONFLICT.
        incoming_company_ids = sorted({
            _safe_int(c.get("id"))
            for c in companies
            if c.get("id") is not None and _safe_int(c.get("id")) > 0
        })
        incoming_prospect_ids = sorted({
            _safe_int(p.get("id"))
            for p in prospects
            if p.get("id") is not None and _safe_int(p.get("id")) > 0
        })

        existing_company_owner: Dict[int, int | None] = {}
        existing_prospect_owner: Dict[int, int | None] = {}
        if incoming_company_ids:
            q_marks = ",".join("?" for _ in incoming_company_ids)
            rows = conn.execute(
                f"SELECT id, owner_id FROM companies WHERE id IN ({q_marks});",
                incoming_company_ids,
            ).fetchall()
            existing_company_owner = {
                int(r["id"]): (int(r["owner_id"]) if r["owner_id"] is not None else None)
                for r in rows
            }
        if incoming_prospect_ids:
            q_marks = ",".join("?" for _ in incoming_prospect_ids)
            rows = conn.execute(
                f"SELECT id, owner_id FROM prospects WHERE id IN ({q_marks});",
                incoming_prospect_ids,
            ).fetchall()
            existing_prospect_owner = {
                int(r["id"]): (int(r["owner_id"]) if r["owner_id"] is not None else None)
                for r in rows
            }

        next_company_id = int(conn.execute(
            "SELECT COALESCE(MAX(id), 0) AS n FROM companies;"
        ).fetchone()["n"])
        next_prospect_id = int(conn.execute(
            "SELECT COALESCE(MAX(id), 0) AS n FROM prospects;"
        ).fetchone()["n"])

        remapped_company_ids: Dict[int, int] = {}
        used_company_ids: set[int] = set()
        for c in companies:
            cid = _safe_int(c.get("id"), 0)
            conflict_owner = cid > 0 and cid in existing_company_owner and existing_company_owner[cid] != uid
            duplicate_payload = cid > 0 and cid in used_company_ids
            missing_or_invalid = cid <= 0
            if conflict_owner or duplicate_payload or missing_or_invalid:
                next_company_id += 1
                while next_company_id in used_company_ids:
                    next_company_id += 1
                if cid > 0 and cid not in remapped_company_ids:
                    remapped_company_ids[cid] = next_company_id
                cid = next_company_id
            c["id"] = cid
            used_company_ids.add(cid)

        if remapped_company_ids:
            for p in prospects:
                old_company_id = _safe_int(p.get("company_id"), 0)
                if old_company_id in remapped_company_ids:
                    p["company_id"] = remapped_company_ids[old_company_id]

        used_prospect_ids: set[int] = set()
        for p in prospects:
            pid = _safe_int(p.get("id"), 0)
            conflict_owner = pid > 0 and pid in existing_prospect_owner and existing_prospect_owner[pid] != uid
            duplicate_payload = pid > 0 and pid in used_prospect_ids
            missing_or_invalid = pid <= 0
            if conflict_owner or duplicate_payload or missing_or_invalid:
                next_prospect_id += 1
                while next_prospect_id in used_prospect_ids:
                    next_prospect_id += 1
                pid = next_prospect_id
            p["id"] = pid
            used_prospect_ids.add(pid)

        company_ids = [int(c["id"]) for c in companies if c.get("id") is not None]
        prospect_ids = [int(p["id"]) for p in prospects if p.get("id") is not None]

        # Guard: comptage des données de l'utilisateur courant uniquement (hors soft-deleted)
        try:
            existing_companies_n = int(conn.execute("SELECT COUNT(*) AS n FROM companies WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchone()["n"])
            existing_prospects_n = int(conn.execute(
                "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)
            ).fetchone()["n"])
        except Exception:
            existing_companies_n = 0
            existing_prospects_n = 0

        force = bool(data.get("force")) or bool(data.get("confirm_mass_delete"))
        if not force:
            incoming_companies_n = len(company_ids)
            incoming_prospects_n = len(prospect_ids)
            if existing_companies_n >= 25 and incoming_companies_n < max(5, int(existing_companies_n * 0.5)):
                raise ValueError("Payload incomplet (entreprises). Refus de supprimer en masse. Rechargez la page puis réessayez, ou envoyez confirm_mass_delete=true.")
            if existing_prospects_n >= 50 and incoming_prospects_n < max(10, int(existing_prospects_n * 0.5)):
                raise ValueError("Payload incomplet (prospects). Refus de supprimer en masse. Rechargez la page puis réessayez, ou envoyez confirm_mass_delete=true.")

        cur = conn.cursor()
        # Désactiver temporairement les FK pour permettre l'ordre DELETE prospects puis DELETE companies (RESTRICT sinon bloquant au commit)
        try:
            cur.execute("PRAGMA foreign_keys = OFF;")
        except Exception:
            pass
        cur.execute("BEGIN;")
        # Snapshot previous prospect statuses/contacts for RDV events and resume hints
        old_prospect_map = {}
        try:
            if prospect_ids:
                q_marks = ",".join("?" for _ in prospect_ids)
                rows0 = cur.execute(
                    f"SELECT id, statut, rdvDate, lastContact FROM prospects WHERE owner_id=? AND id IN ({q_marks});",
                    [uid] + prospect_ids,
                ).fetchall()
                old_prospect_map = {
                    int(r["id"]): {
                        "statut": r["statut"],
                        "rdvDate": r["rdvDate"],
                        "lastContact": r["lastContact"],
                    }
                    for r in rows0
                }
        except Exception:
            old_prospect_map = {}
        try:
            # Capturer les prospects qui seront supprimés pour le journal d'activité
            _deleted_prospects_for_log = []
            # Les suppressions par omission ne se font que si confirm_mass_delete=true (suppression explicite en masse).
            # Cela évite qu'un onglet en mode prospection efface les prospects ajoutés depuis un autre onglet.
            if force:
                try:
                    if prospect_ids:
                        _dm = ",".join("?" for _ in prospect_ids)
                        _del_rows = cur.execute(
                            f"SELECT id, name FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND id NOT IN ({_dm});",
                            [uid] + prospect_ids
                        ).fetchall()
                    else:
                        _del_rows = cur.execute("SELECT id, name FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchall()
                    _deleted_prospects_for_log = [(int(r["id"]), r["name"]) for r in _del_rows]
                except Exception:
                    _deleted_prospects_for_log = []

                # 1) Supprimer d'abord les prospects qui référencent des entreprises qu'on va supprimer (évite FK RESTRICT au commit)
                # v27.10: AND deleted_at IS NULL — ne pas toucher aux enregistrements soft-deleted (fenêtre d'annulation)
                if company_ids:
                    q_marks = ",".join("?" for _ in company_ids)
                    cur.execute(
                        f"DELETE FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND company_id IN (SELECT id FROM companies WHERE owner_id=? AND id NOT IN ({q_marks}));",
                        [uid, uid] + company_ids,
                    )
                else:
                    cur.execute("DELETE FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,))

                # 2) Supprimer les prospects de l'utilisateur courant qui ne sont plus dans le payload
                if prospect_ids:
                    q_marks = ",".join("?" for _ in prospect_ids)
                    cur.execute(
                        f"DELETE FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND id NOT IN ({q_marks});",
                        [uid] + prospect_ids,
                    )
                else:
                    cur.execute("DELETE FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,))

                # 3) Supprimer les entreprises de l'utilisateur courant absentes du payload
                if company_ids:
                    q_marks = ",".join("?" for _ in company_ids)
                    cur.execute(
                        f"DELETE FROM companies WHERE owner_id=? AND deleted_at IS NULL AND id NOT IN ({q_marks});",
                        [uid] + company_ids,
                    )
                else:
                    cur.execute("DELETE FROM companies WHERE owner_id=? AND deleted_at IS NULL;", (uid,))

            # Upsert companies (owner_id forcé à l'utilisateur connecté)
            cur.executemany(
                '''
                INSERT INTO companies (id, groupe, site, phone, notes, tags, website, linkedin, industry, size, address, city, country, stack, pain_points, budget, urgency, owner_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    groupe=excluded.groupe,
                    site=excluded.site,
                    phone=excluded.phone,
                    notes=excluded.notes,
                    tags=excluded.tags,
                    website=excluded.website,
                    linkedin=excluded.linkedin,
                    industry=excluded.industry,
                    size=excluded.size,
                    address=excluded.address,
                    city=excluded.city,
                    country=excluded.country,
                    stack=excluded.stack,
                    pain_points=excluded.pain_points,
                    budget=excluded.budget,
                    urgency=excluded.urgency,
                    owner_id=excluded.owner_id,
                    deleted_at=NULL
                ;
                ''',
                [
                    (
                        int(c["id"]),
                        str(c.get("groupe", "")),
                        str(c.get("site", "")),
                        c.get("phone"),
                        c.get("notes"),
                        c.get("tags"),
                        c.get("website"),
                        c.get("linkedin"),
                        c.get("industry"),
                        c.get("size"),
                        c.get("address"),
                        c.get("city"),
                        c.get("country"),
                        c.get("stack"),
                        c.get("pain_points"),
                        c.get("budget"),
                        c.get("urgency"),
                        int(c.get("owner_id", uid)),
                    )
                    for c in companies
                ],
            )

            # Quand un statut change via /api/save sans lastContact explicite, forcer le datetime courant.
            # Cela permet une reprise mobile plus robuste basée sur le "dernier contact".
            now_iso = _now_iso()
            for p in prospects:
                try:
                    pid = int(p.get("id"))
                except Exception:
                    continue
                old_row = old_prospect_map.get(pid) or {}
                old_statut = str(old_row.get("statut") or "").strip()
                old_last = str(old_row.get("lastContact") or "").strip()
                new_statut = str(p.get("statut") or "").strip()
                incoming_last = str(p.get("lastContact") or "").strip()

                if not incoming_last:
                    p["lastContact"] = now_iso
                    continue
                if old_statut and new_statut and old_statut != new_statut and incoming_last == old_last:
                    p["lastContact"] = now_iso

            # Upsert prospects (owner_id forcé à l'utilisateur connecté)
            cur.executemany(
                '''
                INSERT INTO prospects
                (id, name, company_id, fonction, telephone, email, linkedin, pertinence, statut, lastContact, nextFollowUp, priority, notes, callNotes, pushEmailSentAt, tags, template_id, nextAction, pushLinkedInSentAt, photo_url, push_category_id, fixedMetier, rdvDate, is_archived, owner_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,
                    company_id=excluded.company_id,
                    fonction=excluded.fonction,
                    telephone=excluded.telephone,
                    email=excluded.email,
                    linkedin=excluded.linkedin,
                    pertinence=excluded.pertinence,
                    statut=excluded.statut,
                    lastContact=excluded.lastContact,
                    nextFollowUp=excluded.nextFollowUp,
                    priority=excluded.priority,
                    notes=excluded.notes,
                    callNotes=excluded.callNotes,
                    pushEmailSentAt=excluded.pushEmailSentAt,
                    tags=excluded.tags,
                    template_id=excluded.template_id,
                    nextAction=excluded.nextAction,
                    pushLinkedInSentAt=excluded.pushLinkedInSentAt,
                    photo_url=excluded.photo_url,
                    push_category_id=excluded.push_category_id,
                    fixedMetier=excluded.fixedMetier,
                    rdvDate=excluded.rdvDate,
                    is_archived=excluded.is_archived,
                    owner_id=excluded.owner_id,
                    deleted_at=NULL
                ;
                ''',
                [
                    (
                        int(p["id"]),
                        str(p.get("name", "")),
                        _safe_int(p.get("company_id"), 0),
                        p.get("fonction"),
                        p.get("telephone"),
                        p.get("email"),
                        p.get("linkedin"),
                        p.get("pertinence"),
                        p.get("statut"),
                        p.get("lastContact"),
                        p.get("nextFollowUp"),
                        p.get("priority"),
                        p.get("notes"),
                        p.get("callNotes"),
                        p.get("pushEmailSentAt"),
                        p.get("tags"),
                        p.get("template_id"),
                        p.get("nextAction"),
                        p.get("pushLinkedInSentAt"),
                        p.get("photo_url"),
                        p.get("push_category_id"),
                        p.get("fixedMetier"),
                        p.get("rdvDate"),
                        p.get("is_archived", 0),
                        int(p.get("owner_id", uid)),
                    )
                    for p in prospects
                ],
            )

            # Log statut changes for debugging persistence issues
            for p in prospects:
                try:
                    pid = int(p.get("id"))
                    old_row = old_prospect_map.get(pid) or {}
                    old_s = str(old_row.get("statut") or "").strip()
                    new_s = str(p.get("statut") or "").strip()
                    if old_s != new_s:
                        logger.info("[upsert_all] prospect %d statut: %r → %r", pid, old_s, new_s)
                        row = cur.execute("SELECT statut FROM prospects WHERE id=?", (pid,)).fetchone()
                        if row:
                            saved_s = str(row[0] or "").strip()
                            if saved_s != new_s:
                                logger.warning("[upsert_all] statut DB mismatch pour prospect %d : attendu %r, trouvé %r", pid, new_s, saved_s)
                except Exception as _log_err:
                    logger.debug("[upsert_all] erreur log statut: %s", _log_err)

            # Log "RDV pris" events for gamified goals (deduped by unique index)
            try:
                now_ev = datetime.datetime.now().isoformat(timespec="seconds")
                ev_date = now_ev[:10]
                for p in prospects:
                    pid = int(p.get("id"))
                    new_statut = (p.get("statut") or "").strip()
                    new_rdv = (p.get("rdvDate") or "").strip()
                    old_row = old_prospect_map.get(pid) or {}
                    old_statut = old_row.get("statut")
                    old_rdv = old_row.get("rdvDate")
                    if new_statut == "Rendez-vous" and new_rdv:
                        if old_statut != "Rendez-vous" or (str(old_rdv or "").strip() != new_rdv):
                            cur.execute(
                                "INSERT OR IGNORE INTO prospect_events (prospect_id, date, type, title, content, meta, createdAt) VALUES (?,?,?,?,?,?,?)",
                                (pid, ev_date, "rdv_taken", "RDV pris", None, json.dumps({"rdvDate": new_rdv}, ensure_ascii=False), now_ev),
                            )
                            # Teams webhook: RDV pris (v22.1)
                            try:
                                _p_name = (p.get("name") or "").strip()
                                _c_row = cur.execute("SELECT groupe FROM companies WHERE id=? AND owner_id=?;", (p.get("company_id"), uid)).fetchone()
                                _c_name = _c_row[0] if _c_row else ""
                                _prefix = _get_user_prefix(uid)
                                _card = _build_adaptive_card(
                                    "RDV pris",
                                    [("Prospect", _p_name), ("Entreprise", _c_name), ("Date RDV", new_rdv), ("Consultant", _prefix)],
                                    [{"title": "Voir prospect", "url": f"https://prospup.work/entreprises?highlight={pid}"}]
                                )
                                _send_teams_webhook(_card, "rdv_taken")
                            except Exception:
                                pass
            except Exception:
                pass

            cur.execute("COMMIT;")

            # Journal d'activité — suppressions et créations de prospects
            try:
                for (_dp_id, _dp_name) in _deleted_prospects_for_log:
                    log_activity('delete', 'prospect', _dp_id, _dp_name)
                for _p in prospects:
                    _pid = int(_p.get("id"))
                    if _pid not in old_prospect_map:
                        log_activity('create', 'prospect', _pid, _p.get("name"))
            except Exception:
                pass

            # Hooks pour création automatique de tâches
            # Détecter les nouveaux prospects et changements de statut
            for p in prospects:
                try:
                    pid = int(p.get("id"))
                    old_row = old_prospect_map.get(pid) or {}
                    is_new = pid not in old_prospect_map
                    statut_changed = old_row.get("statut") != p.get("statut")
                    
                    # Construire le contexte pour les règles
                    context = {
                        "prospect_id": pid,
                        "name": p.get("name", ""),
                        "email": p.get("email"),
                        "telephone": p.get("telephone"),
                        "linkedin": p.get("linkedin"),
                        "statut": p.get("statut"),
                        "pertinence": p.get("pertinence"),
                        "nextFollowUp": p.get("nextFollowUp"),
                        "company_id": p.get("company_id"),
                    }
                    
                    # Récupérer le nom de l'entreprise si disponible
                    if context.get("company_id"):
                        try:
                            c_row = conn.execute(
                                "SELECT groupe FROM companies WHERE id=? AND owner_id=?;",
                                (context["company_id"], uid)
                            ).fetchone()
                            if c_row:
                                context["company_groupe"] = c_row["groupe"] or ""
                        except Exception:
                            pass
                    
                    # Hook: prospect créé
                    if is_new:
                        _create_auto_task("prospect_created", context)
                    
                    # Hook: statut changé
                    if statut_changed and p.get("statut"):
                        context["old_statut"] = old_row.get("statut")
                        _create_auto_task("status_changed", context)
                except Exception as e:
                    logger.warning("Erreur hook tâche auto pour prospect %s: %s", p.get("id"), e)
        except Exception:
            cur.execute("ROLLBACK;")
            raise
        finally:
            try:
                cur.execute("PRAGMA foreign_keys = ON;")
            except Exception:
                pass

def replace_all(data: Dict[str, Any]) -> None:
    companies = data.get("companies") or []
    prospects = data.get("prospects") or []

    if not isinstance(companies, list) or not isinstance(prospects, list):
        raise ValueError("Invalid payload: companies/prospects must be lists")

    def _dump_tags(v) -> str:
        if v is None:
            return "[]"
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return "[]"
            # allow comma separated string
            if s.startswith("["):
                return s
            parts = [t.strip() for t in s.split(",") if t.strip()]
            return json.dumps(parts, ensure_ascii=False)
        if isinstance(v, list):
            parts = [str(t).strip() for t in v if str(t).strip()]
            return json.dumps(parts, ensure_ascii=False)
        return "[]"

    for c in companies:
        c["tags"] = _dump_tags(c.get("tags"))

    for p in prospects:
        if isinstance(p.get("callNotes"), list):
            p["callNotes"] = json.dumps(p["callNotes"], ensure_ascii=False)
        else:
            p["callNotes"] = "[]"
        p["tags"] = _dump_tags(p.get("tags"))
        # template_id should be int or None
        tid = p.get("template_id")
        try:
            p["template_id"] = int(tid) if tid not in (None, "", "null") else None
        except Exception:
            p["template_id"] = None

    try:
        with _auth_conn() as aconn:
            first_user = aconn.execute("SELECT id FROM users WHERE is_active=1 ORDER BY id LIMIT 1;").fetchone()
            seed_owner_id = int(first_user["id"]) if first_user else None
    except Exception:
        seed_owner_id = None

    with _conn() as conn:
        # IMPORTANT: /api/save remplace complètement companies/prospects.
        # On préserve donc l'historique des push pour éviter de le perdre à chaque sauvegarde.
        try:
            existing_push_logs = [
                dict(r)
                for r in conn.execute(
                    "SELECT id, prospect_id, sentAt, channel, to_email, subject, body, template_id, template_name, createdAt FROM push_logs;"
                ).fetchall()
            ]
        except sqlite3.OperationalError as e:
            logger.warning("push_logs read failed (table may not exist yet): %s", e)
            existing_push_logs = []

        cur = conn.cursor()
        cur.execute("BEGIN;")
        try:
            cur.execute("DELETE FROM prospects;")
            cur.execute("DELETE FROM companies;")

            cur.executemany(
                "INSERT INTO companies (id, groupe, site, phone, notes, tags, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?);",
                [
                    (
                        int(c["id"]),
                        str(c.get("groupe", "")),
                        str(c.get("site", "")),
                        c.get("phone"),
                        c.get("notes"),
                        c.get("tags"),
                        seed_owner_id,
                    )
                    for c in companies
                ],
            )

            cur.executemany(
                '''
                INSERT INTO prospects
                (id, name, company_id, fonction, telephone, email, linkedin, pertinence, statut, lastContact, nextFollowUp, priority, notes, callNotes, pushEmailSentAt, tags, template_id, nextAction, pushLinkedInSentAt, photo_url, push_category_id, fixedMetier, rdvDate, is_archived, owner_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                ''',
                [
                    (
                        int(p["id"]),
                        str(p.get("name", "")),
                        _safe_int(p.get("company_id"), 0),
                        p.get("fonction"),
                        p.get("telephone"),
                        p.get("email"),
                        p.get("linkedin"),
                        p.get("pertinence"),
                        p.get("statut"),
                        p.get("lastContact"),
                        p.get("nextFollowUp"),
                        p.get("priority"),
                        p.get("notes"),
                        p.get("callNotes"),
                        p.get("pushEmailSentAt"),
                        p.get("tags"),
                        p.get("template_id"),
                        p.get("nextAction"),
                        p.get("pushLinkedInSentAt"),
                        p.get("photo_url"),
                        p.get("push_category_id"),
                        p.get("fixedMetier"),
                        p.get("rdvDate"),
                        p.get("is_archived", 0),
                        seed_owner_id,
                    )
                    for p in prospects
                ],
            )

            # Restaurer l'historique des push pour les prospects encore présents
            if existing_push_logs:
                kept_prospect_ids = {int(p.get("id")) for p in prospects if p.get("id") is not None}
                logs_to_restore = [
                    l for l in existing_push_logs
                    if (l.get("prospect_id") is not None and int(l["prospect_id"]) in kept_prospect_ids)
                ]

                if logs_to_restore:
                    cur.executemany(
                        '''
                        INSERT INTO push_logs (id, prospect_id, sentAt, channel, to_email, subject, body, template_id, template_name, createdAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                        ''',
                        [
                            (
                                int(l["id"]),
                                int(l["prospect_id"]),
                                str(l.get("sentAt") or ""),
                                l.get("channel"),
                                l.get("to_email"),
                                l.get("subject"),
                                l.get("body"),
                                l.get("template_id"),
                                l.get("template_name"),
                                str(l.get("createdAt") or l.get("sentAt") or ""),
                            )
                            for l in logs_to_restore
                        ],
                    )

            cur.execute("COMMIT;")
        except Exception:
            cur.execute("ROLLBACK;")
            raise





def load_initial_data_if_needed() -> None:
    if not db_is_empty():
        return
    if not INITIAL_JSON.exists():
        return
    replace_all(json.loads(INITIAL_JSON.read_text(encoding="utf-8")))
    # Neutraliser le fichier après le seed pour éviter un écrasement accidentel
    try:
        bak = INITIAL_JSON.with_suffix(".json.bak")
        INITIAL_JSON.rename(bak)
    except Exception:
        pass  # pas grave si le rename échoue (permissions, etc.)

def seed_from_initial() -> dict:
    """Force seed the DB from initial_data.json (used by /api/reset).
    Returns info about the seed source for the UI to display."""
    # Try initial_data.json first, then .bak as fallback
    source = None
    if INITIAL_JSON.exists():
        source = INITIAL_JSON
    else:
        bak = INITIAL_JSON.with_suffix(".json.bak")
        if bak.exists():
            source = bak

    if source is None:
        return {"seeded": False, "reason": "Aucun fichier initial_data.json trouvé"}

    payload = json.loads(source.read_text(encoding="utf-8"))
    replace_all(payload)

    mtime = datetime.datetime.fromtimestamp(source.stat().st_mtime)
    nb_c = len(payload.get("companies", []))
    nb_p = len(payload.get("prospects", []))
    return {
        "seeded": True,
        "source": source.name,
        "source_date": mtime.isoformat(timespec="seconds"),
        "companies": nb_c,
        "prospects": nb_p,
    }



def _now_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _audit_log(action: str, entity: str, entity_id: int | None = None,
               old_value: str | None = None, new_value: str | None = None):
    """v23.5: Write an entry to the audit trail."""
    uid = _uid()
    if not uid:
        return
    ip = request.remote_addr or "unknown"
    try:
        with _conn() as conn:
            conn.execute(
                "INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value, ip, createdAt) VALUES (?,?,?,?,?,?,?,?);",
                (uid, action, entity, entity_id, old_value, new_value, ip, _now_iso())
            )
    except Exception as e:
        logger.warning("audit_log failed: %s", e)  # Never break the main flow


def log_activity(action: str, entity_type: str = None, entity_id: int = None,
                 entity_label: str = None, details: dict = None):
    """v27.10: Enregistre une action dans activity_logs. Non-bloquant, toujours en DB principale."""
    try:
        uid = _uid()
        if not uid:
            return
        username = session.get('user_name', 'inconnu')
        ip = request.remote_addr or 'unknown'
        details_json = json.dumps(details, ensure_ascii=False) if details else None
        with _auth_conn() as conn:
            conn.execute(
                "INSERT INTO activity_logs (user_id, username, action, entity_type, entity_id, entity_label, details, ip_address) "
                "VALUES (?,?,?,?,?,?,?,?);",
                (uid, username, action, entity_type, entity_id, entity_label, details_json, ip)
            )
    except Exception as e:
        logger.warning("log_activity failed: %s", e)


def _today_iso() -> str:
    return datetime.date.today().isoformat()


def _create_auto_task(trigger_type: str, context: Dict[str, Any]) -> None:
    """Crée automatiquement des tâches basées sur les règles actives.
    
    Args:
        trigger_type: Type de déclencheur ('prospect_created', 'status_changed', 'meeting_done', 'daily_check')
        context: Contexte avec les données nécessaires (prospect_id, statut, etc.)
    """
    uid = _uid()
    if not uid:
        return
    
    try:
        with _conn() as conn:
            # Récupérer les règles actives pour ce trigger
            rules = conn.execute(
                "SELECT * FROM task_rules WHERE trigger_type=? AND enabled=1 AND (owner_id IS NULL OR owner_id=?);",
                (trigger_type, uid)
            ).fetchall()
            
            if not rules:
                return
            
            for rule in rules:
                rule_dict = dict(rule)
                conditions = json.loads(rule_dict.get("conditions") or "{}")
                
                # Évaluer les conditions
                if not _evaluate_task_conditions(conditions, context):
                    continue
                
                # Générer le titre et commentaire
                template_title = rule_dict.get("template_title") or ""
                template_comment = rule_dict.get("template_comment") or ""
                
                # Remplacer les variables du contexte dans les templates
                title = _render_task_template(template_title, context)
                comment = _render_task_template(template_comment, context)
                
                # Générer via IA si le template contient {{IA:...}}
                if "{{IA:" in title:
                    title = _generate_task_text_ia(title, context)
                if "{{IA:" in comment:
                    comment = _generate_task_text_ia(comment, context)
                
                # Déterminer la date d'échéance
                due_date = _calculate_task_due_date(context, conditions)
                
                # Construire linked_ids
                linked_ids = {}
                if context.get("prospect_id"):
                    linked_ids["prospect_id"] = context["prospect_id"]
                if context.get("company_id"):
                    linked_ids["company_id"] = context["company_id"]
                
                # Créer la tâche
                now = _now_iso()
                priority = rule_dict.get("priority") or 2
                conn.execute(
                    "INSERT INTO tasks (title, comment, due_date, status, linked_ids, priority, createdAt, updatedAt, owner_id) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?);",
                    (title, comment, due_date, json.dumps(linked_ids, ensure_ascii=False), priority, now, now, uid)
                )
                logger.info("Tâche auto-créée: %s (règle: %s)", title, rule_dict.get("name"))
    except Exception as e:
        logger.warning("Erreur création tâche auto: %s", e)


def _evaluate_task_conditions(conditions: Dict[str, Any], context: Dict[str, Any]) -> bool:
    """Évalue si les conditions sont remplies pour créer une tâche.
    
    Exemples de conditions:
    - {"has_email": False} : prospect sans email
    - {"statut": "Rendez-vous"} : statut spécifique
    - {"nextFollowUp_days": 2} : nextFollowUp dans N jours
    - {"has_linkedin": False} : pas de LinkedIn
    """
    if not conditions:
        return True
    
    # Condition: prospect sans email
    if conditions.get("has_email") is False:
        if context.get("email"):
            return False
    
    # Condition: statut spécifique
    if "statut" in conditions:
        if context.get("statut") != conditions["statut"]:
            return False
    
    # Condition: nextFollowUp dans N jours
    if "nextFollowUp_days" in conditions:
        next_follow = context.get("nextFollowUp")
        if not next_follow:
            return False
        try:
            follow_date = datetime.datetime.fromisoformat(next_follow.replace("Z", "+00:00")[:10])
            today = datetime.date.today()
            days_diff = (follow_date.date() - today).days
            if days_diff != conditions["nextFollowUp_days"]:
                return False
        except Exception:
            return False
    
    # Condition: pas de LinkedIn
    if conditions.get("has_linkedin") is False:
        if context.get("linkedin"):
            return False
    
    # Condition: pertinence spécifique
    if "pertinence" in conditions:
        if context.get("pertinence") != conditions["pertinence"]:
            return False
    
    return True


def _render_task_template(template: str, context: Dict[str, Any]) -> str:
    """Remplace les variables {{var}} dans le template par les valeurs du contexte."""
    if not template:
        return ""
    
    result = template
    # Remplacer {{variable}} par la valeur du contexte
    for key, value in context.items():
        placeholder = f"{{{{{key}}}}}"
        if placeholder in result:
            result = result.replace(placeholder, str(value or ""))
    
    return result


def _generate_task_text_ia(template: str, context: Dict[str, Any]) -> str:
    """Génère un texte via IA si le template contient {{IA:prompt}}.
    
    Exemple: "{{IA:Génère un titre de tâche pour : relancer {{name}} de {{company_groupe}} concernant {{context}}. Titre court (max 50 caractères).}}"
    """
    if "{{IA:" not in template:
        return template
    
    # Extraire le prompt IA
    import re
    match = re.search(r'\{\{IA:([^}]+)\}\}', template)
    if not match:
        return template
    
    prompt_template = match.group(1)
    
    # Remplacer les variables du contexte dans le prompt
    prompt = _render_task_template(prompt_template, context)
    
    try:
        # Appeler l'IA
        generated = _call_ai(prompt, timeout=30)
        # Remplacer {{IA:...}} par le texte généré
        result = template.replace(match.group(0), generated.strip())
        return result
    except Exception as e:
        logger.warning("Erreur génération IA pour tâche: %s", e)
        # Fallback: retourner le template sans {{IA:...}}
        return template.replace(match.group(0), "")


def _calculate_task_due_date(context: Dict[str, Any], conditions: Dict[str, Any]) -> str | None:
    """Calcule la date d'échéance de la tâche basée sur le contexte et les conditions."""
    # Si nextFollowUp est défini, utiliser cette date
    if context.get("nextFollowUp"):
        return context["nextFollowUp"]
    
    # Si une condition spécifie un délai
    if "due_days" in conditions:
        days = int(conditions.get("due_days", 0))
        due_date = datetime.date.today() + datetime.timedelta(days=days)
        return due_date.isoformat()
    
    # Par défaut: aujourd'hui
    return _today_iso()


def _optimize_task_schedule(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Suggère l'ordre optimal des tâches basé sur :
    - Priorité
    - Date d'échéance
    - Type de tâche (regroupement)
    - Estimation de temps
    
    Retourne les tâches triées avec des suggestions d'ordre.
    """
    if not tasks:
        return []
    
    # Estimation de temps par type de tâche (en minutes)
    task_time_estimates = {
        "relance": 15,
        "appel": 20,
        "email": 10,
        "rdv": 30,
        "suivi": 15,
        "default": 20,
    }
    
    # Calculer un score pour chaque tâche
    scored_tasks = []
    for task in tasks:
        score = 0
        priority = task.get("priority") or 2
        due_date = task.get("due_date")
        title = (task.get("title") or "").lower()
        
        # Score basé sur la priorité (plus bas = plus urgent)
        score += (4 - priority) * 100
        
        # Score basé sur la date d'échéance
        if due_date:
            try:
                due = datetime.datetime.fromisoformat(due_date.replace("Z", "+00:00")[:10]).date()
                today = datetime.date.today()
                days_until = (due - today).days
                if days_until < 0:
                    score += 200  # En retard
                elif days_until == 0:
                    score += 150  # Aujourd'hui
                elif days_until == 1:
                    score += 100  # Demain
                elif days_until <= 3:
                    score += 50  # Cette semaine
            except Exception:
                pass
        
        # Estimation de temps
        time_estimate = task_time_estimates.get("default")
        for task_type, minutes in task_time_estimates.items():
            if task_type in title:
                time_estimate = minutes
                break
        task["estimated_minutes"] = time_estimate
        
        # Score négatif pour les tâches longues (prioriser les courtes)
        score -= time_estimate / 10
        
        scored_tasks.append((score, task))
    
    # Trier par score décroissant
    scored_tasks.sort(key=lambda x: x[0], reverse=True)
    
    # Regrouper les tâches similaires (même type, même entreprise)
    grouped = []
    current_group = []
    for score, task in scored_tasks:
        if not current_group:
            current_group.append(task)
        else:
            # Vérifier si on peut regrouper
            prev_task = current_group[0]
            prev_title = (prev_task.get("title") or "").lower()
            curr_title = (task.get("title") or "").lower()
            
            # Regrouper si même type de tâche
            can_group = False
            for task_type in task_time_estimates.keys():
                if task_type in prev_title and task_type in curr_title:
                    can_group = True
                    break
            
            # Regrouper si même entreprise (via linked_ids)
            try:
                prev_linked = json.loads(prev_task.get("linked_ids") or "{}")
                curr_linked = json.loads(task.get("linked_ids") or "{}")
                if prev_linked.get("company_id") and curr_linked.get("company_id"):
                    if prev_linked.get("company_id") == curr_linked.get("company_id"):
                        can_group = True
            except Exception:
                pass
            
            if can_group and len(current_group) < 3:  # Max 3 tâches par groupe
                current_group.append(task)
            else:
                grouped.append(current_group)
                current_group = [task]
    
    if current_group:
        grouped.append(current_group)
    
    # Aplatir et retourner
    result = []
    for group in grouped:
        result.extend(group)
    
    return result


def _snapshot_dir_for_user(user_id: int | None = None) -> Path:
    """Répertoire de snapshots pour un utilisateur (per-user ou global)."""
    if user_id:
        user_db = DATA_DIR / f"user_{user_id}" / "prospects.db"
        if user_db.exists():
            snap = user_db.parent / "snapshots"
            snap.mkdir(parents=True, exist_ok=True)
            return snap
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    return SNAPSHOT_DIR


def _current_user_db_path() -> Path:
    """DB path de l'utilisateur courant (pour snapshots)."""
    try:
        uid = session.get("user_id")
        if uid:
            return _user_db_path(uid)
    except RuntimeError:
        pass
    return DB_PATH


def _auto_snapshot_if_needed() -> None:
    """Crée au plus 1 snapshot auto par jour. Garde les 14 derniers. Per-user aware."""
    try:
        uid = None
        try:
            uid = session.get("user_id")
        except RuntimeError:
            pass
        snap_dir = _snapshot_dir_for_user(uid)
        src_db = _current_user_db_path()

        today = _today_iso()
        existing = sorted(snap_dir.glob(f"auto_{today}_*.db"))
        if existing:
            return

        ts = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
        filename = f"auto_{today}_{ts}.db"
        path = snap_dir / filename

        src = sqlite3.connect(src_db)
        try:
            dst = sqlite3.connect(path)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()

        autos = sorted(snap_dir.glob("auto_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in autos[14:]:
            try:
                p.unlink()
            except Exception:
                pass
    except Exception:
        return


def create_snapshot(label: str = "manual", is_auto: bool = False, source_db: Path | None = None) -> str:
    """Snapshot de la DB. source_db permet de cibler une DB spécifique (sinon DB admin)."""
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    safe = "".join(ch for ch in label if ch.isalnum() or ch in ("-", "_"))[:40] or "snapshot"
    filename = f"{safe}_{ts}.db"
    path = SNAPSHOT_DIR / filename

    db_to_snapshot = source_db or DB_PATH
    src = sqlite3.connect(db_to_snapshot)
    try:
        dst = sqlite3.connect(path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()

    return filename


def list_snapshots() -> List[Dict[str, Any]]:
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    out = []
    for p in sorted(SNAPSHOT_DIR.glob("*.db"), key=lambda x: x.stat().st_mtime, reverse=True):
        st = p.stat()
        out.append(
            {
                "filename": p.name,
                "size": st.st_size,
                "mtime": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                "modifiedAt": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
            }
        )
    return out


def _is_safe_snapshot_name(filename: str) -> bool:
    if not filename:
        return False
    fn = str(filename).strip()
    if any(x in fn for x in ("/", "\\", "..")):
        return False
    if not fn.endswith(".db"):
        return False
    return True


def _snapshot_path(filename: str) -> Path:
    # returns the normalized path inside SNAPSHOT_DIR (or raises ValueError)
    if not _is_safe_snapshot_name(filename):
        raise ValueError("invalid snapshot filename")
    p = (SNAPSHOT_DIR / filename).resolve()
    base = SNAPSHOT_DIR.resolve()
    if base not in p.parents and p != base:
        raise ValueError("invalid snapshot path")
    return p


def restore_snapshot(filename: str) -> None:
    snap = _snapshot_path(filename)
    if not snap.exists():
        raise FileNotFoundError(filename)

    # Safety snapshot before restore
    try:
        create_snapshot(label="before_restore", is_auto=False)
    except Exception:
        pass

    src = sqlite3.connect(snap)
    try:
        dst = sqlite3.connect(DB_PATH)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


# ─────────────────────────────────────────────────────────────────
# Redirects legacy → v30 (v31.7+) : v29 archivée dans archives/v29/.
# Les routes ci-dessous restent pour préserver bookmarks, partages
# externes et PWA shortcuts. Toute URL sans équivalent v30 → 404.
# ─────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return redirect("/v30/dashboard", code=302)


@app.get("/entreprises")
def page_entreprises():
    return redirect("/v30/entreprises", code=302)

@app.get("/company")
def page_company():
    return redirect("/v30/entreprises", code=302)


@app.get("/parametres")
def page_parametres():
    return redirect("/v30/parametres", code=302)


@app.get("/sourcing")
def page_sourcing():
    return redirect("/v30/sourcing", code=302)


@app.get("/candidat")
def page_candidat():
    """Fiche candidat (détail). Migre ?id=X → /v30/candidat/<X>."""
    cid = (request.args.get("id") or "").strip()
    if cid.isdigit():
        return redirect(f"/v30/candidat/{cid}", code=302)
    return redirect("/v30/sourcing", code=302)


@app.get("/push")
def page_push():
    return redirect("/v30/push", code=302)

@app.get("/stats")
def page_stats():
    return redirect("/v30/stats", code=302)


@app.get("/duplicates")
def page_duplicates():
    return redirect("/v30/duplicates", code=302)


@app.get("/focus")
def page_focus():
    return redirect("/v30/focus", code=302)


@app.get("/snapshots")
def page_snapshots():
    return redirect("/v30/snapshots", code=302)


@app.get("/activity")
@login_required
@role_required('admin')
def page_activity():
    return redirect("/v30/activity", code=302)


@app.get("/help")
def page_help():
    return redirect("/v30/help", code=302)


@app.get("/aide")
def page_aide():
    return redirect("/v30/help", code=302)


@app.get("/metiers")
def page_metiers():
    return redirect("/v30/metiers", code=302)


@app.get("/prospects/mode-prosp")
def page_mode_prosp():
    return redirect("/v30/mode-prosp", code=302)


@app.get("/v30/mode-prosp")
def page_v30_mode_prosp():
    """v30 : Mode Prosp (deck 3D), layout plein écran sans sidebar.

    Réutilise les APIs /api/mode-prosp/* (start/data/save) et le CSS legacy
    `/static/css/mode-prosp.css` (autonome, pas de dépendance à base.html)."""
    return render_template("v30/mode_prosp.html", static_hashes=_static_hashes)


@app.get("/v30/preview")
def page_v30_preview():
    """Preview du chrome v30 (topbar + sidebar) + aperçu du design system.
    Voir CHECKLIST.md et update UX web app/handoff/HANDOFF.md."""
    return render_template(
        "v30/preview.html",
        active="dashboard",
        crumbs=["Prosp'Up", "Aperçu v30"],
        counts={"prospects": 1247, "entreprises": 342, "candidats": 89, "focus": 12},
        pinned=[
            {"id": "cap", "label": "Capgemini",    "sub": "12 prospects"},
            {"id": "sfr", "label": "SFR Business", "sub": "4 prospects"},
        ],
        user_initials="AB",
        app_version=APP_VERSION,
    )


@app.get("/v30/login")
def page_v30_login():
    """Preview du login v30 (split 60/40, citation + stats éditoriales).
    Formulaire fonctionnel : POST vers /api/auth/login comme /login."""
    if session.get('user_id'):
        return redirect('/v30/preview')
    return render_template("v30/login.html", app_version=APP_VERSION)


def _sidebar_counts(uid=None):
    """Retourne le dict counts {prospects, entreprises, candidats} pour la sidebar v30.
    BUG 11/27 : on exclut les prospects supprimés ET archivés (cohérent avec /v30/prospects client-side)."""
    if not uid:
        uid = _uid()
    if not uid:
        return {}
    try:
        with _conn() as conn:
            return {
                "prospects":  conn.execute(
                    "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='') "
                    "AND (is_archived IS NULL OR is_archived=0);", (uid,)
                ).fetchone()[0],
                "entreprises": conn.execute(
                    "SELECT COUNT(*) FROM companies WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='');", (uid,)
                ).fetchone()[0],
                "candidats":  conn.execute(
                    "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
                ).fetchone()[0],
            }
    except Exception:
        return {}


@app.get("/v30/calendrier")
def page_v30_calendar():
    """Calendrier v30 — grille mois avec RDV / relances / EC1 candidats.
    Hydraté côté client via /api/calendar_events."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    return render_template(
        "v30/calendar.html",
        active="calendar",
        crumbs=["Prosp'Up", "Calendrier"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/focus")
def page_v30_focus():
    """Focus v30 — vue concentration 3 colonnes (overdue / today / upcoming)
    hydratée via /api/dashboard."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
    except Exception:
        pass
    return render_template(
        "v30/focus.html",
        active="focus",
        crumbs=["Prosp'Up", "Focus"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/candidat/<int:cid>")
def page_v30_candidate_detail(cid):
    """Fiche candidat v30 (SPEC §3.8). Rendu serveur minimal ; les
    données (profil + expériences) sont chargées côté client via
    /api/candidates/<id> et /api/candidates/<id>/experiences."""
    uid = _uid()
    if not uid:
        return redirect('/login')
    try:
        with _conn() as conn:
            row = conn.execute(
                "SELECT id, name FROM candidates WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
                (cid, uid),
            ).fetchone()
    except Exception:
        row = None
    if not row:
        return redirect('/v30/sourcing')

    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"

    counts = {}
    try:
        with _conn() as conn:
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}

    return render_template(
        "v30/candidate_detail.html",
        active="candidats",
        crumbs=[
            {"label": "Prosp'Up", "href": "/v30/dashboard"},
            {"label": "Candidats", "href": "/v30/sourcing"},
            row["name"] or "Fiche",
        ],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        candidate_id=cid,
        candidate_name=row["name"] or "",
        app_version=APP_VERSION,
    )


@app.get("/v30/stats")
def page_v30_stats():
    """Stats & Rapport v30 (SPEC §3.9). Topbar + 4 KPI + Top entreprises
    hydratés. Les 8 charts Chart.js et l'éditeur rapport WYSIWYG restent
    sur les routes legacy /stats et /rapport (liens dans les panels)."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}
    return render_template(
        "v30/stats.html",
        active="stats",
        crumbs=["Prosp'Up", "Stats & Rapport"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/collab")
@login_required
def page_v30_collab():
    """Collaboration v30 — hub cartes vers /collab."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/collab.html",
        active="collab",
        crumbs=["Prosp'Up", "Collaboration"],
        counts=_sidebar_counts(), pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/duplicates")
@login_required
def page_v30_duplicates():
    """Doublons v30 — hub cartes vers /duplicates."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/duplicates.html",
        active="duplicates",
        crumbs=["Prosp'Up", "Doublons"],
        counts=_sidebar_counts(), pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/dc")
@app.get("/v30/dc/<int:cid>")
@login_required
def page_v30_dc(cid: int | None = None):
    """Générateur DC v30 — hub cartes + lien vers /dc_generator."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/dc.html",
        active="dc",
        crumbs=["Prosp'Up", "Dossier de compétence"],
        counts=_sidebar_counts(), pinned=[],
        user_initials=user_initials,
        cid=cid,
        app_version=APP_VERSION,
    )


@app.get("/v30/metiers")
@login_required
def page_v30_metiers():
    """Métiers v30 — référentiel ouvert à tous, CRUD custom_metiers réservé admin."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/metiers.html",
        active="metiers",
        crumbs=["Prosp'Up", "Métiers"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        current_user=u,
        app_version=APP_VERSION,
    )


@app.get("/v30/help")
def page_v30_help():
    """Aide v30 — cartes vers sections + raccourci pour ouvrir la modal raccourcis."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/help.html",
        active="help",
        crumbs=["Prosp'Up", "Aide"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/snapshots")
@login_required
@role_required('admin')
def page_v30_snapshots():
    """Snapshots DB v30 — admin only, miroir /snapshots."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/snapshots.html",
        active="snapshots",
        crumbs=["Prosp'Up", "Snapshots"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/activity")
@login_required
@role_required('admin')
def page_v30_activity():
    """Journal d'activité v30 — admin only, miroir /activity."""
    uid = _uid()
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/activity.html",
        active="activity",
        crumbs=["Prosp'Up", "Activité"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/parametres")
@login_required
def page_v30_parametres():
    """Paramètres v30 — hub cards + liens vers /parametres#section legacy."""
    uid = _uid()
    current_user = _get_current_user() or {}
    user_initials = "AB"
    if uid:
        dn = (current_user.get("display_name") or current_user.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    return render_template(
        "v30/parametres.html",
        active="parametres",
        crumbs=["Prosp'Up", "Paramètres"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        current_user=current_user,
        app_version=APP_VERSION,
        app_dir=str(APP_DIR),
    )


@app.get("/v30/users")
@login_required
@role_required('admin')
def page_v30_users():
    """Gestion utilisateurs v30 — admin only, miroir /users."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    return render_template(
        "v30/users.html",
        active="users",
        crumbs=["Prosp'Up", "Utilisateurs"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/rapport")
def page_v30_rapport():
    """Rapport hebdomadaire v30 — miroir de /rapport avec chrome v30."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    return render_template(
        "v30/rapport.html",
        active="rapport",
        crumbs=["Prosp'Up", "Rapport"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/sourcing")
def page_v30_sourcing():
    """Sourcing v30 (SPEC §3.7). Kanban 5 colonnes par status +
    vue Grille. Hydraté côté client via /api/candidates. Voir
    static/js/v30/sourcing.js."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}
    return render_template(
        "v30/sourcing.html",
        active="candidats",
        crumbs=["Prosp'Up", "Candidats"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/push")
def page_v30_push():
    """Push v30 (SPEC §3.6). Rendu serveur du chrome ; 3 onglets
    (Campagnes / Templates / Historique) hydratés côté client :
    - Campagnes : placeholder — la table push_campaigns (SPEC §5.2)
      n'existe pas encore ; migration à prévoir en accord avec l'utilisateur.
    - Templates : /api/templates
    - Historique : /api/data → push_logs groupés par jour
    Voir static/js/v30/push.js."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}
    return render_template(
        "v30/push.html",
        active="push",
        crumbs=["Prosp'Up", "Push"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/entreprises")
def page_v30_entreprises():
    """Entreprises v30 (SPEC §3.5). Rendu serveur du chrome ; données
    chargées côté client via /api/data (liste companies + prospects),
    agrégation par company_id (total prospects, RDV/propale, gagnés,
    dernier contact) dans static/js/v30/entreprises.js."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}
    return render_template(
        "v30/entreprises.html",
        active="entreprises",
        crumbs=["Prosp'Up", "Entreprises"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/prospect/<int:pid>")
def page_v30_prospect_detail(pid):
    """Fiche prospect v30 (SPEC §3.4). Rendu serveur du chrome ;
    les données (prospect + timeline + push logs) sont chargées côté
    client via /api/prospect/timeline. Inline-edit via
    /api/prospects/bulk-edit avec ids=[pid]."""
    uid = _uid()
    if not uid:
        return redirect('/login')
    # Vérifie ownership léger (le endpoint timeline filtre déjà)
    try:
        with _conn() as conn:
            row = conn.execute(
                "SELECT id, name FROM prospects WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
                (pid, uid),
            ).fetchone()
    except Exception:
        row = None
    if not row:
        # Pas d'accès → retour liste
        return redirect('/v30/prospects')

    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"

    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);",
                (uid,),
            ).fetchone()[0]
    except Exception:
        counts = {}

    return render_template(
        "v30/prospect_detail.html",
        active="prospects",
        crumbs=[
            {"label": "Prosp'Up", "href": "/v30/dashboard"},
            {"label": "Prospects", "href": "/v30/prospects"},
            row["name"] or "Fiche",
        ],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        prospect_id=pid,
        prospect_name=row["name"] or "",
        app_version=APP_VERSION,
    )


@app.get("/v30/prospects")
def page_v30_prospects():
    """Prospects v30 (SPEC §3.3). Rendu serveur du chrome uniquement ;
    le tableau est hydraté côté client via /api/search (liste + fuzzy)
    et les bulks via /api/prospects/bulk-*. Voir
    static/js/v30/prospects.js."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()

    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);",
                (uid,),
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');",
                (uid,),
            ).fetchone()[0]
    except Exception:
        counts = {}

    return render_template(
        "v30/prospects.html",
        active="prospects",
        crumbs=["Prosp'Up", "Prospects"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/prospects/archives")
def page_v30_prospects_archives():
    """BUG 29 : page des prospects archivés. Liste lecture seule avec action
    Désarchiver. Utilise /api/data pour récupérer les archivés côté client."""
    uid = _uid()
    if not uid:
        return redirect('/login')
    user_initials = "AB"
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    if dn:
        parts = [p for p in dn.split() if p]
        user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()

    counts = _sidebar_counts()
    archived_count = 0
    try:
        with _conn() as conn:
            archived_count = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') AND is_archived=1;",
                (uid,),
            ).fetchone()[0]
    except Exception:
        pass

    return render_template(
        "v30/prospects_archives.html",
        active="prospects",
        crumbs=["Prosp'Up", "Prospects", "Archives"],
        counts=counts,
        archived_count=archived_count,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@app.get("/v30/dashboard")
def page_v30_dashboard():
    """Dashboard v3 (SPEC §3.2). Rendu serveur du chrome + hero ;
    les bloks dynamiques (KPIs, action center, pipeline, objectifs,
    priorités IA, activité) sont peuplés côté client par les
    endpoints existants /api/dashboard, /api/dashboard/pipeline-stages,
    /api/tasks."""
    uid = _uid()
    display_name = ""
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        display_name = dn
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()

    # Compteurs sidebar — lightweight; pas fatal si indispo
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);",
                (uid,),
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;",
                (uid,),
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');",
                (uid,),
            ).fetchone()[0]
    except Exception:
        counts = {}

    return render_template(
        "v30/dashboard.html",
        active="dashboard",
        crumbs=["Prosp'Up", "Dashboard"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        display_name=display_name,
        app_version=APP_VERSION,
    )


# ── Mode Prosp: server-side token sessions ──
_MODE_PROSP_TTL = 3600 * 8  # 8 heures (survit aux redémarrages grâce à la DB)


def _mode_prosp_cleanup():
    """Supprime les sessions Mode Prosp expirées de la DB."""
    try:
        with _conn() as conn:
            conn.execute(
                "DELETE FROM mode_prosp_sessions WHERE ? - created_at > ?;",
                (time.time(), _MODE_PROSP_TTL)
            )
    except Exception as e:
        logger.warning("mode_prosp_cleanup: %s", e)


def _mode_prosp_auth(token: str):
    """Valide un token Mode Prosp depuis la DB et retourne le dict de session ou None."""
    if not token:
        return None
    try:
        with _conn() as conn:
            row = conn.execute(
                "SELECT user_id, ids, created_at FROM mode_prosp_sessions WHERE token=?;",
                (token,)
            ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    row = dict(row)
    if time.time() - row['created_at'] > _MODE_PROSP_TTL:
        try:
            with _conn() as conn:
                conn.execute("DELETE FROM mode_prosp_sessions WHERE token=?;", (token,))
        except Exception:
            pass
        return None
    try:
        ids = json.loads(row['ids'])
    except Exception:
        ids = []
    return {
        'user_id': row['user_id'],
        'ids': ids,
        'created_at': row['created_at']
    }


@app.post("/api/mode-prosp/start")
def mode_prosp_start():
    """Create a mode-prosp session: store filtered prospect IDs in DB, return a token."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    ids = request.json.get('ids', [])
    if not isinstance(ids, list) or len(ids) == 0:
        return jsonify(ok=False, error="Aucun prospect"), 400
    # Validate IDs are integers
    ids = [int(i) for i in ids if str(i).isdigit()]
    if not ids:
        return jsonify(ok=False, error="IDs invalides"), 400
    token = secrets.token_urlsafe(16)
    try:
        with _conn() as conn:
            conn.execute(
                "INSERT INTO mode_prosp_sessions (token, user_id, ids, created_at) VALUES (?, ?, ?, ?);",
                (token, uid, json.dumps(ids), time.time())
            )
    except Exception as e:
        logger.error("mode_prosp_start: %s", e)
        return jsonify(ok=False, error="Erreur serveur"), 500
    _mode_prosp_cleanup()
    return jsonify(ok=True, token=token)


@app.get("/api/prospects/quick-filter")
def api_prospects_quick_filter():
    """Retourne des IDs de prospects selon un preset de filtres (usage: dashboard objectifs)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    preset = request.args.get('preset', '')
    try:
        with _conn() as conn:
            if preset == 'push_ready':
                rows = conn.execute(
                    "SELECT id FROM prospects WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') "
                    "AND (is_archived IS NULL OR is_archived=0) "
                    "AND (pushEmailSentAt IS NULL OR pushEmailSentAt='') "
                    "AND (pushLinkedInSentAt IS NULL OR pushLinkedInSentAt='') "
                    "AND email IS NOT NULL AND email!='' "
                    "AND (telephone IS NULL OR telephone='') "
                    "ORDER BY RANDOM() LIMIT 1",
                    (uid,)
                ).fetchall()
            elif preset == 'rdv_ready':
                rows = conn.execute(
                    "SELECT id FROM prospects WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') "
                    "AND (is_archived IS NULL OR is_archived=0) "
                    "AND statut IN ('Messagerie','Pas d''actions','À rappeler') "
                    "AND telephone IS NOT NULL AND telephone!=''",
                    (uid,)
                ).fetchall()
            else:
                return jsonify(ok=False, error="preset inconnu"), 400
        return jsonify(ok=True, ids=[r['id'] for r in rows])
    except Exception as e:
        logger.error("api_prospects_quick_filter: %s", e)
        return jsonify(ok=False, error="Erreur serveur"), 500


@app.get("/api/mode-prosp/data")
def mode_prosp_data():
    """Return only the selected prospects + their companies for a mode-prosp session."""
    token = request.args.get('t', '')
    sess = _mode_prosp_auth(token)
    if not sess:
        return jsonify(ok=False, error="Session expirée ou invalide"), 401
    uid = sess['user_id']
    ids = sess['ids']
    try:
        db_path = _user_db_path(uid)
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 20000;")
        # Fetch prospects by IDs, respecting owner_id
        placeholders = ','.join('?' * len(ids))
        rows = conn.execute(
            f"SELECT * FROM prospects WHERE id IN ({placeholders}) AND owner_id=? AND deleted_at IS NULL",
            ids + [uid]
        ).fetchall()
        p_map = {r['id']: dict(r) for r in rows}
        # Maintain the original filter order
        prospects_list = [p_map[i] for i in ids if i in p_map]
        # Parse JSON fields
        for p in prospects_list:
            for jf in ('callNotes', 'tags'):
                raw = p.get(jf)
                if isinstance(raw, str) and raw:
                    try:
                        p[jf] = json.loads(raw)
                    except Exception:
                        p[jf] = []
                elif not raw:
                    p[jf] = []
        # Fetch related companies
        company_ids = list(set(p.get('company_id') for p in prospects_list if p.get('company_id')))
        companies_list = []
        if company_ids:
            cp = ','.join('?' * len(company_ids))
            c_rows = conn.execute(
                f"SELECT * FROM companies WHERE id IN ({cp}) AND owner_id=? AND deleted_at IS NULL",
                company_ids + [uid]
            ).fetchall()
            companies_list = [dict(r) for r in c_rows]
        conn.close()
        return jsonify(ok=True, prospects=prospects_list, companies=companies_list)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@app.post("/api/mode-prosp/save")
def mode_prosp_save():
    """Save a single prospect from mode-prosp. Updates only the editable fields."""
    token = request.args.get('t', '')
    sess = _mode_prosp_auth(token)
    if not sess:
        return jsonify(ok=False, error="Session expirée ou invalide"), 401
    uid = sess['user_id']
    prospect = request.json.get('prospect')
    if not prospect or not prospect.get('id'):
        return jsonify(ok=False, error="Prospect invalide"), 400
    pid = int(prospect['id'])
    # Verify ownership
    if pid not in sess['ids']:
        return jsonify(ok=False, error="Prospect non autorisé"), 403
    # Editable fields from Mode Prosp cards
    EDITABLE = ('statut', 'company_id', 'fonction', 'telephone', 'email', 'linkedin',
                'pertinence', 'priority', 'nextAction', 'nextFollowUp', 'rdvDate', 'lastContact', 'notes')
    try:
        db_path = _user_db_path(uid)
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 20000;")
        conn.execute("PRAGMA journal_mode = WAL;")
        # Fetch current prospect state before update (for event diffing)
        old_row = conn.execute("SELECT statut, rdvDate FROM prospects WHERE id = ? AND owner_id = ?", (pid, uid)).fetchone()
        old_statut = str(old_row["statut"] or "").strip() if old_row else ""
        old_rdv = str(old_row["rdvDate"] or "").strip() if old_row else ""
        # Build SET clause for only editable fields present in payload
        sets = []
        vals = []
        for f in EDITABLE:
            if f in prospect:
                sets.append(f"{f} = ?")
                val = prospect[f]
                # Convert company_id and priority to int
                if f in ('company_id', 'priority', 'pertinence'):
                    val = int(val) if val is not None else None
                vals.append(val)
        if not sets:
            conn.close()
            return jsonify(ok=True)
        vals.extend([pid, uid])
        conn.execute(
            f"UPDATE prospects SET {', '.join(sets)} WHERE id = ? AND owner_id = ?",
            vals
        )
        # Log "RDV pris" event for gamified goals (same logic as upsert_all)
        try:
            new_statut = str(prospect.get("statut") or "").strip()
            new_rdv = str(prospect.get("rdvDate") or "").strip()
            if new_statut == "Rendez-vous" and new_rdv:
                if old_statut != "Rendez-vous" or old_rdv != new_rdv:
                    now_ev = datetime.datetime.now().isoformat(timespec="seconds")
                    ev_date = now_ev[:10]
                    conn.execute(
                        "INSERT OR IGNORE INTO prospect_events (prospect_id, date, type, title, content, meta, createdAt) VALUES (?,?,?,?,?,?,?)",
                        (pid, ev_date, "rdv_taken", "RDV pris", None, json.dumps({"rdvDate": new_rdv}, ensure_ascii=False), now_ev),
                    )
        except Exception:
            pass
        # Log status change event for timeline (notes & suivi)
        try:
            if "statut" in prospect:
                new_statut = str(prospect.get("statut") or "").strip()
                if new_statut and old_statut != new_statut:
                    ev_at = datetime.datetime.now().isoformat()
                    content_statut = f"{old_statut} → {new_statut}" if old_statut else new_statut
                    conn.execute(
                        "INSERT OR IGNORE INTO prospect_events (prospect_id, date, type, title, content, meta, createdAt) VALUES (?,?,?,?,?,?,?)",
                        (pid, ev_at, "status_change", "Changement de statut", content_statut, None, ev_at),
                    )
        except Exception:
            pass
        conn.commit()
        # Fetch updated prospect to return it
        row = conn.execute("SELECT * FROM prospects WHERE id = ? AND owner_id = ?", (pid, uid)).fetchone()
        conn.close()
        if row:
            updated = dict(row)
            for jf in ('callNotes', 'tags'):
                raw = updated.get(jf)
                if isinstance(raw, str) and raw:
                    try:
                        updated[jf] = json.loads(raw)
                    except Exception:
                        updated[jf] = []
                elif not raw:
                    updated[jf] = []
            return jsonify(ok=True, prospect=updated)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@app.get("/offline.html")
def page_offline():
    return send_from_directory(APP_DIR, "offline.html")


@app.post("/api/kpi/export/xlsx")
def api_kpi_export_xlsx():
    """Generate a simple KPI validation Excel from a checklist."""
    payload = request.get_json(force=True, silent=True) or {}
    date_iso = str(payload.get("date") or "").strip() or datetime.date.today().isoformat()
    title = str(payload.get("title") or "Validation KPI").strip() or "Validation KPI"
    items = payload.get("items")
    if not isinstance(items, list):
        items = []

    # sanitize items
    cleaned: List[Dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        label = str(it.get("label") or "").strip()
        if not label:
            continue
        checked = bool(it.get("checked"))
        note = str(it.get("note") or "").strip().replace("\r\n", "\n").replace("\r", "\n")
        cleaned.append({"label": label[:200], "checked": checked, "note": note[:500]})

    from openpyxl import Workbook
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "KPI"

    ws.append(["Date", "KPI", "Coche", "Commentaire"])
    for row in cleaned:
        ws.append([date_iso, row["label"], "Oui" if row["checked"] else "Non", row["note"]])

    # basic sizing
    widths = [12, 45, 10, 60]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # Summary sheet
    ws2 = wb.create_sheet("Résumé")
    ws2.append(["Titre", title])
    ws2.append(["Date", date_iso])
    ws2.append([])
    total = len(cleaned)
    done = sum(1 for r in cleaned if r["checked"])
    ws2.append(["Total KPI", total])
    ws2.append(["Cochés", done])
    ws2.append(["Non cochés", total - done])
    ws2.column_dimensions["A"].width = 18
    ws2.column_dimensions["B"].width = 40

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    fname = f"kpi_{date_iso}.xlsx".replace(":", "-")
    return send_file(
        bio,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=fname,
    )



# ====== Utils: keywords from prospect notes / fixedMetier (best-candidates) ======
NOTES_STOPWORDS = {
    "les", "des", "une", "que", "dans", "pour", "sur", "avec", "sans", "mais", "ou", "et",
    "son", "sa", "ses", "leur", "ce", "cet", "cette", "aux", "du", "de", "la", "le", "en", "au",
    "par", "est", "sont", "pas", "peu", "plutôt", "très", "plus", "tout", "tous", "toute",
    "comme", "donc", "ainsi", "chez", "entre", "après", "avant", "depuis",
}

def _keywords_from_notes(notes: str | None) -> List[str]:
    """Extract keywords from prospect notes (3+ chars, no stopwords). Weight ×1 in matching."""
    if not notes or not str(notes).strip():
        return []
    text = (notes or "").lower().strip()
    # Normalize accents for word boundaries
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    words = re.findall(r"[a-z0-9éèêëàâäùûüîïôöç]+", text)
    seen = set()
    out = []
    for w in words:
        if len(w) < 3 or w in NOTES_STOPWORDS or w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out[:25]  # cap to avoid noise


def _keywords_from_fixed_metier(fixed_metier: str | None) -> List[str]:
    """Derive keywords from fixedMetier e.g. 'Project Manager > Achat / Industrialisation'."""
    if not fixed_metier or not str(fixed_metier).strip():
        return []
    raw = str(fixed_metier).strip()
    parts = re.split(r"\s*>\s*|\s*/\s*", raw)
    return [p.strip() for p in parts if len(p.strip()) >= 2]


# ====== Utils: SQLite Row conversion ======
def _row_to_dict(row) -> Dict[str, Any] | None:
    """Convert sqlite3.Row to dict safely. Returns None if row is None."""
    if row is None:
        return None
    if isinstance(row, sqlite3.Row):
        return dict(row)
    if isinstance(row, dict):
        return row
    # Fallback: try to convert to dict
    try:
        return dict(row)
    except Exception:
        return None


# ====== Utils: JSON lists for candidates (skills, company_ids) ======
def _parse_json_str_list(v: Any) -> List[str]:
    """Accepts None | list | json string list | comma-separated string."""
    if v is None:
        return []
    if isinstance(v, list):
        out = [str(x).strip() for x in v if str(x).strip()]
        # dedupe (case-insensitive)
        seen = set()
        uniq: List[str] = []
        for s in out:
            k = s.lower()
            if k in seen:
                continue
            seen.add(k)
            uniq.append(s)
        return uniq
    s = str(v).strip()
    if not s:
        return []
    try:
        j = json.loads(s)
        if isinstance(j, list):
            return _parse_json_str_list(j)
    except Exception:
        pass
    # fallback "a, b, c"
    return _parse_json_str_list([x for x in (t.strip() for t in s.split(',')) if x])


def _parse_json_int_list(v: Any) -> List[int]:
    if v is None:
        return []
    if isinstance(v, list):
        out: List[int] = []
        for x in v:
            try:
                n = int(x)
                if n not in out:
                    out.append(n)
            except Exception:
                continue
        return out
    s = str(v).strip()
    if not s:
        return []
    try:
        j = json.loads(s)
        if isinstance(j, list):
            return _parse_json_int_list(j)
    except Exception:
        pass
    # fallback "1,2,3"
    parts = [p.strip() for p in s.split(',') if p.strip()]
    return _parse_json_int_list(parts)


def _dump_json_list(v: Any, *, as_int: bool = False) -> str | None:
    """Returns a compact JSON list string or None if empty."""
    if v is None:
        return None
    if as_int:
        arr = _parse_json_int_list(v)
        return json.dumps(arr, ensure_ascii=False) if arr else None
    arr = _parse_json_str_list(v)
    return json.dumps(arr, ensure_ascii=False) if arr else None


# ====== Candidates (Sourcing) API ======

# ── Candidate events (for KPI goals) ───────────────────────────────
# We define a simple rank to detect when a candidate crosses
# "contacted" (en_cours+) or "solid" (ec1+) states.
_CANDIDATE_STATUS_RANK = {
    "nouveau": 0,
    "proposition": 1,
    "entretien": 2,
    "a_faire": 3,
    "oksi": 4,
    "top_profil": 5,
    "reunion_tech": 6,
    "valide_contrat": 7,
    "freelance": 8,
    "freelance_mission": 9,
    "nok_prequal": -1,
    "nok": -2,
    "plus_disponible": -3,
    "refus_contrat": -4,
    "hors_aura": -5,
    # legacy — kept for migration compatibility
    "a_sourcer": 0,
    "a_contacter": 1,
    "en_cours": 2,
    "ec1": 2,
    "ec2": 2,
    "ed": 3,
    "interesse": 4,
    "mission": 9,
    "refuse": -2,
    "embauche": 7,
    "archive": -3,
}

_CANDIDATE_CONTACTED_RANK = 2  # entretien
_CANDIDATE_SOLID_RANK = 4      # oksi


def _candidate_status_rank(status: str | None) -> int:
    if not status:
        return -10
    s = str(status).strip().lower()
    return _CANDIDATE_STATUS_RANK.get(s, -10)


def _log_candidate_event(conn, candidate_id: int, date_iso: str, event_type: str, title: str, meta: dict | None = None):
    """Insert a candidate_event (deduped by unique index)."""
    now = datetime.datetime.now().isoformat(timespec="seconds")
    conn.execute(
        "INSERT OR IGNORE INTO candidate_events (candidate_id, date, type, title, content, meta, createdAt) VALUES (?,?,?,?,?,?,?)",
        (int(candidate_id), date_iso, event_type, title, None, json.dumps(meta or {}, ensure_ascii=False), now),
    )


def _maybe_log_candidate_events(conn, candidate_id: int, old_status: str | None, new_status: str | None, date_iso: str):
    old_r = _candidate_status_rank(old_status)
    new_r = _candidate_status_rank(new_status)
    if old_r < _CANDIDATE_CONTACTED_RANK <= new_r:
        _log_candidate_event(conn, candidate_id, date_iso, "candidate_contacted", "Candidat contacté", {"from": old_status, "to": new_status})
    if old_r < _CANDIDATE_SOLID_RANK <= new_r:
        _log_candidate_event(conn, candidate_id, date_iso, "candidate_solid", "Profil solide", {"from": old_status, "to": new_status})


@app.get("/api/candidates")
def api_candidates_list():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    # v23.5: optional pagination via ?page=&limit=
    page_param = request.args.get("page")
    if page_param is not None:
        try:
            page = max(1, int(page_param))
            limit = min(500, max(1, int(request.args.get("limit") or 100)))
        except (TypeError, ValueError):
            page, limit = 1, 100
        offset = (page - 1) * limit
        with _conn() as conn:
            total = int(conn.execute("SELECT COUNT(*) FROM candidates WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchone()[0])
            rows = conn.execute(
                "SELECT * FROM candidates WHERE owner_id=? AND deleted_at IS NULL ORDER BY COALESCE(updatedAt, createdAt) DESC, id DESC LIMIT ? OFFSET ?;",
                (uid, limit, offset),
            ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["skills"] = _parse_json_str_list(d.get("skills"))
            d["company_ids"] = _parse_json_int_list(d.get("company_ids"))
            # v27.26: flag has_dc
            if not d.get("dossier_competence_pdf"):
                dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(d["id"])
                d["has_dc"] = dc_dir.is_dir() and any(dc_dir.glob("*.pdf"))
            else:
                d["has_dc"] = True
            out.append(d)
        from math import ceil
        return jsonify(ok=True, candidates=out, pagination={"page": page, "limit": limit, "total": total, "pages": ceil(total / limit) if limit else 1})
    # Non-paginated (backward compatible)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM candidates WHERE owner_id=? AND deleted_at IS NULL ORDER BY COALESCE(updatedAt, createdAt) DESC, id DESC;",
            (uid,),
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        d["skills"] = _parse_json_str_list(d.get("skills"))
        d["company_ids"] = _parse_json_int_list(d.get("company_ids"))
        # v27.26: flag has_dc pour savoir si un DC existe (DB ou dossier)
        if not d.get("dossier_competence_pdf"):
            dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(d["id"])
            d["has_dc"] = dc_dir.is_dir() and any(dc_dir.glob("*.pdf"))
        else:
            d["has_dc"] = True
        out.append(d)
    return jsonify(out)


@app.get("/api/candidates/<int:candidate_id>")
def api_candidate_get(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute("SELECT * FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "not_found"}), 404
        cand = dict(row)

        cand["skills"] = _parse_json_str_list(cand.get("skills"))
        cand["company_ids"] = _parse_json_int_list(cand.get("company_ids"))

        companies: List[Dict[str, Any]] = []
        if cand["company_ids"]:
            placeholders = ",".join(["?"] * len(cand["company_ids"]))
            rows2 = conn.execute(
                f"SELECT * FROM companies WHERE owner_id=? AND id IN ({placeholders}) ORDER BY groupe, site;",
                (uid, *cand["company_ids"]),
            ).fetchall()
            companies = [dict(r) for r in rows2]

    return jsonify({"ok": True, "candidate": cand, "companies": companies})


@app.put("/api/candidates/<int:candidate_id>")
def api_candidate_put(candidate_id: int):
    """Partial-update a candidate (inline edit from v30 fiche candidat)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _candidate_owned(candidate_id):
        return jsonify(ok=False, error="Accès refusé"), 403
    body = request.get_json(force=True, silent=True) or {}
    if not body:
        return jsonify(ok=False, error="Body vide"), 400

    ALLOWED = {
        "name", "role", "location", "seniority", "tech", "linkedin", "source", "status", "notes",
        "phone", "email", "sector", "prenom", "titre", "years_experience", "annees_experience",
        "domaine_principal", "description_push", "disponibilite", "mobilite", "permis_travail",
        "fonctions_recherchees", "motif_recherche", "avancement_recherches",
        "remuneration_actuelle", "pretentions_salariales", "propal_a", "langues",
        "eval_technique", "eval_personnalite", "eval_communication",
        "references_candidat", "avis_perso",
        "entretien_date", "entretien_lieu", "entretien_notes",
    }
    updates = {k: v for k, v in body.items() if k in ALLOWED}
    if not updates:
        return jsonify(ok=True)

    now = datetime.datetime.now().isoformat(timespec="seconds")
    set_clause = ", ".join(k + "=?" for k in updates) + ", updatedAt=?"
    params = list(updates.values()) + [now, candidate_id, uid]

    with _conn() as conn:
        cur = conn.execute(
            "UPDATE candidates SET " + set_clause + " WHERE id=? AND owner_id=?;",
            params,
        )
        if cur.rowcount == 0:
            return jsonify(ok=False, error="Candidat introuvable"), 404
        conn.commit()

    return jsonify(ok=True)


@app.get("/api/candidates/<int:candidate_id>/experiences")
def api_candidate_experiences_get(candidate_id: int):
    """Get all experiences for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        rows = conn.execute(
            "SELECT * FROM candidate_experiences WHERE candidate_id=? AND owner_id=? ORDER BY start_date DESC, id DESC;",
            (candidate_id, uid)
        ).fetchall()
        experiences = []
        for row in rows:
            exp = dict(row)
            # Parse technologies JSON if present
            if exp.get("technologies"):
                try:
                    exp["technologies"] = json.loads(exp["technologies"])
                except:
                    exp["technologies"] = []
            else:
                exp["technologies"] = []
            experiences.append(exp)
    return jsonify({"ok": True, "experiences": experiences})


@app.post("/api/candidates/<int:candidate_id>/experiences")
def api_candidate_experiences_post(candidate_id: int):
    """Create a new experience for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    company_name = (payload.get("company_name") or "").strip()
    if not company_name:
        return jsonify({"ok": False, "error": "company_name is required"}), 400
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        now = datetime.datetime.now().isoformat()
        technologies = payload.get("technologies")
        if isinstance(technologies, (list, dict)):
            technologies = json.dumps(technologies, ensure_ascii=False)
        elif not isinstance(technologies, str):
            technologies = ""
        cur = conn.execute(
            """INSERT INTO candidate_experiences
               (candidate_id, company_name, role, start_date, end_date, description, technologies, owner_id, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);""",
            (
                candidate_id,
                company_name,
                (payload.get("role") or "").strip() or None,
                (payload.get("start_date") or "").strip() or None,
                (payload.get("end_date") or "").strip() or None,
                (payload.get("description") or "").strip() or None,
                technologies,
                uid,
                now,
                now,
            ),
        )
        exp_id = cur.lastrowid
    return jsonify({"ok": True, "id": exp_id})


@app.get("/api/candidates/<int:candidate_id>/educations")
def api_candidate_educations_get(candidate_id: int):
    """Get all educations for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        rows = conn.execute(
            "SELECT * FROM candidate_educations WHERE candidate_id=? AND owner_id=? ORDER BY year DESC, id DESC;",
            (candidate_id, uid)
        ).fetchall()
        educations = [dict(row) for row in rows]
    return jsonify({"ok": True, "educations": educations})


@app.post("/api/candidates/<int:candidate_id>/educations")
def api_candidate_educations_post(candidate_id: int):
    """Create a new education for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    school = (payload.get("school") or "").strip()
    if not school:
        return jsonify({"ok": False, "error": "school is required"}), 400
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        now = datetime.datetime.now().isoformat()
        cur = conn.execute(
            """INSERT INTO candidate_educations
               (candidate_id, degree, school, year, specialization, owner_id, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?);""",
            (
                candidate_id,
                (payload.get("degree") or "").strip() or None,
                school,
                (payload.get("year") or "").strip() or None,
                (payload.get("specialization") or "").strip() or None,
                uid,
                now,
                now,
            ),
        )
        edu_id = cur.lastrowid
    return jsonify({"ok": True, "id": edu_id})


@app.get("/api/candidates/<int:candidate_id>/certifications")
def api_candidate_certifications_get(candidate_id: int):
    """Get all certifications for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        rows = conn.execute(
            "SELECT * FROM candidate_certifications WHERE candidate_id=? AND owner_id=? ORDER BY obtained_date DESC, id DESC;",
            (candidate_id, uid)
        ).fetchall()
        certifications = [dict(row) for row in rows]
    return jsonify({"ok": True, "certifications": certifications})


@app.post("/api/candidates/<int:candidate_id>/certifications")
def api_candidate_certifications_post(candidate_id: int):
    """Create a new certification for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        now = datetime.datetime.now().isoformat()
        cur = conn.execute(
            """INSERT INTO candidate_certifications
               (candidate_id, name, issuer, obtained_date, expiry_date, owner_id, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?);""",
            (
                candidate_id,
                name,
                (payload.get("issuer") or "").strip() or None,
                (payload.get("obtained_date") or "").strip() or None,
                (payload.get("expiry_date") or "").strip() or None,
                uid,
                now,
                now,
            ),
        )
        cert_id = cur.lastrowid
    return jsonify({"ok": True, "id": cert_id})


# ════════════════════════════════════════════════════════════
# v30 — Candidate skills + availability (granularité fine)
# ════════════════════════════════════════════════════════════

def _cand_owned_row(conn, candidate_id: int, uid: int):
    return conn.execute(
        "SELECT id, tech FROM candidates WHERE id=? AND owner_id=?;",
        (candidate_id, uid),
    ).fetchone()


@app.get("/api/candidates/<int:candidate_id>/skills")
def api_cand_skills_get(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        rows = conn.execute(
            "SELECT id, name, category, level FROM candidate_skills "
            "WHERE candidate_id=? ORDER BY category, name;",
            (candidate_id,),
        ).fetchall()
        skills = [dict(r) for r in rows]
        # Backfill depuis candidates.tech si aucune skill enregistrée
        cand_tech = cand["tech"] if "tech" in cand.keys() else None
        if not skills and cand_tech:
            tech_list = [t.strip() for t in str(cand_tech).split(",") if t.strip()]
            for name in tech_list[:40]:
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO candidate_skills (candidate_id, name, category, level) "
                        "VALUES (?,?,?,?);",
                        (candidate_id, name, "Compétences", 3),
                    )
                except Exception:
                    pass
            skills = [dict(r) for r in conn.execute(
                "SELECT id, name, category, level FROM candidate_skills "
                "WHERE candidate_id=? ORDER BY category, name;", (candidate_id,)
            ).fetchall()]
    return jsonify(ok=True, skills=skills)


@app.post("/api/candidates/<int:candidate_id>/skills")
def api_cand_skills_post(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify(ok=False, error="name is required"), 400
    category = (payload.get("category") or "").strip() or None
    level = max(1, min(5, int(payload.get("level") or 3)))
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        try:
            conn.execute(
                "INSERT INTO candidate_skills (candidate_id, name, category, level) "
                "VALUES (?,?,?,?) "
                "ON CONFLICT(candidate_id, name) DO UPDATE SET "
                "  category=excluded.category, level=excluded.level;",
                (candidate_id, name, category, level),
            )
        except Exception as e:
            return jsonify(ok=False, error=str(e)), 400
        row = conn.execute(
            "SELECT id, name, category, level FROM candidate_skills "
            "WHERE candidate_id=? AND name=?;",
            (candidate_id, name),
        ).fetchone()
    return jsonify(ok=True, skill=dict(row) if row else None)


@app.delete("/api/candidates/<int:candidate_id>/skills/<int:skill_id>")
def api_cand_skills_delete(candidate_id: int, skill_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        conn.execute(
            "DELETE FROM candidate_skills WHERE id=? AND candidate_id=?;",
            (skill_id, candidate_id),
        )
    return jsonify(ok=True)


@app.get("/api/candidates/<int:candidate_id>/availability")
def api_cand_avail_get(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        rows = conn.execute(
            "SELECT week_iso, status FROM candidate_availability "
            "WHERE candidate_id=? ORDER BY week_iso;",
            (candidate_id,),
        ).fetchall()
    return jsonify(ok=True, availability=[dict(r) for r in rows])


@app.post("/api/candidates/<int:candidate_id>/availability")
def api_cand_avail_post(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    payload = request.get_json(force=True, silent=True) or {}
    week_iso = (payload.get("week_iso") or "").strip()
    status = (payload.get("status") or "").strip().lower()
    if not week_iso or status not in ("libre", "busy", "placed"):
        return jsonify(ok=False, error="week_iso + status (libre|busy|placed) requis"), 400
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        conn.execute(
            "INSERT INTO candidate_availability (candidate_id, week_iso, status) "
            "VALUES (?,?,?) "
            "ON CONFLICT(candidate_id, week_iso) DO UPDATE SET status=excluded.status;",
            (candidate_id, week_iso, status),
        )
    return jsonify(ok=True)


@app.get("/api/candidates/<int:candidate_id>/dossier-competence")
def api_candidate_dossier_competence(candidate_id: int):
    """Serve the competence dossier PDF for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    with _conn() as conn:
        row = conn.execute("SELECT dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "not_found"}), 404
        
        pdf_path = row["dossier_competence_pdf"]
        if not pdf_path or not pdf_path.strip():
            return jsonify({"ok": False, "error": "Aucun dossier de compétence renseigné"}), 404
        
        # Chemin du PDF (peut être relatif ou absolu)
        pdf_file = Path(pdf_path)
        if not pdf_file.is_absolute():
            # Si relatif, chercher dans le dossier dossiers_competence à la racine
            pdf_file = APP_DIR / "dossiers_competence" / pdf_file
        
        if not pdf_file.exists() or not pdf_file.is_file():
            return jsonify({"ok": False, "error": "Fichier PDF introuvable"}), 404
        
        # Vérifier que c'est bien un PDF
        if pdf_file.suffix.lower() != ".pdf":
            return jsonify({"ok": False, "error": "Le fichier n'est pas un PDF"}), 400
        
        try:
            return send_file(str(pdf_file), mimetype="application/pdf", as_attachment=True, download_name=pdf_file.name)
        except Exception as e:
            logger.error(f"Error serving PDF: {e}")
            return jsonify({"ok": False, "error": f"Erreur lors du chargement du PDF: {str(e)}"}), 500


@app.post("/api/candidates/save")
def api_candidates_save():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload, err = validate_payload({'name': str})
    if err:
        return err
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400

    # Normalize fields
    def _t(k): 
        v = payload.get(k)
        return (str(v).strip() if v is not None else None) or None

    cid = payload.get("id")
    _candidate_action = 'update' if cid else 'create'
    template_id = payload.get("template_id")
    template_name = (payload.get("template_name") or "").strip() or None
    try:
        template_id = int(template_id) if template_id not in (None, "", "null") else None
    except Exception:
        template_id = None

    now = datetime.datetime.now().isoformat(timespec="seconds")
    event_date = now[:10]

    skills_json = _dump_json_list(payload.get("skills"), as_int=False)
    company_ids_json = _dump_json_list(payload.get("company_ids"), as_int=True)

    is_archived = 0
    try:
        is_archived = int(payload.get("is_archived") or 0)
    except Exception:
        is_archived = 0

    years_experience = None
    try:
        ye = payload.get("years_experience")
        years_experience = int(ye) if ye not in (None, "", "null") else None
    except Exception:
        years_experience = None

    with _conn() as conn:
        cur = conn.cursor()
        old_status = None
        existing_dc_path = None
        if cid:
            try:
                r0 = conn.execute("SELECT status, dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
                old_status = r0["status"] if r0 else None
                existing_dc_path = r0["dossier_competence_pdf"] if r0 else None
            except Exception:
                old_status = None
        # v27.x: champs prenom, titre, annees_experience, domaine_principal
        annees_exp_v = None
        try:
            ae = payload.get("annees_experience")
            annees_exp_v = int(ae) if ae not in (None, "", "null") else None
        except Exception:
            annees_exp_v = None

        # v28.1: champs fiche entretien
        permis_conduire_v = None
        try:
            pc = payload.get("permis_conduire")
            permis_conduire_v = int(pc) if pc not in (None, "", "null") else None
        except Exception:
            permis_conduire_v = None
        vehicule_v = None
        try:
            vh = payload.get("vehicule")
            vehicule_v = int(vh) if vh not in (None, "", "null") else None
        except Exception:
            vehicule_v = None

        if cid:
            cur.execute(
                '''
                UPDATE candidates
                SET name=?, role=?, location=?, seniority=?, tech=?, linkedin=?, source=?, status=?, notes=?,
                    onenote_url=?, vsa_url=?, skills=?, company_ids=?, is_archived=?,
                    years_experience=?, sector=?, phone=?, email=?, dossier_competence_pdf=?,
                    prenom=?, titre=?, annees_experience=?, domaine_principal=?,
                    description_push=?,
                    disponibilite=?, mobilite=?, permis_conduire=?, vehicule=?, permis_travail=?,
                    fonctions_recherchees=?, motif_recherche=?, avancement_recherches=?,
                    remuneration_actuelle=?, pretentions_salariales=?, propal_a=?,
                    eval_technique=?, eval_personnalite=?, eval_communication=?,
                    langues=?, references_candidat=?, avis_perso=?,
                    entretien_date=?, entretien_lieu=?, entretien_notes=?,
                    updatedAt=?
                WHERE id=? AND owner_id=?;
                ''',
                (
                    name,
                    _t("role"),
                    _t("location"),
                    _t("seniority"),
                    _t("tech"),
                    _t("linkedin"),
                    _t("source"),
                    _t("status"),
                    _t("notes"),
                    _t("onenote_url"),
                    _t("vsa_url"),
                    skills_json,
                    company_ids_json,
                    is_archived,
                    years_experience,
                    _t("sector"),
                    _t("phone"),
                    _t("email"),
                    _t("dossier_competence_pdf") or existing_dc_path,
                    _t("prenom"),
                    _t("titre"),
                    annees_exp_v,
                    _t("domaine_principal"),
                    _t("description_push"),
                    _t("disponibilite"),
                    _t("mobilite"),
                    permis_conduire_v,
                    vehicule_v,
                    _t("permis_travail"),
                    _t("fonctions_recherchees"),
                    _t("motif_recherche"),
                    _t("avancement_recherches"),
                    _t("remuneration_actuelle"),
                    _t("pretentions_salariales"),
                    _t("propal_a"),
                    _t("eval_technique"),
                    _t("eval_personnalite"),
                    _t("eval_communication"),
                    _t("langues"),
                    _t("references_candidat"),
                    _t("avis_perso"),
                    _t("entretien_date"),
                    _t("entretien_lieu"),
                    _t("entretien_notes"),
                    now,
                    int(cid),
                    uid,
                ),
            )
            if cur.rowcount == 0:
                cid = None  # fallback to insert
        if not cid:
            cur.execute(
                '''
                INSERT INTO candidates (
                    name, role, location, seniority, tech, linkedin, source, status, notes,
                    onenote_url, vsa_url, skills, company_ids, is_archived,
                    years_experience, sector, phone, email, dossier_competence_pdf,
                    prenom, titre, annees_experience, domaine_principal,
                    description_push,
                    disponibilite, mobilite, permis_conduire, vehicule, permis_travail,
                    fonctions_recherchees, motif_recherche, avancement_recherches,
                    remuneration_actuelle, pretentions_salariales, propal_a,
                    eval_technique, eval_personnalite, eval_communication,
                    langues, references_candidat, avis_perso,
                    entretien_date, entretien_lieu, entretien_notes,
                    createdAt, updatedAt, owner_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                ''',
                (
                    name,
                    _t("role"),
                    _t("location"),
                    _t("seniority"),
                    _t("tech"),
                    _t("linkedin"),
                    _t("source"),
                    _t("status"),
                    _t("notes"),
                    _t("onenote_url"),
                    _t("vsa_url"),
                    skills_json,
                    company_ids_json,
                    is_archived,
                    years_experience,
                    _t("sector"),
                    _t("phone"),
                    _t("email"),
                    _t("dossier_competence_pdf"),
                    _t("prenom"),
                    _t("titre"),
                    annees_exp_v,
                    _t("domaine_principal"),
                    _t("description_push"),
                    _t("disponibilite"),
                    _t("mobilite"),
                    permis_conduire_v,
                    vehicule_v,
                    _t("permis_travail"),
                    _t("fonctions_recherchees"),
                    _t("motif_recherche"),
                    _t("avancement_recherches"),
                    _t("remuneration_actuelle"),
                    _t("pretentions_salariales"),
                    _t("propal_a"),
                    _t("eval_technique"),
                    _t("eval_personnalite"),
                    _t("eval_communication"),
                    _t("langues"),
                    _t("references_candidat"),
                    _t("avis_perso"),
                    _t("entretien_date"),
                    _t("entretien_lieu"),
                    _t("entretien_notes"),
                    now,
                    now,
                    uid,
                ),
            )
            cid = cur.lastrowid

        # Candidate KPI events (contacted / solid) based on status transition
        try:
            _maybe_log_candidate_events(conn, int(cid), old_status, _t("status"), event_date)
        except Exception:
            pass

    log_activity(_candidate_action, 'candidat', cid, name)
    return jsonify({"ok": True, "id": cid})


@app.get("/api/candidates/fiche-entretien-template")
def api_candidates_fiche_entretien_template():
    """Télécharge le modèle de fiche entretien Excel."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    template_path = APP_DIR / "docs" / "Fiche entretien NEW Prenom NOM - EC1 XXX  JJMMAAAA.xlsx"
    if not template_path.exists():
        return jsonify(ok=False, error="Modèle non trouvé"), 404
    return send_file(str(template_path), as_attachment=True, download_name="fiche_entretien_Up.xlsx")


@app.post("/api/candidates/parse-fiche-entretien")
def api_candidates_parse_fiche_entretien():
    """Parse une fiche entretien Excel (format Up Technologies) via Ollama.
    Retourne un JSON avec les champs extraits pour pré-remplir la fiche candidat.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify(ok=False, error="Fichier manquant"), 400
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify(ok=False, error="Format non supporté (xlsx/xls requis)"), 400

    try:
        import openpyxl
        wb = openpyxl.load_workbook(BytesIO(file.read()), data_only=True)
        lines = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            for row in ws.iter_rows(values_only=True):
                non_none = [str(v).strip() for v in row if v is not None and str(v).strip()]
                if non_none:
                    lines.append(" | ".join(non_none))
        excel_text = "\n".join(lines[:150])  # limiter à 150 lignes
    except Exception as e:
        return jsonify(ok=False, error=f"Erreur lecture Excel : {e}"), 400

    prompt = f"""Tu es un assistant RH expert. Voici le contenu brut d'une fiche d'entretien candidat extraite d'un fichier Excel :

---
{excel_text}
---

Extrait les informations suivantes et retourne UNIQUEMENT un objet JSON valide, sans texte avant ni après, sans balises markdown :
{{
  "disponibilite": "date ou délai de disponibilité du candidat (ex: Immédiate, 1 mois de préavis, 3 mois)",
  "mobilite": "zones géographiques acceptées (ex: Lyon, Paris, Grenoble, Nationale, Internationale)",
  "permis_conduire": 1 ou 0,
  "vehicule": 1 ou 0,
  "permis_travail": "type de permis de travail si mentionné (ex: Salarié, CDI, indépendant)",
  "fonctions_recherchees": "postes et secteurs recherchés",
  "motif_recherche": "motif de départ / motivations",
  "avancement_recherches": "avancement des autres pistes (ex: ED, EP, Std By, actif discret)",
  "remuneration_actuelle": "rémunération actuelle (fixe + variable + avantages)",
  "pretentions_salariales": "prétentions salariales souhaitées",
  "propal_a": "salaire proposé par l'entreprise si mentionné",
  "eval_technique": "évaluation technique (note ou commentaire)",
  "eval_personnalite": "évaluation personnalité",
  "eval_communication": "évaluation communication",
  "langues": "langues et niveaux (ex: Anglais B2 testé, Espagnol A1)",
  "references_candidat": "références transmises (nom, fonction, société, contact)",
  "avis_perso": "avis personnel du consultant sur le candidat — texte libre de la case Détails / commentaires de la section Évaluation"
}}

Si une information est absente, mets null pour les champs numériques et \"\" pour les champs texte."""

    try:
        config = _load_ai_config()
        timeout = int(config.get("ollama_timeout", 120))
        raw = _call_ollama_direct(prompt, config, timeout)
        # Extraire le JSON de la réponse
        json_match = re.search(r'\{[\s\S]*\}', raw)
        if not json_match:
            return jsonify(ok=False, error="L'IA n'a pas retourné de JSON valide", raw=raw[:500]), 422
        parsed = json.loads(json_match.group(0))
        return jsonify(ok=True, fields=parsed)
    except json.JSONDecodeError as e:
        return jsonify(ok=False, error=f"JSON invalide retourné par l'IA : {e}", raw=raw[:500] if 'raw' in dir() else ""), 422
    except Exception as e:
        return jsonify(ok=False, error=f"Erreur IA : {e}"), 500


@app.post("/api/candidates/delete")
def api_candidates_delete():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    cid = payload.get("id")
    if not cid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    _cand_name = None
    with _conn() as conn:
        _cand_row = conn.execute("SELECT name FROM candidates WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        _cand_name = _cand_row["name"] if _cand_row else None
        # v23.5: soft delete instead of hard delete
        conn.execute("UPDATE candidates SET deleted_at=? WHERE id=? AND owner_id=?;", (_now_iso(), int(cid), uid))
    _audit_log("soft_delete", "candidate", int(cid))
    log_activity('delete', 'candidat', int(cid), _cand_name)
    return jsonify({"ok": True})


# ═══════════════════════════════════════════════════════════════════
# v27.4: Helper extraction texte PDF depuis fichier disque
# ═══════════════════════════════════════════════════════════════════

def _extract_pdf_text(pdf_path: Path, max_chars: int = 6000) -> str:
    """Extrait le texte d'un fichier PDF sur disque. Retourne chaîne vide en cas d'échec."""
    if not pdf_path.is_file():
        return ""
    try:
        import io as _io
        pdf_bytes = pdf_path.read_bytes()
        pdf_text = ""
        # Tenter avec pdfminer
        try:
            from pdfminer.high_level import extract_text as _pdfminer_extract  # type: ignore
            pdf_text = _pdfminer_extract(_io.BytesIO(pdf_bytes), maxpages=8) or ""
        except ImportError:
            pass
        # Fallback: pypdf
        if not pdf_text.strip():
            try:
                import pypdf  # type: ignore
                reader = pypdf.PdfReader(_io.BytesIO(pdf_bytes))
                for page in reader.pages[:8]:
                    pdf_text += page.extract_text() or ""
            except ImportError:
                pass
        return pdf_text[:max_chars].strip()
    except Exception as e:
        logger.warning("_extract_pdf_text(%s) error: %s", pdf_path, e)
        return ""


# ═══════════════════════════════════════════════════════════════════
# v27.x PARTIE 3: Extraction DC PDF + upload DC
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/candidates/extract-dc")
def api_candidates_extract_dc():
    """Extrait les champs d'un DC PDF via Ollama (local, données confidentielles).
    Retourne: { ok, fields: { name, prenom, titre, annees_experience, domaine_principal, tags, role } }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if 'dc' not in request.files:
        return jsonify(ok=False, error="Champ 'dc' manquant"), 400

    pdf_file = request.files['dc']
    if not pdf_file.filename:
        return jsonify(ok=False, error="Nom de fichier vide"), 400

    # Lire le PDF et extraire le texte
    pdf_text = ""
    try:
        import io
        pdf_bytes = pdf_file.read()

        # Tenter avec pdfminer (souvent disponible)
        try:
            from pdfminer.high_level import extract_text as _extract_pdf  # type: ignore
            pdf_text = _extract_pdf(io.BytesIO(pdf_bytes), maxpages=5) or ""
        except ImportError:
            pass

        # Fallback: pypdf
        if not pdf_text:
            try:
                import pypdf  # type: ignore
                reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
                for page in reader.pages[:5]:
                    pdf_text += page.extract_text() or ""
            except ImportError:
                pass

        if not pdf_text.strip():
            return jsonify(ok=False, error="Impossible d'extraire le texte du PDF (bibliothèque PDF manquante)"), 422
    except Exception as e:
        return jsonify(ok=False, error=f"Erreur lecture PDF: {e}"), 500

    # Limiter le texte pour Ollama
    pdf_text_short = pdf_text[:4000]

    prompt = f"""Tu es un assistant qui extrait des informations d'un dossier de compétences (CV) d'un ingénieur.
Dossier de compétences (extrait) :
{pdf_text_short}

Extrait les informations suivantes au format JSON strict (sans commentaire, sans markdown) :
{{
  "name": "Prénom NOM",
  "prenom": "Prénom",
  "titre": "Titre ou poste principal",
  "annees_experience": <nombre entier d'années d'expérience ou null>,
  "domaine_principal": "domaine principal (ex: Systèmes embarqués, Automotive, Défense...)",
  "tags": ["tag1", "tag2", ...],
  "role": "rôle court pour la liste (ex: Embedded Software Engineer)"
}}
Réponds uniquement avec le JSON, sans aucun texte autour."""

    try:
        result_text = _call_ai(prompt, timeout=60)
        # Parser le JSON
        # Nettoyer les éventuels marqueurs markdown
        clean = result_text.strip()
        if clean.startswith("```"):
            clean = re.sub(r'^```[^\n]*\n?', '', clean)
            clean = re.sub(r'\n?```$', '', clean)
        fields = json.loads(clean)
        return jsonify(ok=True, fields=fields)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("DC extraction JSON parse error: %s — response: %s", e, result_text[:200] if 'result_text' in dir() else '')
        return jsonify(ok=False, error="L'IA n'a pas retourné un JSON valide"), 422
    except Exception as e:
        logger.warning("DC extraction error: %s", e)
        return jsonify(ok=False, error=f"IA indisponible: {e}"), 503


@app.post("/api/candidates/upload-dc")
def api_candidates_upload_dc():
    """Sauvegarde le DC PDF d'un candidat dans data/dossiers_candidats/{uid}/{cid}/.
    Attend multipart/form-data: 'dc' (PDF) + 'candidate_id' (int).
    Sécurisé : un user ne peut uploader que pour ses propres candidats.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if 'dc' not in request.files:
        return jsonify(ok=False, error="Champ 'dc' manquant"), 400

    candidate_id = request.form.get("candidate_id")
    if not candidate_id:
        return jsonify(ok=False, error="candidate_id manquant"), 400

    try:
        cid_int = int(candidate_id)
    except ValueError:
        return jsonify(ok=False, error="candidate_id invalide"), 400

    # Vérifier que le candidat appartient à l'utilisateur
    with _conn() as conn:
        cand_row = conn.execute(
            "SELECT id, name FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid_int, uid)
        ).fetchone()
    if not cand_row:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    pdf_file = request.files['dc']
    if not pdf_file.filename:
        return jsonify(ok=False, error="Nom de fichier vide"), 400

    filename = "".join(c for c in pdf_file.filename if c.isalnum() or c in "._- ")
    if not filename.lower().endswith('.pdf'):
        return jsonify(ok=False, error="Seuls les fichiers PDF sont acceptés"), 400

    # Dossier sécurisé par user + candidat
    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid_int)
    dc_dir.mkdir(parents=True, exist_ok=True)
    target = dc_dir / filename

    # Vérification path traversal
    try:
        if not str(target.resolve()).startswith(str((DATA_DIR / "dossiers_candidats" / str(uid)).resolve())):
            return jsonify(ok=False, error="Chemin invalide"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin invalide"), 403

    try:
        pdf_file.save(str(target))
        # Mettre à jour le champ dossier_competence_pdf du candidat
        with _conn() as conn:
            conn.execute(
                "UPDATE candidates SET dossier_competence_pdf=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (str(target), _now_iso(), cid_int, uid)
            )
        logger.info("DC uploadé: user=%s cand=%s file=%s", uid, cid_int, filename)
        return jsonify(ok=True, filename=filename, path=str(target))
    except Exception as e:
        logger.error("Erreur upload DC: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@app.get("/api/candidates/<int:cid>/dc-status")
def api_candidate_dc_status(cid):
    """Vérifie si un DC est présent pour le candidat.
    Retourne: { ok, has_dc, files: [filename], generated: [{id, filename, generated_at, download_url}] }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Candidat introuvable"), 404
        # DC générés via le générateur (table dc_generations)
        gen_rows = conn.execute(
            "SELECT id, filename, generated_at, used_ollama FROM dc_generations "
            "WHERE candidate_id=? AND owner_id=? AND deleted_at IS NULL "
            "ORDER BY generated_at DESC LIMIT 5;",
            (cid, uid)
        ).fetchall()

    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid)
    files = sorted([f.name for f in dc_dir.glob("*.pdf")]) if dc_dir.is_dir() else []
    # Fallback: ancien champ texte
    if not files and row["dossier_competence_pdf"]:
        files = [Path(row["dossier_competence_pdf"]).name]

    generated = []
    for g in (gen_rows or []):
        try:
            gen_dt = datetime.datetime.fromisoformat(g["generated_at"])
            gen_label = gen_dt.strftime('%d/%m/%Y à %H:%M')
        except Exception:
            gen_label = g["generated_at"] or ''
        generated.append({
            'id':           g["id"],
            'filename':     g["filename"] or '',
            'generated_at': gen_label,
            'used_ollama':  bool(g["used_ollama"]),
            'download_url': f'/api/dc/{g["id"]}/download',
        })

    has_dc = bool(files) or bool(generated)
    return jsonify(ok=True, has_dc=has_dc, files=files, generated=generated)


@app.post("/api/candidates/<int:cid>/dc-rename")
def api_candidate_dc_rename(cid):
    """Renomme le fichier DC d'un candidat sur le disque et met à jour la DB."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    new_name = (payload.get("new_name") or "").strip()
    if not new_name:
        return jsonify(ok=False, error="Nouveau nom manquant"), 400
    # Sécurité : nom de fichier simple, sans chemin
    new_name = "".join(c for c in new_name if c.isalnum() or c in "._- ")
    if not new_name.lower().endswith(".pdf"):
        new_name += ".pdf"

    with _conn() as conn:
        row = conn.execute(
            "SELECT dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid)
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid)
    # Trouver le fichier existant
    existing_files = sorted(dc_dir.glob("*.pdf")) if dc_dir.is_dir() else []
    if not existing_files:
        return jsonify(ok=False, error="Aucun fichier DC trouvé"), 404

    old_file = existing_files[0]
    new_file = dc_dir / new_name

    # Vérification path traversal
    try:
        base = str((DATA_DIR / "dossiers_candidats" / str(uid)).resolve())
        if not str(new_file.resolve()).startswith(base):
            return jsonify(ok=False, error="Chemin invalide"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin invalide"), 403

    try:
        old_file.rename(new_file)
        with _conn() as conn:
            conn.execute(
                "UPDATE candidates SET dossier_competence_pdf=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (str(new_file), _now_iso(), cid, uid)
            )
        logger.info("DC renommé: user=%s cand=%s %s→%s", uid, cid, old_file.name, new_name)
        return jsonify(ok=True, filename=new_name)
    except Exception as e:
        logger.error("Erreur renommage DC: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@app.post("/api/candidates/<int:cid>/dc-delete")
def api_candidate_dc_delete(cid):
    """Supprime le(s) fichier(s) DC d'un candidat du disque et efface le champ en DB."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid)
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid)
    deleted = []
    if dc_dir.is_dir():
        for f in dc_dir.glob("*.pdf"):
            try:
                f.unlink()
                deleted.append(f.name)
            except Exception as e:
                logger.error("Erreur suppression DC %s: %s", f, e)

    with _conn() as conn:
        conn.execute(
            "UPDATE candidates SET dossier_competence_pdf=NULL, updatedAt=? WHERE id=? AND owner_id=?;",
            (_now_iso(), cid, uid)
        )
    logger.info("DC supprimé: user=%s cand=%s files=%s", uid, cid, deleted)
    return jsonify(ok=True, deleted=deleted)


@app.post("/api/prospects/delete")
def api_prospects_delete():
    """v27.10: Soft delete a prospect (fenêtre d'annulation 10s via /api/soft-deleted/restore)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    pid = payload.get("id")
    if not pid:
        return jsonify(ok=False, error="id is required"), 400
    _name = None
    with _conn() as conn:
        _row = conn.execute("SELECT name FROM prospects WHERE id=? AND owner_id=?;", (int(pid), uid)).fetchone()
        _name = _row["name"] if _row else None
        conn.execute("UPDATE prospects SET deleted_at=? WHERE id=? AND owner_id=?;", (_now_iso(), int(pid), uid))
    _audit_log("soft_delete", "prospect", int(pid))
    log_activity('delete', 'prospect', int(pid), _name)
    return jsonify(ok=True)


@app.get("/api/companies/list")
def api_companies_list():
    """v30.2: Liste allégée des entreprises de l'utilisateur pour alimenter
    l'autocomplete « entreprise » (picker) sur toutes les pages."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, groupe, site FROM companies "
            "WHERE owner_id=? AND deleted_at IS NULL "
            "ORDER BY LOWER(groupe), LOWER(COALESCE(site,''));",
            (uid,)
        ).fetchall()
    companies = [
        {"id": int(r["id"]), "groupe": r["groupe"] or "", "site": r["site"] or ""}
        for r in rows
    ]
    return jsonify(ok=True, companies=companies)


@app.post("/api/companies/create")
@role_required('editor')
def api_companies_create():
    """v30.4 : créer une entreprise (sans prospect attaché). Retourne l'ID assigné."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    groupe = (payload.get("groupe") or "").strip()
    if not groupe:
        return jsonify(ok=False, error="groupe est requis"), 400
    site = (payload.get("site") or "").strip()
    phone = (payload.get("phone") or "").strip()
    notes = (payload.get("notes") or "").strip()
    website = (payload.get("website") or "").strip()
    linkedin = (payload.get("linkedin") or "").strip()
    industry = (payload.get("industry") or "").strip()
    tags_raw = payload.get("tags")
    if isinstance(tags_raw, list):
        tags_json = json.dumps([str(t).strip() for t in tags_raw if str(t).strip()], ensure_ascii=False)
    elif isinstance(tags_raw, str) and tags_raw.strip():
        s = tags_raw.strip()
        if s.startswith("["):
            tags_json = s
        else:
            tags_json = json.dumps([t.strip() for t in s.split(",") if t.strip()], ensure_ascii=False)
    else:
        tags_json = "[]"
    with _conn() as conn:
        # Dedupe strict : même groupe + site + owner → on renvoie l'existant
        row = conn.execute(
            "SELECT id FROM companies WHERE owner_id=? AND LOWER(groupe)=LOWER(?) AND LOWER(COALESCE(site,''))=LOWER(?) AND deleted_at IS NULL;",
            (uid, groupe, site)
        ).fetchone()
        if row:
            return jsonify(ok=True, id=int(row["id"]), deduped=True)
        max_id = conn.execute("SELECT COALESCE(MAX(id),0) as m FROM companies WHERE owner_id=?;", (uid,)).fetchone()["m"]
        new_id = int(max_id) + 1
        conn.execute(
            """INSERT INTO companies (id, groupe, site, phone, notes, tags, website, linkedin, industry, owner_id)
               VALUES (?,?,?,?,?,?,?,?,?,?);""",
            (new_id, groupe, site, phone, notes, tags_json, website, linkedin, industry, uid)
        )
    return jsonify(ok=True, id=new_id)


@app.post("/api/companies/delete")
def api_companies_delete():
    """v27.10: Soft delete a company (fenêtre d'annulation 10s via /api/soft-deleted/restore)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    cid = payload.get("id")
    if not cid:
        return jsonify(ok=False, error="id is required"), 400
    _name = None
    with _conn() as conn:
        _row = conn.execute("SELECT groupe FROM companies WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        _name = _row["groupe"] if _row else None
        conn.execute("UPDATE companies SET deleted_at=? WHERE id=? AND owner_id=?;", (_now_iso(), int(cid), uid))
    _audit_log("soft_delete", "company", int(cid))
    log_activity('delete', 'entreprise', int(cid), _name)
    return jsonify(ok=True)


@app.post("/api/candidates/status")
def api_candidates_set_status():
    """Quick status update for a candidate (used by pipeline quick actions)."""
    payload = request.get_json(force=True, silent=True) or {}
    cid = payload.get("id") or payload.get("candidate_id")
    status = (payload.get("status") or "").strip()
    if not cid or not status:
        return jsonify(ok=False, error="id et status requis"), 400

    # Keep is_archived in sync with status when relevant
    st = status.lower()
    _ARCHIVE_STATUSES = {"nok_prequal", "nok", "plus_disponible", "refus_contrat", "hors_aura", "archive"}
    _ACTIVE_STATUSES = {
        "nouveau", "proposition", "entretien", "a_faire", "oksi", "top_profil",
        "reunion_tech", "valide_contrat", "freelance", "freelance_mission",
        # legacy
        "a_sourcer", "a_contacter", "en_cours", "ec1", "ec2", "ed",
        "interesse", "mission", "embauche", "refuse",
    }
    is_archived = None
    if st in _ARCHIVE_STATUSES:
        is_archived = 1
    elif st in _ACTIVE_STATUSES:
        is_archived = 0

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    now = datetime.datetime.now().isoformat(timespec="seconds")
    event_date = now[:10]
    with _conn() as conn:
        # fetch previous status for goal events
        r0 = conn.execute("SELECT status FROM candidates WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        if not r0:
            return jsonify(ok=False, error="Candidat non trouvé"), 404
        old_status = r0["status"]

        if is_archived is None:
            cur = conn.execute(
                "UPDATE candidates SET status=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (status, now, int(cid), uid),
            )
        else:
            cur = conn.execute(
                "UPDATE candidates SET status=?, is_archived=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (status, is_archived, now, int(cid), uid),
            )
        if cur.rowcount == 0:
            return jsonify(ok=False, error="not_found"), 404
        # goal events
        try:
            _maybe_log_candidate_events(conn, int(cid), old_status, status, event_date)
        except Exception:
            pass
    return jsonify(ok=True, updatedAt=now)


@app.post("/api/candidates/bulk-update")
def api_candidates_bulk_update():
    """Bulk update a whitelisted field for selected candidates (owner only)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    ids = payload.get("ids", [])
    field = payload.get("field", "")
    value = payload.get("value", "")
    ALLOWED_FIELDS = {"status": "status"}
    if field not in ALLOWED_FIELDS or not ids:
        return jsonify(ok=False, error="Requête invalide"), 400
    try:
        ids = [int(i) for i in ids]
    except (TypeError, ValueError):
        return jsonify(ok=False, error="IDs invalides"), 400
    col = ALLOWED_FIELDS[field]
    now = datetime.datetime.now().isoformat(timespec="seconds")
    db_path = _get_user_db(uid)
    conn = sqlite3.connect(db_path)
    try:
        placeholders = ",".join("?" * len(ids))
        conn.execute(
            f"UPDATE candidates SET {col}=?, updatedAt=? WHERE id IN ({placeholders}) AND owner_id=? AND deleted_at IS NULL",
            [value, now] + ids + [uid],
        )
        conn.commit()
        updated = conn.execute("SELECT changes()").fetchone()[0]
        return jsonify(ok=True, updated=updated)
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 500
    finally:
        conn.close()


@app.post("/api/candidate-push")
def api_candidate_push_add():
    """Log a candidate → prospect push (simple history, reuses candidate_events)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    cid = payload.get("candidate_id")
    pid = payload.get("prospect_id")
    if not cid or not pid:
        return jsonify(ok=False, error="candidate_id et prospect_id requis"), 400
    try:
        cid_i = int(cid)
        pid_i = int(pid)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="IDs invalides"), 400
    if not _candidate_owned(cid_i) or not _prospect_owned(pid_i):
        return jsonify(ok=False, error="Accès refusé"), 403

    candidate_name = (payload.get("candidate_name") or "").strip()
    prospect_name = (payload.get("prospect_name") or "").strip()
    company_name = (payload.get("company_name") or "").strip()

    now = datetime.datetime.now().isoformat(timespec="seconds")
    event_date = now[:10]

    with _conn() as conn:
        meta = {
            "candidate_id": cid_i,
            "candidate_name": candidate_name,
            "prospect_id": pid_i,
            "prospect_name": prospect_name,
            "company_name": company_name,
        }
        # Store as generic candidate_event so it participates in KPIs if needed later.
        try:
            _log_candidate_event(
                conn,
                cid_i,
                event_date,
                "candidate_push",
                f"Proposé à {prospect_name or 'prospect'}",
                meta,
            )
        except Exception:
            # Even if logging fails, we don't block the UI.
            pass

    # Teams webhook: push candidat (v22.1)
    try:
        prefix = _get_user_prefix(uid)
        card = _build_adaptive_card(
            "Push candidat",
            [("Candidat", candidate_name), ("Prospect", prospect_name), ("Entreprise", company_name), ("Consultant", prefix), ("Date", event_date)],
            [{"title": "Voir dans Prosp'Up", "url": f"https://prospup.work/candidate?id={cid_i}"}]
        )
        _send_teams_webhook(card, "candidate_push")
    except Exception:
        pass

    return jsonify(ok=True, createdAt=now)


@app.get("/api/candidate-push")
def api_candidate_push_list():
    """Return full history of candidate → prospect pushes for a given candidate.

    Unions two data sources:
      1. push_logs (authoritative) where candidate_id1 or candidate_id2 match.
      2. candidate_events (type='candidate_push') for historical coverage.

    De-duplicates by (prospect_id, day) so entries shared across both sources
    appear once. The response also includes a per-company aggregate.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    cid = request.args.get("candidate_id", type=int)
    if not cid:
        return jsonify(ok=False, error="candidate_id requis"), 400
    if not _candidate_owned(cid):
        return jsonify(ok=False, error="Accès refusé"), 403

    pushes: list[dict[str, Any]] = []
    seen: set[tuple] = set()

    def _day(ts: str | None) -> str:
        return (ts or "")[:10]

    with _conn() as conn:
        # 1) push_logs (primary source — every email/linkedin push with a candidate attached)
        try:
            rows = conn.execute(
                """
                SELECT pl.id            AS log_id,
                       pl.prospect_id   AS prospect_id,
                       pl.sentAt        AS sentAt,
                       pl.createdAt     AS createdAt,
                       pl.channel       AS channel,
                       pl.subject       AS subject,
                       p.name           AS prospect_name,
                       c.groupe         AS company_groupe,
                       c.site           AS company_site
                  FROM push_logs pl
                  LEFT JOIN prospects p ON p.id = pl.prospect_id AND p.owner_id = ?
                  LEFT JOIN companies c ON c.id = p.company_id
                 WHERE (pl.candidate_id1 = ? OR pl.candidate_id2 = ?)
                 ORDER BY COALESCE(pl.sentAt, pl.createdAt) DESC, pl.id DESC;
                """,
                (uid, int(cid), int(cid)),
            ).fetchall()
        except Exception:
            rows = []

        for r in rows:
            prospect_id = r["prospect_id"]
            sent_at = r["sentAt"] or r["createdAt"]
            company_parts = [r["company_groupe"] or "", r["company_site"] or ""]
            company_name = " · ".join([p for p in company_parts if p]).strip()
            key = (prospect_id, _day(sent_at))
            seen.add(key)
            pushes.append(
                {
                    "candidate_id": cid,
                    "prospect_id": prospect_id,
                    "prospect_name": r["prospect_name"],
                    "company_name": company_name or None,
                    "createdAt": sent_at,
                    "channel": r["channel"],
                    "subject": r["subject"],
                    "source": "push_log",
                }
            )

        # 2) candidate_events (fallback — legacy candidate-page triggered pushes)
        try:
            rows = conn.execute(
                """
                SELECT date, title, meta, createdAt
                  FROM candidate_events
                 WHERE candidate_id=? AND type='candidate_push'
                 ORDER BY COALESCE(createdAt, date) DESC, id DESC;
                """,
                (int(cid),),
            ).fetchall()
        except Exception:
            rows = []

        for r in rows:
            try:
                meta = json.loads(r["meta"] or "{}")
            except Exception:
                meta = {}
            prospect_id = meta.get("prospect_id")
            sent_at = r["createdAt"] or r["date"]
            key = (prospect_id, _day(sent_at))
            if key in seen:
                continue
            seen.add(key)
            pushes.append(
                {
                    "candidate_id": cid,
                    "prospect_id": prospect_id,
                    "prospect_name": meta.get("prospect_name"),
                    "company_name": meta.get("company_name"),
                    "createdAt": sent_at,
                    "channel": None,
                    "subject": None,
                    "title": r["title"],
                    "source": "event",
                }
            )

    pushes.sort(key=lambda p: (p.get("createdAt") or ""), reverse=True)

    # Aggregate per company for the summary badge.
    by_company: dict[str, int] = {}
    for p in pushes:
        label = (p.get("company_name") or "").strip() or "—"
        by_company[label] = by_company.get(label, 0) + 1
    companies = sorted(
        [{"company_name": k, "count": v} for k, v in by_company.items()],
        key=lambda x: (-x["count"], x["company_name"].lower()),
    )

    return jsonify(
        ok=True,
        pushes=pushes,
        total=len(pushes),
        companies=companies,
    )


# ====== Templates API ======
@app.get("/api/templates")
def api_templates_list():
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM templates ORDER BY is_default DESC, updatedAt DESC, id DESC;"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/templates/save")
def api_templates_save():
    payload, err = validate_payload({'name': str})
    if err:
        return err
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400

    subject = (payload.get("subject") or "").rstrip("\n")
    body = (payload.get("body") or "").rstrip("\n")
    linkedin_body = (payload.get("linkedin_body") or payload.get("linkedinBody") or "").rstrip("\n")
    is_default = 1 if bool(payload.get("is_default")) else 0
    tid = payload.get("id")
    now = _now_iso()

    with _conn() as conn:
        cur = conn.cursor()
        if is_default:
            cur.execute("UPDATE templates SET is_default=0;")

        if tid:
            cur.execute(
                '''
                UPDATE templates
                SET name=?, subject=?, body=?, linkedin_body=?, is_default=?, updatedAt=?
                WHERE id=?;
                ''',
                (name, subject, body, linkedin_body, is_default, now, int(tid)),
            )
            if cur.rowcount == 0:
                tid = None

        if not tid:
            cur.execute(
                '''
                INSERT INTO templates (name, subject, body, linkedin_body, is_default, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                ''',
                (name, subject, body, linkedin_body, is_default, now, now),
            )
            tid = cur.lastrowid

    return jsonify({"ok": True, "id": tid})


@app.post("/api/templates/delete")
def api_templates_delete():
    payload = request.get_json(force=True, silent=False) or {}
    tid = payload.get("id")
    if not tid:
        return jsonify({"ok": False, "error": "id is required"}), 400

    with _conn() as conn:
        # Prevent deleting the last default template: if it's default, we will reassign another
        row = conn.execute("SELECT is_default FROM templates WHERE id=?;", (int(tid),)).fetchone()
        if not row:
            return jsonify({"ok": True})
        was_default = int(row["is_default"] or 0) == 1

        conn.execute("DELETE FROM templates WHERE id=?;", (int(tid),))

        if was_default:
            r2 = conn.execute("SELECT id FROM templates ORDER BY id DESC LIMIT 1;").fetchone()
            if r2:
                conn.execute("UPDATE templates SET is_default=1 WHERE id=?;", (int(r2["id"]),))

    return jsonify({"ok": True})


# ====== Push Categories API ======

@app.get("/api/push-categories")
def api_push_categories_list():
    """Liste les catégories push de l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute("""
            SELECT pc.*,
                   c1.name AS candidate1_name, c1.role AS candidate1_role,
                   c2.name AS candidate2_name, c2.role AS candidate2_role
            FROM push_categories pc
            LEFT JOIN candidates c1 ON pc.candidate1_id = c1.id AND c1.owner_id = pc.owner_id
            LEFT JOIN candidates c2 ON pc.candidate2_id = c2.id AND c2.owner_id = pc.owner_id
            WHERE pc.owner_id=? ORDER BY pc.name;
        """, (uid,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["keywords"] = _parse_json_str_list(d.get("keywords"))
        out.append(d)
    return jsonify(out)


@app.post("/api/push-categories/scan")
def api_push_categories_scan():
    """Scan le dossier push_templates de l'utilisateur pour créer/mettre à jour les catégories."""
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    
    import pathlib
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates"
    if not user_push_dir.is_dir():
        user_push_dir.mkdir(parents=True, exist_ok=True)
        return jsonify({"ok": True, "found": [], "created": 0, "message": "Dossier créé, aucun template trouvé"})

    found = []
    for sub in sorted(user_push_dir.iterdir()):
        if sub.is_dir() and not sub.name.startswith('.'):
            found.append(sub.name)

    now = _now_iso()
    created = 0
    with _conn() as conn:
        for name in found:
            existing = conn.execute("SELECT id FROM push_categories WHERE name=? AND owner_id=?;", (name, uid)).fetchone()
            if not existing:
                # Auto-generate keywords from folder name
                keywords = [kw.strip().lower() for kw in name.replace('_', ' ').replace('-', ' ').split() if kw.strip()]
                conn.execute(
                    "INSERT INTO push_categories (name, keywords, auto_detected, owner_id, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?, ?);",
                    (name, json.dumps(keywords, ensure_ascii=False), uid, now, now)
                )
                created += 1

    return jsonify({"ok": True, "found": found, "created": created})


@app.post("/api/push-categories/save")
def api_push_categories_save():
    """Crée ou met à jour une catégorie push pour l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    
    try:
        payload = request.get_json(force=True, silent=False) or {}
        name = (payload.get("name") or "").strip()
        if not name:
            return jsonify({"ok": False, "error": "name is required"}), 400

        keywords = payload.get("keywords", [])
        if isinstance(keywords, str):
            keywords = [k.strip() for k in keywords.split(",") if k.strip()]
        keywords_json = json.dumps(keywords, ensure_ascii=False)

        no_candidates = 1 if payload.get("no_candidates") else 0

        cid = payload.get("id")
        now = _now_iso()

        with _conn() as conn:
            # S'assurer que la table existe (migration pour DBs existantes)
            try:
                conn.execute("SELECT 1 FROM push_categories LIMIT 1;").fetchone()
            except sqlite3.OperationalError:
                # Table n'existe pas, l'initialiser
                _init_user_db(uid)

            # Auto-migration v32.3 : ajoute no_candidates si colonne manquante
            try:
                pc_cols = {r["name"] for r in conn.execute("PRAGMA table_info(push_categories);").fetchall()}
                for col, typ in (
                    ("candidate1_id", "INTEGER"),
                    ("candidate2_id", "INTEGER"),
                    ("no_candidates", "INTEGER DEFAULT 0"),
                ):
                    if col not in pc_cols:
                        conn.execute(f"ALTER TABLE push_categories ADD COLUMN {col} {typ};")
                conn.commit()
            except Exception as _e:
                app.logger.warning("Auto-migration push_categories: %s", _e)

            if cid:
                # Vérifier que la catégorie appartient à l'utilisateur
                try:
                    existing = conn.execute("SELECT id FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
                    if not existing:
                        return jsonify({"ok": False, "error": "Catégorie non trouvée ou accès refusé"}), 404
                    # Si no_candidates passe à true, on vide les slots candidats
                    if no_candidates:
                        conn.execute(
                            "UPDATE push_categories SET name=?, keywords=?, no_candidates=?, candidate1_id=NULL, candidate2_id=NULL, updatedAt=? WHERE id=? AND owner_id=?;",
                            (name, keywords_json, no_candidates, now, int(cid), uid)
                        )
                    else:
                        conn.execute(
                            "UPDATE push_categories SET name=?, keywords=?, no_candidates=?, updatedAt=? WHERE id=? AND owner_id=?;",
                            (name, keywords_json, no_candidates, now, int(cid), uid)
                        )
                except sqlite3.IntegrityError as e:
                    if "UNIQUE constraint" in str(e):
                        return jsonify({"ok": False, "error": "Une catégorie avec ce nom existe déjà"}), 400
                    raise
            else:
                try:
                    conn.execute(
                        "INSERT INTO push_categories (name, keywords, auto_detected, owner_id, no_candidates, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?, ?, ?);",
                        (name, keywords_json, uid, no_candidates, now, now)
                    )
                    row = conn.execute("SELECT last_insert_rowid() AS id;").fetchone()
                    if not row:
                        return jsonify({"ok": False, "error": "Erreur lors de la création de la catégorie"}), 500
                    cid = row["id"]
                except sqlite3.IntegrityError as e:
                    if "UNIQUE constraint" in str(e):
                        return jsonify({"ok": False, "error": "Une catégorie avec ce nom existe déjà"}), 400
                    raise
                except Exception as e:
                    app.logger.error(f"Erreur lors de la création de catégorie push: {e}", exc_info=True)
                    return jsonify({"ok": False, "error": f"Erreur serveur: {str(e)}"}), 500

        return jsonify({"ok": True, "id": cid})
    except Exception as e:
        app.logger.error(f"Erreur dans api_push_categories_save: {e}", exc_info=True)
        return jsonify({"ok": False, "error": f"Erreur serveur: {str(e)}"}), 500


@app.post("/api/push-categories/delete")
def api_push_categories_delete():
    """Supprime une catégorie push de l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    
    payload = request.get_json(force=True, silent=False) or {}
    cid = payload.get("id")
    if not cid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    
    with _conn() as conn:
        # Vérifier que la catégorie appartient à l'utilisateur
        existing = conn.execute("SELECT id FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        if not existing:
            return jsonify({"ok": False, "error": "Catégorie non trouvée ou accès refusé"}), 404
        
        # Supprimer aussi le dossier de templates si il existe
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        if cat_row:
            user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_row["name"]
            if user_push_dir.exists():
                try:
                    shutil.rmtree(user_push_dir)
                except Exception as e:
                    logger.warning("Erreur suppression dossier templates %s: %s", user_push_dir, e)
        
        conn.execute("DELETE FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid))
    return jsonify({"ok": True})


@app.get("/api/push-categories/<int:cat_id>/match-candidates")
def api_push_categories_match(cat_id: int):
    """Find top candidates matching a push category's keywords. v11: weighted."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cat_row = conn.execute("SELECT * FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
        if not cat_row:
            return jsonify({"ok": False, "error": "category not found"}), 404

        keywords = _parse_json_str_list(cat_row["keywords"])
        if not keywords:
            keywords = [cat_row["name"].lower()]

        candidates = conn.execute("SELECT * FROM candidates WHERE owner_id=?;", (uid,)).fetchall()

    # Score each candidate
    scored = []
    for c in candidates:
        c_dict = dict(c)
        if c_dict.get("is_archived"):
            continue
        skills = _parse_json_str_list(c_dict.get("skills"))
        role = (c_dict.get("role") or "").lower()
        tech = (c_dict.get("tech") or "").lower()
        c_sector = (c_dict.get("sector") or "").lower()
        c_years = c_dict.get("years_experience")
        skills_lower = [s.lower() for s in skills]

        # Build searchable text
        haystack = " ".join(skills_lower) + " " + role + " " + tech + " " + c_sector

        score = 0
        for kw in keywords:
            kw_l = kw.lower()
            # Exact skill match = 3 points
            if kw_l in skills_lower:
                score += 3
            # Partial match in role/tech = 1 point
            elif kw_l in haystack:
                score += 1

        # Bonus for experience
        if c_years and c_years > 0:
            score += min(c_years / 3, 3)

        if score > 0:
            scored.append({
                "id": c_dict["id"],
                "name": c_dict.get("name", ""),
                "role": c_dict.get("role", ""),
                "skills": skills,
                "tech": c_dict.get("tech", ""),
                "status": c_dict.get("status", ""),
                "phone": c_dict.get("phone", ""),
                "years_experience": c_years,
                "score": round(score, 1),
            })

    # Sort by score desc, return top 3
    scored.sort(key=lambda x: x["score"], reverse=True)
    return jsonify({"ok": True, "candidates": scored[:3], "keywords": keywords})


@app.get("/api/push-categories/<int:cat_id>/match-prospects")
def api_push_categories_match_prospects(cat_id: int):
    """Trouve des prospects pertinents pour une catégorie push :
    - a un email, pas de téléphone, jamais pushé par email
    - scorés par matching tags + fonction avec les mots-clés de la catégorie
    - retourne 10 prospects aléatoires parmi les mieux scorés
    """
    import random as _random
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        cat_row = conn.execute(
            "SELECT * FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)
        ).fetchone()
        if not cat_row:
            return jsonify({"ok": False, "error": "Catégorie introuvable"}), 404

        keywords = _parse_json_str_list(cat_row["keywords"])
        if not keywords:
            keywords = [cat_row["name"].lower()]

        # Prospects avec email, sans téléphone, non supprimés, jamais pushés par email
        rows = conn.execute("""
            SELECT p.id, p.name, p.fonction, p.email, p.telephone, p.tags,
                   p.statut, p.pertinence, p.pushEmailSentAt,
                   c.groupe AS company_groupe, c.site AS company_site
            FROM prospects p
            LEFT JOIN companies c ON p.company_id = c.id
            WHERE p.owner_id = ?
              AND (p.deleted_at IS NULL OR p.deleted_at = '')
              AND (p.email IS NOT NULL AND p.email != '')
              AND (p.telephone IS NULL OR p.telephone = '')
              AND (p.pushEmailSentAt IS NULL OR p.pushEmailSentAt = '')
              AND p.id NOT IN (
                  SELECT DISTINCT prospect_id FROM push_logs
                  WHERE channel = 'email' OR channel IS NULL OR channel = ''
              )
        """, (uid,)).fetchall()

    # Scorer chaque prospect sur matching mots-clés ↔ tags + fonction
    scored = []
    unscored = []

    for row in rows:
        p = dict(row)
        tags = _parse_json_str_list(p.get("tags"))
        fonction = (p.get("fonction") or "").lower()
        tags_lower = [t.lower() for t in tags]
        haystack = " ".join(tags_lower) + " " + fonction

        score = 0
        matched = []
        for kw in keywords:
            kw_l = kw.lower()
            if kw_l in tags_lower:       # correspondance exacte tag → 3 pts
                score += 3
                matched.append(kw)
            elif kw_l in haystack:       # correspondance partielle fonction/tag → 1 pt
                score += 1
                matched.append(kw)

        company = p.get("company_groupe") or p.get("company_site") or ""
        entry = {
            "id": p["id"],
            "name": p.get("name", ""),
            "email": p.get("email", ""),
            "fonction": p.get("fonction") or "",
            "company": company,
            "tags": tags,
            "score": round(score, 1),
            "matched_keywords": matched,
        }
        if score > 0:
            scored.append(entry)
        else:
            unscored.append(entry)

    scored.sort(key=lambda x: x["score"], reverse=True)

    # Sélection aléatoire : 10 depuis le pool scoré, puis compléter avec non-scorés
    if len(scored) >= 10:
        result = _random.sample(scored, 10)
    else:
        result = scored[:]
        remaining = 10 - len(result)
        if unscored and remaining > 0:
            result += _random.sample(unscored, min(remaining, len(unscored)))

    _random.shuffle(result)

    return jsonify({
        "ok": True,
        "prospects": result,
        "total_scored": len(scored),
        "total_available": len(scored) + len(unscored),
        "keywords": keywords,
        "category_name": cat_row["name"],
    })


@app.post("/api/push-categories/<int:cat_id>/set-candidates")
def api_push_categories_set_candidates(cat_id: int):
    """Enregistre les deux candidats par défaut d'une catégorie push. v27.3."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    c1 = payload.get("candidate1_id")
    c2 = payload.get("candidate2_id")
    # Accepter None ou int, rejeter autres types
    c1 = int(c1) if c1 else None
    c2 = int(c2) if c2 else None
    with _conn() as conn:
        existing = conn.execute(
            "SELECT id FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)
        ).fetchone()
        if not existing:
            return jsonify(ok=False, error="Catégorie introuvable"), 404
        conn.execute(
            "UPDATE push_categories SET candidate1_id=?, candidate2_id=?, updatedAt=? WHERE id=? AND owner_id=?;",
            (c1, c2, _now_iso(), cat_id, uid)
        )
    return jsonify(ok=True)


@app.get("/api/push-categories/<int:cat_id>/files")
def api_push_category_files(cat_id: int):
    """List template files (.msg, .eml, .oft) in the push category folder (per-user)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    import pathlib
    with _conn() as conn:
        cat_row = conn.execute("SELECT * FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404

    cat_name = cat_row["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    user_push_dir.mkdir(parents=True, exist_ok=True)

    files = []
    if user_push_dir.is_dir():
        for f in sorted(user_push_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in ('.msg', '.eml', '.oft', '.htm', '.html'):
                # Encoder correctement le nom de fichier dans l'URL pour éviter les problèmes d'encodage
                from urllib.parse import quote
                safe_name = f.name
                safe_url = f"/api/pushs/user/{uid}/{cat_id}/{quote(safe_name, safe='')}"
                files.append({
                    "name": safe_name,
                    "size": f.stat().st_size,
                    "url": safe_url
                })
    return jsonify(ok=True, category=cat_name, files=files)


@app.get("/api/pushs/<path:filepath>")
def api_serve_push_file(filepath: str):
    """Serve a push template file (.msg, .eml, etc.) for download/opening (per-user)."""
    uid = _uid()
    if not uid:
        return ("Non authentifié", 401)
    
    import pathlib
    # Nouveau format: user/<uid>/<cat_id>/filename ou ancien format: category/filename (backward compat)
    parts = filepath.split("/")
    
    if len(parts) >= 3 and parts[0] == "user":
        # Nouveau format: user/<uid>/<cat_id>/filename
        try:
            file_uid = int(parts[1])
            cat_id = int(parts[2])
            filename = "/".join(parts[3:])
        except (ValueError, IndexError):
            return ("Not found", 404)
        
        # Vérifier que l'utilisateur accède à ses propres fichiers
        if file_uid != uid:
            return ("Forbidden", 403)
        
        # Récupérer le nom de la catégorie
        with _conn() as conn:
            cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
        if not cat_row:
            return ("Not found", 404)
        
        cat_name = cat_row["name"]
        user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
        
        # Décoder le filename depuis l'URL (il peut être encodé)
        from urllib.parse import unquote
        decoded_filename = unquote(filename, encoding='utf-8', errors='replace')
        target = user_push_dir / decoded_filename
    else:
        # Ancien format (backward compat): category/filename
        if len(parts) != 2:
            return ("Not found", 404)
        cat_name, filename = parts
        
        # Fallback vers l'ancien système pushs/ pour compatibilité
        pushs_root = pathlib.Path(APP_DIR) / "pushs"
        pushs_dir = pushs_root / cat_name
        if not pushs_dir.is_dir() and pushs_root.is_dir():
            cat_norm = unicodedata.normalize("NFC", cat_name.lower().replace(" ", "_").replace("-", "_"))
            for sub in pushs_root.iterdir():
                if sub.is_dir():
                    sub_norm = unicodedata.normalize("NFC", sub.name.lower().replace(" ", "_").replace("-", "_"))
                    if sub_norm == cat_norm or cat_norm in sub_norm or sub_norm in cat_norm:
                        pushs_dir = sub
                        break
        target = pushs_dir / filename

    # Prevent directory traversal
    if ".." in str(target) or "\\" in filename or (len(parts) > 2 and "/" in filename):
        return ("Forbidden", 403)
    
    try:
        target_resolved = target.resolve()
        # Vérifier que le fichier est dans le bon répertoire
        if "user_" in str(target_resolved):
            user_dir = DATA_DIR / f"user_{uid}" / "push_templates"
            user_prefix = str(user_dir.resolve()).rstrip(os.sep) + os.sep
            if not str(target_resolved).startswith(user_prefix):
                return ("Forbidden", 403)
        else:
            # Ancien système
            pushs_root = pathlib.Path(APP_DIR) / "pushs"
            pushs_prefix = str(pushs_root.resolve()).rstrip(os.sep) + os.sep
            if not str(target_resolved).startswith(pushs_prefix):
                return ("Forbidden", 403)
    except Exception:
        return ("Forbidden", 403)
    
    if not target.is_file():
        return ("Not found", 404)

    mime_map = {
        '.msg': 'application/vnd.ms-outlook',
        '.eml': 'message/rfc822',
        '.oft': 'application/vnd.ms-outlook',
        '.htm': 'text/html',
        '.html': 'text/html',
    }
    mime = mime_map.get(target.suffix.lower(), 'application/octet-stream')
    
    # Encoder correctement le nom de fichier pour éviter les problèmes d'encodage Unicode
    # Flask gère automatiquement l'encodage RFC 2231, mais on s'assure que le nom est bien encodé
    from urllib.parse import quote
    safe_filename = filename.encode('utf-8', errors='replace').decode('utf-8')
    
    return send_file(
        str(target), 
        mimetype=mime, 
        as_attachment=False, 
        download_name=safe_filename
    )


@app.post("/api/pushs/open")
def api_open_push_file():
    """Open a push template file (.msg) directly with the OS default handler (Outlook) - per-user."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    import pathlib, subprocess, platform
    payload = request.get_json(force=True, silent=True) or {}
    cat_id = payload.get("category_id")
    filename = payload.get("filename", "")

    if not cat_id or not filename:
        return jsonify(ok=False, error="category_id and filename required"), 400
    if ".." in filename:
        return jsonify(ok=False, error="Invalid filename"), 403

    with _conn() as conn:
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (int(cat_id), uid)).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404

    cat_name = cat_row["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    target = user_push_dir / filename
    
    # Vérifier le chemin pour éviter directory traversal
    try:
        target_resolved = target.resolve()
        user_dir = DATA_DIR / f"user_{uid}" / "push_templates"
        user_prefix = str(user_dir.resolve()).rstrip(os.sep) + os.sep
        if not str(target_resolved).startswith(user_prefix):
            return jsonify(ok=False, error="Chemin invalide"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin invalide"), 403
    
    if not target.is_file():
        return jsonify(ok=False, error=f"Fichier introuvable: {filename}"), 404

    # Open with OS default handler (Outlook for .msg)
    try:
        if platform.system() == "Windows":
            os.startfile(str(target))
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return jsonify(ok=True, opened=filename)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


# ═══════════════════════════════════════════════════════════════════
# v25.9: Upload de templates pour les catégories push (per-user)
# ═══════════════════════════════════════════════════════════════════
@app.post("/api/push-categories/<int:cat_id>/upload-template")
def api_push_category_upload_template(cat_id: int):
    """Upload un template de mail pour une catégorie push (per-user)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    # Vérifier que la catégorie appartient à l'utilisateur
    with _conn() as conn:
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404
    
    if 'file' not in request.files:
        return jsonify(ok=False, error="Aucun fichier fourni"), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify(ok=False, error="Nom de fichier vide"), 400

    ok_upload, err_upload = _validate_upload(file, "mail_template")
    if not ok_upload:
        return jsonify(ok=False, error=err_upload[0]), err_upload[1]

    # Créer le dossier de la catégorie
    cat_name = cat_row["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    user_push_dir.mkdir(parents=True, exist_ok=True)
    
    # Sauvegarder le fichier
    filename = file.filename
    # Sécuriser le nom de fichier
    filename = "".join(c for c in filename if c.isalnum() or c in "._- ")
    target_path = user_push_dir / filename
    
    try:
        file.save(str(target_path))
        return jsonify(ok=True, filename=filename, url=f"/api/pushs/user/{uid}/{cat_id}/{filename}")
    except Exception as e:
        logger.error("Erreur upload template: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@app.post("/api/push-categories/<int:cat_id>/delete-template")
def api_push_category_delete_template(cat_id: int):
    """Supprime un fichier template d'une catégorie push (per-user)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404

    payload = request.get_json(force=True, silent=True) or {}
    filename = payload.get("filename", "")
    if not filename:
        return jsonify(ok=False, error="Nom de fichier manquant"), 400

    # Sécuriser le nom de fichier (pas de path traversal)
    safe_filename = "".join(c for c in filename if c.isalnum() or c in "._- ")
    if safe_filename != filename or ".." in filename or "/" in filename or "\\" in filename:
        return jsonify(ok=False, error="Nom de fichier invalide"), 400

    cat_name = cat_row["name"]
    target_path = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name / safe_filename
    try:
        if target_path.exists():
            target_path.unlink()
        return jsonify(ok=True)
    except Exception as e:
        logger.error("Erreur suppression template: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@app.post("/api/push/generate")
def api_push_generate():
    """Génère un email personnalisé (.msg/.eml) avec PJ intégrées (DC candidats).

    Reçoit: {
        "prospect_id": int,
        "category_id": int,
        "template_filename": str,
        "candidate_id1": int (optionnel),
        "candidate_id2": int (optionnel),
        "ai_descriptions": bool (optionnel)
    }

    Retourne: fichier .msg (Outlook) ou .eml (fallback) avec PJ intégrées
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    payload = request.get_json(force=True, silent=True) or {}
    template_filename = payload.get("template_filename")
    
    # Validation des paramètres requis
    if not template_filename:
        return jsonify(ok=False, error="template_filename est requis"), 400
    
    try:
        prospect_id = _validate_positive_int(payload.get("prospect_id"), "prospect_id")
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    
    try:
        category_id = _validate_positive_int(payload.get("category_id"), "category_id")
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    
    candidate_id1 = _validate_optional_positive_int(payload.get("candidate_id1"), "candidate_id1")
    candidate_id2 = _validate_optional_positive_int(payload.get("candidate_id2"), "candidate_id2")
    call_note = (payload.get("call_note") or "").strip()

    # Récupérer les données du prospect
    with _conn() as conn:
        prospect = conn.execute(
            "SELECT name, email, fonction, company_id FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid)
        ).fetchone()
        if not prospect:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        
        # Récupérer la catégorie (incl. flag no_candidates si colonne dispo)
        try:
            cat_row = conn.execute("SELECT name, no_candidates FROM push_categories WHERE id=? AND owner_id=?;", (category_id, uid)).fetchone()
            cat_no_candidates = bool(cat_row["no_candidates"]) if cat_row and "no_candidates" in cat_row.keys() else False
        except sqlite3.OperationalError:
            # Colonne no_candidates pas encore migrée (DB ancienne) — fallback sans le flag
            cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (category_id, uid)).fetchone()
            cat_no_candidates = False
        if not cat_row:
            return jsonify(ok=False, error="Catégorie introuvable"), 404

        # Récupérer les candidats et leurs DC (skippé si la catégorie est en mode "sans consultant")
        candidates_data = []
        if not cat_no_candidates:
            for cand_id in [candidate_id1, candidate_id2]:
                if not cand_id:
                    continue
                try:
                    cand = conn.execute(
                        "SELECT id, name, dossier_competence_pdf, prenom, titre, annees_experience, domaine_principal, role, years_experience, sector, description_push FROM candidates WHERE id=? AND owner_id=?;",
                        (cand_id, uid)
                    ).fetchone()
                    if cand:
                        cand_dict = _safe_row_to_dict(cand)
                        if cand_dict:
                            candidates_data.append(cand_dict)
                except Exception as e:
                    logger.warning("Erreur récupération candidat %s: %s", cand_id, e)
                    continue
    
    # Convertir sqlite3.Row en dict pour accès sécurisé
    prospect_dict = _row_to_dict(prospect)
    cat_dict = _row_to_dict(cat_row)
    if not prospect_dict or not cat_dict:
        return jsonify(ok=False, error="Erreur lors de la récupération des données"), 500
    
    # Chemin du template
    cat_name = cat_dict["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    template_path = user_push_dir / template_filename
    
    if not template_path.is_file():
        return jsonify(ok=False, error="Template introuvable"), 404
    
    # v27.4: Descriptions IA des candidats (Ollama analyse le DC PDF)
    ai_descriptions = payload.get("ai_descriptions", False)
    if ai_descriptions and candidates_data:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        def _enrich_cand(cand):
            # Utiliser le cache description_push si disponible
            desc = (cand.get("description_push") or "").strip()
            if not desc:
                desc = _generate_candidate_description_ai(cand, uid)
            if desc:
                cand["description_ai"] = desc
        # Paralléliser pour 2 candidats (~15s au lieu de ~30s)
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(_enrich_cand, c) for c in candidates_data]
            for f in as_completed(futures):
                try:
                    f.result()
                except Exception as e:
                    logger.warning("Erreur enrichissement IA candidat: %s", e)

    try:
        # Résoudre les chemins des dossiers de compétences (PJ)
        attachment_paths = []
        for cand in candidates_data:
            dc_path = _resolve_dc_path(cand, uid)
            if dc_path:
                attachment_paths.append(dc_path)
                logger.info("DC résolu pour %s: %s", cand.get('name', '?'), dc_path)
            else:
                logger.info("Pas de DC pour %s (dossier_competence_pdf=%s)",
                           cand.get('name', '?'), cand.get('dossier_competence_pdf', 'None'))

        missing_email = not prospect_dict.get("email", "").strip()

        # Méthode 1 : Outlook disponible → brouillon dans Outlook (sync Exchange/M365)
        # Fonctionne depuis n'importe quel appareil : le brouillon apparaît partout
        if OUTLOOK_AVAILABLE:
            try:
                result = _save_to_outlook_drafts(template_path, prospect_dict, candidates_data, attachment_paths, call_note=call_note)
                msg = f"Brouillon créé dans Outlook ({result['pj_count']} PJ) — vérifiez vos Brouillons"
                if missing_email:
                    msg += " — Email prospect manquant"
                if result.get("pj_errors"):
                    msg += f" — PJ en erreur: {', '.join(result['pj_errors'])}"
                return jsonify(ok=True, method="outlook_drafts", message=msg, **result)
            except Exception as e:
                logger.warning("Échec création brouillon Outlook (%s), fallback .eml", e)

        # Méthode 2 : Pas d'Outlook → .eml avec PJ intégrées (téléchargement)
        email_bytes = _generate_eml_file(template_path, prospect_dict, candidates_data, attachment_paths, call_note=call_note)
        email_filename = template_path.stem + "_personnalise.eml"

        import io
        response = send_file(
            io.BytesIO(email_bytes),
            mimetype='application/octet-stream',
            as_attachment=True,
            download_name=email_filename
        )
        if missing_email:
            response.headers['X-Warning'] = 'prospect-email-missing'
        response.headers['X-PJ-Count'] = str(len(attachment_paths))
        response.headers['X-Candidate-Count'] = str(len(candidates_data))
        return response
    except Exception as e:
        logger.exception("Erreur génération push")
        return jsonify(ok=False, error=str(e)), 500


# ═══════════════════════════════════════════════════════════════════
# v27.x PARTIE 2: Route upload template (alias simple)
# ═══════════════════════════════════════════════════════════════════
@app.post("/api/push/templates/upload")
def api_push_templates_upload():
    """Upload un template .msg/eml pour une catégorie push.
    Attend multipart/form-data avec: 'template' (fichier) + 'category_id' (int).
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if 'template' not in request.files:
        return jsonify(ok=False, error="Champ 'template' manquant"), 400

    category_id = request.form.get("category_id")
    if not category_id:
        return jsonify(ok=False, error="category_id manquant"), 400

    try:
        cat_id_int = int(category_id)
    except ValueError:
        return jsonify(ok=False, error="category_id invalide"), 400

    with _conn() as conn:
        cat_row = conn.execute(
            "SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (cat_id_int, uid)
        ).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404

    file = request.files['template']
    if not file.filename:
        return jsonify(ok=False, error="Nom de fichier vide"), 400

    # Sécuriser le nom de fichier
    filename = "".join(c for c in file.filename if c.isalnum() or c in "._- ")
    suffix = Path(filename).suffix.lower()
    if suffix not in ('.msg', '.eml', '.oft'):
        return jsonify(ok=False, error="Format non supporté (accepté: .msg, .eml, .oft)"), 400

    cat_name = cat_row["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    user_push_dir.mkdir(parents=True, exist_ok=True)
    target_path = user_push_dir / filename

    try:
        file.save(str(target_path))
        logger.info("Template push uploadé: user=%s cat=%s file=%s", uid, cat_name, filename)
        return jsonify(ok=True, filename=filename)
    except Exception as e:
        logger.error("Erreur upload template push: %s", e)
        return jsonify(ok=False, error=str(e)), 500


# ═══════════════════════════════════════════════════════════════════
# v27.4: Génération description IA candidat pour push emails
# ═══════════════════════════════════════════════════════════════════

def _resolve_dc_pdf_path(candidate: dict, uid: int) -> Path | None:
    """Résout le chemin du DC PDF d'un candidat. Retourne None si introuvable."""
    dc_path_str = candidate.get("dossier_competence_pdf", "")
    if not dc_path_str:
        # Chercher dans le dossier par convention
        cand_id = candidate.get("id")
        if cand_id:
            dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cand_id)
            if dc_dir.is_dir():
                pdfs = list(dc_dir.glob("*.pdf"))
                if pdfs:
                    return pdfs[0]
        return None

    if not os.path.isabs(dc_path_str):
        dc_path = APP_DIR / "dossiers_competence" / dc_path_str
    else:
        dc_path = Path(dc_path_str)

    if not dc_path.is_file():
        cand_id = candidate.get("id")
        if cand_id:
            alt_path = DATA_DIR / "dossiers_candidats" / str(uid) / str(cand_id) / Path(dc_path_str).name
            if alt_path.is_file():
                return alt_path
    return dc_path if dc_path.is_file() else None


def _generate_candidate_description_ai(candidate: dict, uid: int) -> str:
    """Génère une description riche d'un candidat via Ollama en analysant son DC PDF.
    Retourne la description HTML ou chaîne vide en cas d'échec.
    Cache le résultat dans la colonne description_push de la table candidates.
    """
    ai_config = _load_ai_config()
    max_chars = int(ai_config.get("candidate_pdf_max_chars") or 6000)

    dc_path = _resolve_dc_pdf_path(candidate, uid)
    if not dc_path:
        logger.info("Pas de DC PDF pour le candidat %s (id=%s)", candidate.get("name"), candidate.get("id"))
        return ""

    pdf_text = _extract_pdf_text(dc_path, max_chars=max_chars)
    if not pdf_text:
        logger.warning("Impossible d'extraire le texte du DC PDF: %s", dc_path)
        return ""

    prenom = (candidate.get("prenom") or "").strip()
    if not prenom:
        name_parts = (candidate.get("name") or "").split()
        # Noms souvent stockés en format "NOM Prénom" → prendre le dernier mot comme prénom
        prenom = name_parts[-1] if len(name_parts) > 1 else (name_parts[0] if name_parts else "Candidat")

    # Années d'expérience depuis la DB pour ancrer le prompt (évite les hallucinations)
    annees_exp = str(candidate.get("annees_experience") or candidate.get("years_experience") or "").strip()

    # Prompt personnalisé ou prompt intégré par défaut
    custom_prompt = (ai_config.get("candidate_description_prompt") or "").strip()
    if custom_prompt:
        prompt = custom_prompt.replace("{prenom}", prenom).replace("{pdf_text}", pdf_text)
    else:
        annees_instruction = (
            f"- Mentionne ses années d'expérience : utilise le chiffre EXACT du dossier ({annees_exp} ans selon sa fiche — ne pas modifier ce chiffre)"
            if annees_exp else
            "- Mentionne ses années d'expérience : utilise le chiffre EXACT écrit dans le dossier, ne pas inventer ni arrondir"
        )
        prompt = f"""Tu es un commercial senior dans une société de conseil en ingénierie. Tu dois rédiger une présentation percutante pour un email de prospection B2B — l'objectif est de DONNER ENVIE au client de rencontrer le candidat.

Rédige EXACTEMENT 2 phrases à partir du dossier de compétences ci-dessous.

PHRASE 1 — Présentation générale (identité + titre + expérience) :
- Commence OBLIGATOIREMENT par le prénom en gras HTML : <b>{prenom}</b> — utilise UNIQUEMENT ce prénom, jamais le nom de famille
- Donne son vrai titre de poste (ingénieur, développeur, architecte, chef de projet… — jamais « consultant »)
{annees_instruction}
- Cite ses domaines principaux d'intervention ou sa spécialité distinctive
- Style : clair, professionnel, direct

PHRASE 2 — Accroche vendeuse (réalisation concrète) :
- Ton dynamique avec un verbe d'action ("a conçu", "a piloté", "a développé", "a validé", "a déployé"…)
- S'appuie sur une réalisation ou mission concrète citée dans le dossier
- Met en avant la valeur apportée ou le résultat obtenu si disponible
- Peut citer 1 à 2 technologies clés pour rassurer le client

Règles ABSOLUES :
- Commence TOUJOURS par <b>{prenom}</b> (le prénom, jamais le nom de famille)
- Tout le contenu doit venir EXCLUSIVEMENT du dossier ci-dessous
- En français — ne pas écrire "il/elle est disponible" ni "il/elle cherche un poste"
- Les 2 phrases ensemble font 70-100 mots max

Exemple de structure attendue :
"<b>Prénom</b>, [titre réel] avec [X] ans d'expérience, spécialisé(e) en [domaine(s) réel(s) du dossier]. Il/Elle a [réalisation concrète issue du dossier], [résultat ou point fort différenciant]."

Dossier de compétences :
{pdf_text}

Réponds UNIQUEMENT avec les 2 phrases, sans guillemets, sans tiret au début, sans commentaire."""

    try:
        result = _call_ai(prompt, timeout=90)
        desc = result.strip()
        # Nettoyer éventuels guillemets ou tirets en début
        desc = re.sub(r'^[\s"\'\\-–—•]+', '', desc)
        desc = re.sub(r'[\s"\']+$', '', desc)
        # Fusionner les sauts de ligne pour n'avoir qu'un seul paragraphe
        desc = re.sub(r'\s*\n+\s*', ' ', desc)
        # Vérification minimale
        if len(desc) < 20:
            logger.warning("Description IA trop courte pour candidat %s: %s", candidate.get("id"), desc)
            return ""

        # Cacher en DB
        try:
            cand_id = candidate.get("id")
            if cand_id:
                with _conn() as conn:
                    conn.execute(
                        "UPDATE candidates SET description_push=? WHERE id=? AND owner_id=?;",
                        (desc, cand_id, uid)
                    )
                    conn.commit()
        except Exception as cache_err:
            logger.warning("Erreur cache description_push: %s", cache_err)

        return desc
    except Exception as e:
        logger.warning("Erreur génération description IA pour candidat %s: %s", candidate.get("id"), e)
        return ""


@app.post("/api/candidates/<int:cand_id>/save-description")
def api_candidate_save_description(cand_id):
    """Sauvegarde manuellement la description push d'un candidat (édition manuelle dans l'onglet Push).
    Retourne: { ok }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    description = payload.get("description", "")
    if description is not None:
        description = str(description).strip() or None
    with _conn() as conn:
        rows_affected = conn.execute(
            "UPDATE candidates SET description_push=? WHERE id=? AND owner_id=?;",
            (description, cand_id, uid)
        ).rowcount
        conn.commit()
    if rows_affected == 0:
        return jsonify(ok=False, error="Candidat introuvable"), 404
    return jsonify(ok=True)


@app.post("/api/candidates/<int:cand_id>/generate-description")
def api_candidate_generate_description(cand_id):
    """Génère ou régénère la description push IA d'un candidat.
    Retourne: { ok, description }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        cand = conn.execute(
            "SELECT id, name, dossier_competence_pdf, prenom, titre, annees_experience, domaine_principal, role, years_experience, sector FROM candidates WHERE id=? AND owner_id=?;",
            (cand_id, uid)
        ).fetchone()
    if not cand:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    cand_dict = _safe_row_to_dict(cand) or {}
    if not cand_dict:
        return jsonify(ok=False, error="Erreur données candidat"), 500

    desc = _generate_candidate_description_ai(cand_dict, uid)
    if not desc:
        return jsonify(ok=False, error="Impossible de générer la description (pas de DC PDF ou IA indisponible)"), 422

    return jsonify(ok=True, description=desc)


# ═══════════════════════════════════════════════════════════════════
# v27.x PARTIE 2: Personnalisation .msg (win32com) ou .eml (fallback)
# OUTLOOK_AVAILABLE détecté au démarrage de l'app
# ═══════════════════════════════════════════════════════════════════

def _build_candidate_descriptions(candidates_data: list) -> list:
    """Construit la liste des descriptions HTML des candidats (IA ou format statique)."""
    ORANGE = '#E07020'
    lines = []
    for cand in candidates_data:
        if cand.get("description_ai"):
            # Remplacer <b>Prénom</b> par prénom en orange (généré par le prompt IA)
            line = re.sub(
                r'<b>([^<]{1,30})</b>',
                lambda m: f'<span style="color:{ORANGE};font-weight:bold;">{m.group(1)}</span>',
                cand["description_ai"], count=1
            )
            lines.append(line)
        else:
            prenom = cand.get("prenom") or (cand.get("name", "").split()[0] if cand.get("name") else "")
            titre  = cand.get("titre") or cand.get("role", "")
            annees = cand.get("annees_experience") or cand.get("years_experience") or ""
            domaine = cand.get("domaine_principal") or cand.get("sector", "")
            line = f'<span style="color:{ORANGE};font-weight:bold;">{prenom}</span>, {titre}'
            if annees:
                line += f" avec {annees} ans d\u2019exp\u00e9rience"
            if domaine:
                line += f" en {domaine}"
            line += " \u2014 disponible imm\u00e9diatement."
            lines.append(line)
    return lines


def _apply_salutation(html_body: str, civilite: str, nom: str) -> str:
    """Remplace les placeholders de salutation dans le HTML du template.
    Accepte les placeholders [titre], [genre], [civilite] (interchangeables)
    pour le genre et [Nom], [nom], [prenom] pour le nom du prospect."""
    import re
    new_salutation = f"Bonjour {civilite} {nom},"
    # Pattern 1: "Bonjour [titre|genre|civilite] [Nom]," (avec ou sans virgule finale)
    html_body = re.sub(
        r'Bonjour\s*\[(?:titre|genre|civilit[eé])\]\s*\[(?:Nom|prenom|pr[eé]nom)\]\s*,?',
        new_salutation, html_body, count=1, flags=re.IGNORECASE
    )
    # Pattern 2: "Bonjour M. [Nom prospect]," ou variantes
    html_body = re.sub(
        r'Bonjour\s+(?:M\.|Mme\.|Dr\.?|Mme|M)?\s*\[?[Nn]om\s*(?:prospect)?\]?\s*,?',
        new_salutation, html_body, count=1, flags=re.IGNORECASE
    )
    # Pattern 3: "Bonjour M. [...]," générique
    html_body = re.sub(
        r'Bonjour\s+M\.\s+\[.*?\]\s*,?',
        new_salutation, html_body, count=1, flags=re.IGNORECASE
    )
    return html_body


def _apply_candidates(html_body: str, cand_lines: list) -> str:
    """
    Remplace le bloc candidats dans le HTML du template.
    Stratégie 1 : placeholders [Prénom candidat N]
    Stratégie 2 : remplacer le contenu entre l'ancre "consultants disponibles" et "Si ces profils"
    Stratégie 3 : insérer avant "Cordialement" en fallback
    """
    import re
    if not cand_lines:
        return html_body

    # HTML des nouvelles descriptions (tiret + indentation, prénom déjà en orange)
    new_block_html = "\n".join(
        f'<p style="margin:5px 0 5px 20px;">&#8203;&ndash;&nbsp;{line}</p>' for line in cand_lines
    )

    # Stratégie 1 : placeholders explicites [Prénom 1], [Prénom 2], [Prénom candidat N]
    # Gère aussi les artefacts RTF (*\t devant le texte dans les <li>)
    placeholder_pat = re.compile(
        r'<li\b[^>]*>(?:\s*\*[\t\s]*)?(.*?\[Pr[ée]nom(?:\s+candidat)?\s*\d*\].*?)</li>',
        re.IGNORECASE | re.DOTALL
    )
    matches = list(placeholder_pat.finditer(html_body))
    if matches:
        new_lis = '\n'.join(f'<li>{line}</li>' for line in cand_lines)
        # Remplacer tout le bloc (du premier au dernier placeholder <li>)
        start = matches[0].start()
        end = matches[-1].end()
        html_body = html_body[:start] + new_lis + html_body[end:]
        return html_body

    # Stratégie 2 : remplacer le bloc entre "consultants disponibles :" et "Si ces profils"
    # Trouve l'ancre de début (fin de la phrase d'introduction)
    anchor_start_pat = re.compile(
        r'(?:consultants\s+disponibles\s*:?\s*|dossiers\s+de\s+comp[eé]tences\s+de\s+consultants[^<\n]*:?\s*)',
        re.IGNORECASE
    )
    anchor_end_pat = re.compile(r'Si\s+ces\s+profils', re.IGNORECASE)
    m_start = anchor_start_pat.search(html_body)
    m_end   = anchor_end_pat.search(html_body)

    if m_start and m_end and m_start.end() < m_end.start():
        # Le "début" est après la balise fermante qui suit l'ancre de début
        # On cherche la prochaine fermeture de balise (</p>, </span>, <br>, etc.)
        after_anchor = html_body[m_start.end():]
        tag_close = re.search(r'(?:</(?:p|span|div|td)[^>]*>|<br\s*/?>)\s*', after_anchor, re.IGNORECASE)
        if tag_close:
            insert_from = m_start.end() + tag_close.end()
        else:
            insert_from = m_start.end()
        before = html_body[:insert_from]
        after  = html_body[m_end.start():]
        html_body = before + "\n" + new_block_html + "\n" + after
        return html_body

    # Stratégie 3 : insérer avant la signature
    for sig in (r'Si\s+ces\s+profils', r'Cordialement', r'Bien\s+cordialement', r'Je\s+vous\s+remercie'):
        m = re.search(sig, html_body, re.IGNORECASE)
        if m:
            html_body = html_body[:m.start()] + new_block_html + "\n" + html_body[m.start():]
            return html_body

    # Stratégie 4 : ajouter à la fin
    html_body += "\n" + new_block_html
    return html_body


def _remove_signature(html_body: str) -> str:
    """Supprime tout depuis 'Bien cordialement' / 'Cordialement' jusqu'à la fin du contenu.
    Conserve les balises fermantes </body></html> si présentes."""
    m = re.search(r'(?:Bien\s+cordialement|Cordialement)', html_body, re.IGNORECASE)
    if not m:
        return html_body
    # Reculer jusqu'au début du bloc parent (<p, <div, <td, <tr)
    before = html_body[:m.start()]
    block_start = re.search(r'<(?:p|div|td|tr)[^>]*>\s*$', before, re.IGNORECASE)
    cut = block_start.start() if block_start else m.start()
    # Garder </body></html> si présents
    closing = re.search(r'((?:</(?:body|html)>\s*)+)$', html_body, re.IGNORECASE | re.DOTALL)
    if closing:
        return html_body[:cut] + '\n' + closing.group(1)
    return html_body[:cut]


def _read_msg_body(template_path: Path) -> tuple:
    """
    Lit le corps HTML et le sujet d'un fichier .msg via extract-msg + RTFDE.
    Utilise des librairies robustes pour le décodage (plus de parsing RTF manuel).
    Retourne (html_body: str, subject: str).
    """
    import struct
    import olefile  # type: ignore

    html_body = ""
    subject = "Candidats disponibles"

    # 1. Sujet — via extract-msg (gère parfaitement l'encodage)
    try:
        import extract_msg  # type: ignore
        msg = extract_msg.Message(str(template_path))
        subject = msg.subject or subject
        msg.close()
    except Exception as e:
        logger.debug("extract_msg pour le sujet échoué: %s", e)

    # 2. Corps HTML — via olefile + RTFDE pour le RTF→HTML
    try:
        ole = olefile.OleFileIO(str(template_path), raise_defects=olefile.DEFECT_POTENTIAL)
    except Exception as e:
        raise ValueError(f"Impossible d'ouvrir le fichier .msg: {e}")

    try:
        # 2a. HTML direct — PT_BINARY (0102) puis PT_UNICODE (001F)
        if ole.exists('__substg1.0_10130102'):
            raw = ole.openstream('__substg1.0_10130102').read()
            for enc in ('utf-8', 'cp1252', 'latin-1'):
                try:
                    html_body = raw.decode(enc)
                    break
                except (UnicodeDecodeError, LookupError):
                    continue
            else:
                html_body = raw.decode('utf-8', errors='replace')
        elif ole.exists('__substg1.0_1013001F'):
            raw = ole.openstream('__substg1.0_1013001F').read()
            html_body = raw.decode('utf-16-le', errors='replace').rstrip('\x00')

        # 2b. RTF compressé — décompression LZFu + extraction HTML via RTFDE
        if not html_body.strip() and ole.exists('__substg1.0_10090102'):
            try:
                rtf_raw = ole.openstream('__substg1.0_10090102').read()
                # Décompression LZFu manuelle (compressed_rtf CRC check échoue sur certains .msg)
                cb_raw = struct.unpack_from('<I', rtf_raw, 4)[0]
                magic = rtf_raw[8:12]
                if magic == b'MELA':
                    rtf_bytes = rtf_raw[16:]
                elif magic == b'LZFu':
                    PREBUF = (
                        b'{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}'
                        b'{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript '
                        b'\\fdecor MS Sans SerifSymbolArialTimes New RomanCourier'
                        b'{\\colortbl\\red0\\green0\\blue0\r\n'
                        b'\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx'
                    )
                    d = bytearray(4096)
                    d[:len(PREBUF)] = PREBUF
                    wpos = len(PREBUF)
                    out = bytearray()
                    pos = 16
                    while pos < len(rtf_raw) and len(out) < cb_raw:
                        ctrl = rtf_raw[pos]; pos += 1
                        for bit in range(8):
                            if pos >= len(rtf_raw) or len(out) >= cb_raw:
                                break
                            if ctrl & (1 << bit):
                                ref = (rtf_raw[pos] << 8) | rtf_raw[pos + 1]; pos += 2
                                off = (ref >> 4) & 0xFFF
                                ln = (ref & 0xF) + 2
                                for i in range(ln):
                                    c = d[(off + i) & 0xFFF]
                                    out.append(c)
                                    d[wpos & 0xFFF] = c
                                    wpos = (wpos + 1) & 0xFFF
                            else:
                                c = rtf_raw[pos]; pos += 1
                                out.append(c)
                                d[wpos & 0xFFF] = c
                                wpos = (wpos + 1) & 0xFFF
                    rtf_bytes = bytes(out)
                else:
                    raise ValueError(f"Signature LZFu inconnue: {magic!r}")

                # Extraction HTML via RTFDE (gère parfaitement l'encodage et le fromhtml1)
                from RTFDE.deencapsulate import DeEncapsulator  # type: ignore
                de = DeEncapsulator(rtf_bytes)
                de.deencapsulate()
                raw_html = de.html
                if isinstance(raw_html, bytes):
                    html_body = raw_html.decode('utf-8', errors='replace')
                else:
                    html_body = raw_html

                # Nettoyer les artefacts RTF résiduels laissés par RTFDE
                html_body = re.sub(r'\\par\b\s*', '', html_body)       # \par → rien
                html_body = re.sub(r'(<li\b[^>]*>)\s*\*\t', r'\1', html_body)  # *\t dans les <li>
            except Exception as rtf_err:
                logger.warning("Extraction HTML depuis RTF (RTFDE) échouée: %s", rtf_err)

        # 2c. Dernier recours : corps texte brut PT_UNICODE (0x1000)
        if not html_body.strip() and ole.exists('__substg1.0_1000001F'):
            raw = ole.openstream('__substg1.0_1000001F').read()
            txt = raw.decode('utf-16-le', errors='replace').rstrip('\x00')
            if txt.strip():
                html_body = (
                    "<html><body>"
                    + txt.replace("\r\n", "\n").replace("\n", "<br>")
                    + "</body></html>"
                )
    finally:
        ole.close()

    return html_body, subject


def _resolve_dc_path(cand: dict, uid: int) -> Path | None:
    """Résout le chemin du dossier de compétence PDF d'un candidat.
    Cherche dans cet ordre :
    1. Le champ dossier_competence_pdf en DB (chemin absolu ou relatif)
    2. Le dossier data/dossiers_candidats/{uid}/{cand_id}/ (glob *.pdf)
    """
    dc_path_str = (cand.get("dossier_competence_pdf") or "").strip()
    cand_id = cand.get("id")

    candidates_paths: list[Path] = []

    # 1) Champ DB (chemin absolu ou relatif) — logique identique à /api/candidates/<id>/dossier-competence
    if dc_path_str:
        primary = Path(dc_path_str)
        if not primary.is_absolute():
            primary = APP_DIR / "dossiers_competence" / primary
        candidates_paths.append(primary)

        # Fallback : fichier déplacé vers le nouveau dossier user_id/cand_id
        if cand_id:
            candidates_paths.append(
                DATA_DIR / "dossiers_candidats" / str(uid) / str(cand_id) / Path(dc_path_str).name
            )

    # 2) Dossier par convention (toujours essayé en dernier)
    if cand_id:
        dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cand_id)
        if dc_dir.is_dir():
            for pdf in sorted(dc_dir.glob("*.pdf")):
                candidates_paths.append(pdf)

    for p in candidates_paths:
        try:
            if p.is_file() and p.suffix.lower() == ".pdf":
                logger.info("DC résolu: cand=%s path=%s", cand_id, p)
                return p
        except Exception as e:
            logger.warning("DC: erreur check %s: %s", p, e)
            continue

    logger.info("DC introuvable: cand=%s uid=%s field=%r", cand_id, uid, dc_path_str)
    return None


def _apply_call_note(html_body: str, call_note: str) -> str:
    """Injecte la phrase d'accroche 'appel manqué' juste après la salutation."""
    if not call_note or not call_note.strip():
        return html_body
    note_html = f'<p style="margin:10px 0;">{call_note.strip()}</p>'
    # Chercher la fin du bloc contenant la salutation "Bonjour ..."
    m = re.search(r'Bonjour[^<,]*,?', html_body, re.IGNORECASE)
    if m:
        after_sal = html_body[m.end():]
        tag_close = re.search(r'</(?:p|div|td|span)[^>]*>', after_sal, re.IGNORECASE)
        if tag_close:
            insert_pos = m.end() + tag_close.end()
        else:
            insert_pos = m.end()
        return html_body[:insert_pos] + '\n' + note_html + '\n' + html_body[insert_pos:]
    return note_html + '\n' + html_body


def _personalize_html_body(template_path: Path, prospect_data: dict, candidates_data: list,
                            call_note: str = '') -> tuple[str, str]:
    """
    Lit un template .msg et applique les substitutions (salutation, candidats, signature).
    Retourne (html_body, subject).
    """
    nom_complet = prospect_data.get("name", "")
    parts = nom_complet.split()
    civilite = prospect_data.get("civilite", "M.")
    nom = parts[-1] if parts else nom_complet

    html_body, subject = _read_msg_body(template_path)
    if not html_body.strip():
        raise ValueError("Le template .msg ne contient pas de corps HTML exploitable")

    html_body = _apply_salutation(html_body, civilite, nom)
    if call_note:
        html_body = _apply_call_note(html_body, call_note)
    if candidates_data:
        cand_lines = _build_candidate_descriptions(candidates_data)
        html_body = _apply_candidates(html_body, cand_lines)
    html_body = _remove_signature(html_body)

    return html_body, subject


def _save_to_outlook_drafts(template_path: Path, prospect_data: dict,
                            candidates_data: list, attachment_paths: list[Path] | None = None,
                            call_note: str = '') -> dict:
    """
    Crée l'email dans les Brouillons Outlook du serveur via win32com.
    Le brouillon se synchronise via Exchange/M365 sur tous les appareils.
    L'utilisateur retrouve l'email prêt à envoyer dans ses Brouillons.
    """
    import win32com.client  # type: ignore
    import pythoncom  # type: ignore

    # Initialiser COM pour ce thread (nécessaire si appelé depuis un thread serveur)
    pythoncom.CoInitialize()
    try:
        to_email = prospect_data.get("email", "")
        html_body, subject = _personalize_html_body(template_path, prospect_data, candidates_data, call_note=call_note)

        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)  # olMailItem = 0
        mail.To = to_email
        mail.Subject = subject
        mail.HTMLBody = html_body

        # Ajouter les pièces jointes (DC candidats)
        pj_count = 0
        pj_errors = []
        if attachment_paths:
            for att_path in attachment_paths:
                try:
                    abs_path = str(att_path.resolve())
                    mail.Attachments.Add(abs_path)
                    pj_count += 1
                    logger.info("PJ ajoutée: %s", att_path.name)
                except Exception as e:
                    pj_errors.append(att_path.name)
                    logger.warning("Erreur ajout PJ %s: %s", att_path.name, e)

        # Sauvegarder dans les Brouillons Outlook (sync Exchange/M365 automatique)
        mail.Save()
        logger.info("Brouillon Outlook créé: To=%s, Subject=%s, PJ=%d", to_email, subject, pj_count)

        return {
            "ok": True,
            "method": "outlook_drafts",
            "to": to_email,
            "subject": subject,
            "pj_count": pj_count,
            "pj_errors": pj_errors
        }
    finally:
        pythoncom.CoUninitialize()


def _generate_eml_file(template_path: Path, prospect_data: dict,
                        candidates_data: list, attachment_paths: list[Path] | None = None,
                        call_note: str = '') -> bytes:
    """
    Génère un .eml (RFC 2822) avec PJ intégrées.
    Fallback quand Outlook n'est pas disponible.
    """
    import email as email_lib
    import email.mime.multipart
    import email.mime.text
    import email.mime.base
    import email.encoders

    to_email = prospect_data.get("email", "")
    html_body, subject = _personalize_html_body(template_path, prospect_data, candidates_data, call_note=call_note)

    # Construire le .eml — mixed (HTML + PJ)
    msg_eml = email_lib.mime.multipart.MIMEMultipart("mixed")
    msg_eml["From"] = ""
    msg_eml["To"] = to_email
    msg_eml["Subject"] = subject
    msg_eml["X-Unsent"] = "1"  # Indique au client mail que c'est un brouillon non-envoyé
    msg_eml.attach(email_lib.mime.text.MIMEText(html_body, "html", "utf-8"))

    # Ajouter les pièces jointes (DC candidats)
    pj_added = 0
    if attachment_paths:
        for att_path in attachment_paths:
            try:
                att_data = att_path.read_bytes()
                part = email_lib.mime.base.MIMEBase("application", "pdf")
                part.set_payload(att_data)
                email_lib.encoders.encode_base64(part)
                # RFC 2231 encoding pour gérer les caractères non-ASCII (ex: "Antoine Baïges.pdf")
                part.add_header(
                    "Content-Disposition",
                    "attachment",
                    filename=("utf-8", "", att_path.name),
                )
                msg_eml.attach(part)
                pj_added += 1
                logger.info("PJ .eml ajoutée: %s (%d bytes)", att_path.name, len(att_data))
            except Exception as e:
                logger.warning("Erreur ajout PJ .eml %s: %s", att_path.name, e)
    logger.info("_generate_eml_file: %d PJ intégrées sur %d candidat(s)",
                pj_added, len(attachment_paths or []))

    return msg_eml.as_bytes()


# ────────────────────────────────────────────────────────────────────
# Best-match candidates – matching direct prospect.tags ↔ candidate.skills
# ────────────────────────────────────────────────────────────────────

@app.get("/api/prospect/<int:prospect_id>/best-candidates")
def api_prospect_best_candidates(prospect_id: int):
    """Find candidates whose skills best overlap with the prospect's tags.
    v11: weighted scoring — tags(×3), sector(×2), years_exp(×1.5), geo(×1)
    v12: fixedMetier keywords, notes keywords (×1), pertinence cap, push_category_id optional.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    push_category_id = request.args.get("push_category_id", type=int)

    with _conn() as conn:
        p_row = conn.execute(
            "SELECT name, tags, company_id, notes, fixedMetier, pertinence FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid),
        ).fetchone()
        if not p_row:
            return jsonify(ok=False, error="prospect not found"), 404

        prospect_tags = _parse_json_str_list(p_row["tags"])
        company_id = p_row["company_id"]
        prospect_notes = (p_row["notes"] or "").strip()
        fixed_metier = (p_row["fixedMetier"] or "").strip()
        prospect_pertinence = (p_row["pertinence"] or "").strip()

        # Piste 2: keywords from fixedMetier (merge with tags; use as fallback when no tags)
        fixed_metier_keywords = _keywords_from_fixed_metier(fixed_metier)
        prospect_tags_effective = prospect_tags or [t for t in fixed_metier_keywords if t]
        if prospect_tags and fixed_metier_keywords:
            seen = {t.lower() for t in prospect_tags}
            for kw in fixed_metier_keywords:
                if kw.lower() not in seen:
                    prospect_tags_effective.append(kw)
                    seen.add(kw.lower())

        # Piste 1 option A: keywords from notes (weight ×1 in loop)
        notes_keywords = _keywords_from_notes(prospect_notes)
        notes_keywords_lower = [k.lower() for k in notes_keywords]
        notes_keywords_set = set(notes_keywords_lower)

        # Get company info for sector + location matching
        company_tags = []
        company_city = ""
        company_industry = ""
        company_groupe = ""
        if company_id:
            c_row = conn.execute(
                "SELECT groupe, tags, city, site, industry FROM companies WHERE id=? AND owner_id=?;",
                (company_id, uid),
            ).fetchone()
            if c_row:
                # sqlite3.Row n'a pas de méthode .get(), utiliser l'accès direct
                company_groupe = (c_row["groupe"] or "").strip() if c_row["groupe"] else ""
                company_tags = _parse_json_str_list(c_row["tags"])
                company_city = ((c_row["city"] or "") if c_row["city"] else (c_row["site"] or "")).lower().strip()
                company_industry = (c_row["industry"] or "").lower().strip() if c_row["industry"] else ""

        # Piste 5: optional push category keywords
        category_keywords = []
        if push_category_id:
            cat_row = conn.execute("SELECT keywords FROM push_categories WHERE id=? AND owner_id=?;", (push_category_id, uid)).fetchone()
            if cat_row:
                cat_dict = _row_to_dict(cat_row)
                if cat_dict and cat_dict.get("keywords"):
                    category_keywords = _parse_json_str_list(cat_dict["keywords"])

        all_sources = (
            [t.lower() for t in prospect_tags_effective]
            + [t.lower() for t in company_tags]
            + [t.lower() for t in category_keywords]
            + notes_keywords_lower
        )
        if not all_sources:
            return jsonify(ok=True, candidates=[], prospect_tags=prospect_tags)

        all_search_tags = list(dict.fromkeys(all_sources))  # preserve order, dedupe

        candidates = conn.execute("SELECT * FROM candidates WHERE owner_id=?;", (uid,)).fetchall()

    # Sector keywords (extracted from company tags + industry)
    SECTOR_KEYWORDS = {"automobile", "auto", "aéronautique", "aero", "ferroviaire", "défense", "defense",
                       "spatial", "médical", "medical", "énergie", "energie", "nucléaire", "nucleaire",
                       "iot", "telecom", "robotique", "naval", "industriel", "consumer", "domotique"}
    company_sectors = set()
    for t in company_tags:
        if t.lower() in SECTOR_KEYWORDS:
            company_sectors.add(t.lower())
    if company_industry:
        for s in SECTOR_KEYWORDS:
            if s in company_industry:
                company_sectors.add(s)

    scored = []
    for c in candidates:
        c_dict = dict(c)
        if c_dict.get("is_archived"):
            continue
        skills = _parse_json_str_list(c_dict.get("skills"))
        role = (c_dict.get("role") or "").lower()
        tech = (c_dict.get("tech") or "").lower()
        c_location = (c_dict.get("location") or "").lower().strip()
        c_sector = (c_dict.get("sector") or "").lower()
        c_notes = (c_dict.get("notes") or "").lower()
        c_years = c_dict.get("years_experience")
        skills_lower = [s.lower() for s in skills]
        haystack = " ".join(skills_lower) + " " + role + " " + tech + " " + c_notes

        # 1. Tags matching amélioré avec similarité sémantique (Phase 1)
        matched_tags = []
        tag_score = 0
        semantic_matches = []  # Tags matchés via similarité sémantique
        
        for tag_l in all_search_tags:
            exact_match = False
            # Match exact d'abord
            if tag_l in skills_lower:
                tag_score += 1 if tag_l in notes_keywords_set else 3
                matched_tags.append(tag_l)
                exact_match = True
            elif tag_l in haystack:
                tag_score += 1
                matched_tags.append(tag_l)
                exact_match = True
            
            # Si pas de match exact, essayer similarité sémantique (Phase 1)
            if not exact_match:
                best_similarity = 0.0
                best_skill = None
                for skill in skills_lower:
                    similarity = _compute_semantic_similarity(tag_l, skill, "tag")
                    if similarity > 0.7 and similarity > best_similarity:  # Seuil de 70%
                        best_similarity = similarity
                        best_skill = skill
                
                if best_skill:
                    # Score réduit pour match sémantique (×2 au lieu de ×3)
                    semantic_weight = 1 if tag_l in notes_keywords_set else 2
                    tag_score += semantic_weight
                    matched_tags.append(tag_l)
                    semantic_matches.append(f"{tag_l}≈{best_skill}")

        # 2. Sector matching (weight ×2)
        sector_score = 0
        if company_sectors:
            c_sectors_text = c_sector + " " + c_notes + " " + role
            for sec in company_sectors:
                if sec in c_sectors_text:
                    sector_score += 2

        # 3. Years experience (weight ×1.5)
        exp_score = 0
        if c_years is not None and c_years > 0:
            exp_score = min(c_years / 2, 5) * 1.5  # max ~7.5pts for 10+ years

        # 4. Geographic proximity (weight ×1)
        geo_score = 0
        if company_city and c_location:
            if company_city in c_location or c_location in company_city:
                geo_score = 3
            # Same region heuristic (e.g. both mention "lyon", "rhône", "69")
            elif any(w in c_location for w in company_city.split() if len(w) > 3):
                geo_score = 1

        total_score = tag_score + sector_score + exp_score + geo_score

        if total_score > 0:
            total_prospect = len(all_search_tags) if all_search_tags else 1
            pct = round(len(matched_tags) / total_prospect * 100) if total_prospect else 0
            # Piste 3: cap pct when few tags (avoid misleading 100%)
            if total_prospect < 4:
                pct = min(pct, 85)
            # Piste 3: global relevance score (score-based percentage)
            score_max_ref = 35.0  # ~ tag 15 + sector 6 + exp 7.5 + geo 3
            relevance_pct = min(100, round(total_score / score_max_ref * 100))
            # Piste 4: cap by prospect pertinence
            pertinence_cap = None
            if prospect_pertinence:
                pl = prospect_pertinence.lower()
                if "faible" in pl or "low" in pl:
                    pertinence_cap = 50
                elif "modérée" in pl or "moderee" in pl or "moderate" in pl:
                    pertinence_cap = 70
            if pertinence_cap is not None:
                pct = min(pct, pertinence_cap)
                relevance_pct = min(relevance_pct, pertinence_cap)
            scored.append({
                "id": c_dict["id"],
                "name": c_dict.get("name", ""),
                "role": c_dict.get("role", ""),
                "skills": skills,
                "tech": c_dict.get("tech", ""),
                "status": c_dict.get("status", ""),
                "linkedin": c_dict.get("linkedin", ""),
                "phone": c_dict.get("phone", ""),
                "years_experience": c_years,
                "location": c_dict.get("location", ""),
                "score": round(total_score, 1),
                "tag_score": tag_score,
                "sector_score": sector_score,
                "exp_score": round(exp_score, 1),
                "geo_score": geo_score,
                "pct": pct,
                "relevance_pct": relevance_pct,
                "matched_tags": list(set(matched_tags)),
                "semantic_matches": semantic_matches,  # Phase 1: matches sémantiques
            })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[:8]
    
    # Phase 1: Génération d'explications IA pour chaque match
    use_ai_explanations = request.args.get("ai_explanations") == "1"
    if use_ai_explanations and top:
        try:
            p_dict = _row_to_dict(p_row)
            prospect_name = (p_dict.get("name") or "").strip() if p_dict else ""
            prospect_fonction = (p_dict.get("fonction") or "").strip() if p_dict else ""
            prospect_ctx = f"Prospect: {prospect_name}, entreprise {company_groupe}, fonction: {prospect_fonction}, tags: {prospect_tags_effective}"
            
            for candidate in top:
                matched_tags_str = ", ".join(candidate.get("matched_tags", [])[:10])
                semantic_str = ", ".join(candidate.get("semantic_matches", []))
                candidate_ctx = f"Candidat: {candidate.get('name')}, rôle: {candidate.get('role')}, compétences: {', '.join(candidate.get('skills', [])[:10])}, expérience: {candidate.get('years_experience', 'N/A')} ans"
                
                explanation_prompt = f"""Tu es un assistant de matching prospect/candidat. Explique en 2-3 phrases pourquoi ce candidat correspond bien à ce prospect.

{prospect_ctx}

{candidate_ctx}

Matches exacts: {matched_tags_str}
Matches sémantiques: {semantic_str if semantic_str else 'Aucun'}

Réponds UNIQUEMENT par une explication courte (2-3 phrases), sans formules de politesse, en expliquant les points forts du match."""
                
                try:
                    explanation = _call_ai(explanation_prompt, timeout=10)
                    candidate["ai_explanation"] = explanation.strip()
                except Exception:
                    candidate["ai_explanation"] = None
        except Exception as e:
            logger.warning("Erreur génération explications IA: %s", str(e))
    
    # Réordonnancement intelligent avec Ollama (existant, amélioré)
    use_ollama = request.args.get("use_ollama") == "1"
    if use_ollama and top:
        try:
            p_dict = _row_to_dict(p_row) if not isinstance(p_row, dict) else p_row
            prospect_name = (p_dict.get("name") or "").strip() if p_dict else ""
            prospect_ctx = f"Prospect: {prospect_name}, entreprise {company_groupe}, tags: {prospect_tags}"
            cand_lines = "\n".join(f"- {c.get('name') or '?'}: {', '.join((c.get('matched_tags') or [])[:8])}" for c in top)
            prompt = f"Contexte: {prospect_ctx}\n\nCandidats (nom + compétences matchées):\n{cand_lines}\n\nRéponds UNIQUEMENT par les noms des candidats, un par ligne, du meilleur au moins bon match. Pas d'autre texte."
            text = _call_ai(prompt, timeout=15)
            if text:
                order_names = [n.strip() for n in text.split("\n") if n.strip()]
                by_name = {c.get("name"): c for c in top}
                reordered = [by_name[n] for n in order_names if n in by_name]
                for c in top:
                    if c not in reordered:
                        reordered.append(c)
                top = reordered
        except Exception:
            pass
    
    return jsonify(ok=True, candidates=top, prospect_tags=prospect_tags)


# ====== Global search API ======
@app.get("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip()
    try:
        limit = int(request.args.get("limit") or "50")
        limit = max(1, min(200, limit))
    except Exception:
        limit = 50
    # v23.5: pagination offset support
    try:
        offset = max(0, int(request.args.get("offset") or "0"))
    except Exception:
        offset = 0

    if not q:
        return jsonify({"prospects": [], "companies": [], "pushLogs": [], "candidates": [], "counts": {"prospects":0,"companies":0,"pushLogs":0,"candidates":0}, "limit": limit})

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    like = f"%{q}%"
    with _conn() as conn:
        prospects = [
            dict(r)
            for r in conn.execute(
                '''
                SELECT p.*, c.groupe AS company_groupe, c.site AS company_site
                FROM prospects p
                LEFT JOIN companies c ON c.id = p.company_id
                WHERE p.owner_id=? AND p.deleted_at IS NULL AND (
                    p.name LIKE ? OR p.email LIKE ? OR p.telephone LIKE ?
                    OR p.linkedin LIKE ? OR p.fonction LIKE ? OR p.notes LIKE ?
                    OR p.callNotes LIKE ? OR p.tags LIKE ?
                    OR c.groupe LIKE ? OR c.site LIKE ?
                )
                ORDER BY p.id DESC
                LIMIT ? OFFSET ?;
                ''',
                (uid, like, like, like, like, like, like, like, like, like, like, limit, offset),
            ).fetchall()
        ]
        companies = [
            dict(r)
            for r in conn.execute(
                '''
                SELECT * FROM companies
                WHERE owner_id=? AND deleted_at IS NULL AND (groupe LIKE ? OR site LIKE ? OR phone LIKE ? OR notes LIKE ? OR tags LIKE ? OR website LIKE ? OR industry LIKE ? OR stack LIKE ? OR pain_points LIKE ?)
                ORDER BY id DESC
                LIMIT ? OFFSET ?;
                ''',
                (uid, like, like, like, like, like, like, like, like, like, limit, offset),
            ).fetchall()
        ]
        push_logs = [
            dict(r)
            for r in conn.execute(
                '''
                SELECT l.*, p.name AS prospect_name, p.email AS prospect_email, c.groupe AS company_groupe, c.site AS company_site
                FROM push_logs l
                JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=?
                LEFT JOIN companies c ON c.id = p.company_id
                WHERE l.to_email LIKE ? OR l.subject LIKE ? OR l.body LIKE ? OR p.name LIKE ? OR p.email LIKE ? OR c.groupe LIKE ? OR c.site LIKE ?
                ORDER BY l.id DESC
                LIMIT ? OFFSET ?;
                ''',
                (uid, like, like, like, like, like, like, like, limit, offset),
            ).fetchall()
        ]
        candidates = [
            dict(r)
            for r in conn.execute(
                '''
                SELECT * FROM candidates
                WHERE owner_id=? AND deleted_at IS NULL AND (name LIKE ? OR role LIKE ? OR location LIKE ? OR tech LIKE ? OR linkedin LIKE ? OR notes LIKE ?)
                ORDER BY COALESCE(updatedAt, createdAt) DESC, id DESC
                LIMIT ? OFFSET ?;
                ''',
                (uid, like, like, like, like, like, like, limit, offset),
            ).fetchall()
        ]

    out = {
        "prospects": prospects,
        "companies": companies,
        # camelCase for front v5+ (page-search.js)
        "pushLogs": push_logs,
        "candidates": candidates,
        "counts": {
            "prospects": len(prospects),
            "companies": len(companies),
            "pushLogs": len(push_logs),
            "candidates": len(candidates),
        },
        "limit": limit,
        "offset": offset,
        # legacy key for backward compatibility
        "push_logs": push_logs,
    }
    return jsonify(out)


# ====== Timeline API ====== ======
@app.get("/api/prospect/timeline")
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
                                  thumbnail, meeting_id, createdAt
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
        events.append(
            {
                "type": "attachment",
                "date": a.get("createdAt") or "",
                "title": a.get("original_name") or "Fichier",
                "content": a.get("description") or "",
                "source": "attachment",
                "id": a.get("id"),
                "meta": {
                    "original_name": a.get("original_name") or "",
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


@app.post("/api/prospect/log-call")
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


@app.post("/api/prospect/log-stage")
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


@app.post("/api/prospect/events/add")
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


@app.post("/api/prospect/timeline/update")
def api_prospect_timeline_update():
    """Modifie le contenu d'un item de timeline (prospect_events ou callNotes JSON)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    pid = payload.get("prospect_id")
    source = (payload.get("source") or "").strip()
    new_content = (payload.get("content") or "").strip()
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


@app.post("/api/prospect/timeline/delete")
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


@app.get("/api/dashboard/pipeline-stages")
def api_dashboard_pipeline_stages():
    """Retourne la distribution des prospects par étape de pipeline (frise chronologique)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        # Prospects de l'utilisateur non supprimés/archivés
        all_prospects = conn.execute(
            """SELECT id, name, statut, rdvDate, lastContact, nextFollowUp, company_id
               FROM prospects
               WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') AND (is_archived=0 OR is_archived IS NULL)
               ORDER BY id;""",
            (uid,),
        ).fetchall()

        # Prospects ayant au moins 1 réunion enregistrée
        meeting_pids = set(
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT prospect_id FROM meetings WHERE owner_id=?;", (uid,)
            ).fetchall()
        )

        # Prospects avec event 'reunion_tech'
        rt_pids = set(
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT prospect_id FROM prospect_events WHERE type='reunion_tech' AND prospect_id IN (SELECT id FROM prospects WHERE owner_id=?);",
                (uid,),
            ).fetchall()
        )

        # Prospects avec event 'contrat_signe'
        contrat_pids = set(
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT prospect_id FROM prospect_events WHERE type='contrat_signe' AND prospect_id IN (SELECT id FROM prospects WHERE owner_id=?);",
                (uid,),
            ).fetchall()
        )

        # Map company_id → name
        company_names = {
            r[0]: r[1]
            for r in conn.execute(
                "SELECT id, groupe FROM companies WHERE owner_id=?;", (uid,)
            ).fetchall()
        }

        # Classement des prospects par stage
        stage_counts = {"appel": 0, "rdv": 0, "besoin": 0, "reunion_tech": 0, "contrat": 0}
        stage_prospects = {"appel": [], "rdv": [], "besoin": [], "reunion_tech": [], "contrat": []}

        RDV_STATUTS = {"Rendez-vous", "Prospecté"}

        for p in all_prospects:
            pid = p["id"]
            # Dériver l'étape la plus avancée
            if pid in contrat_pids:
                stage = "contrat"
            elif pid in rt_pids:
                stage = "reunion_tech"
            elif pid in meeting_pids:
                stage = "besoin"
            elif p["statut"] in RDV_STATUTS or (p["rdvDate"] and str(p["rdvDate"]).strip()):
                stage = "rdv"
            else:
                stage = "appel"

            stage_counts[stage] += 1
            stage_prospects[stage].append({
                "id": pid,
                "name": p["name"],
                "company": company_names.get(p["company_id"], ""),
                "statut": p["statut"],
                "lastContact": p["lastContact"] or "",
                "nextFollowUp": p["nextFollowUp"] or "",
                "stage": stage,
            })

        # Top prospects à pousser: stages besoin + reunion_tech, triés par lastContact (les plus anciens)
        priority = sorted(
            stage_prospects["besoin"] + stage_prospects["reunion_tech"],
            key=lambda x: (x["lastContact"] or "0"),
        )[:8]

    return jsonify(
        ok=True,
        stages=stage_counts,
        total=len(all_prospects),
        priority_prospects=priority,
    )


@app.get("/api/candidate/timeline")
def api_candidate_timeline():
    """Timeline des événements d'un candidat (candidate_events)."""
    cid = request.args.get("id")
    if not cid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    with _conn() as conn:
        row = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "candidat not found"}), 404
        extra = [
            dict(r)
            for r in conn.execute(
                "SELECT date, type, title, content, meta, createdAt FROM candidate_events WHERE candidate_id=? ORDER BY date DESC, id DESC LIMIT 80;",
                (int(cid),),
            ).fetchall()
        ]
    events = []
    for e in extra:
        meta = None
        try:
            meta = json.loads(e.get("meta") or "null")
        except Exception:
            meta = None
        events.append({
            "type": e.get("type") or "event",
            "date": e.get("date") or e.get("createdAt") or "",
            "title": e.get("title") or "",
            "content": e.get("content") or "",
            "meta": meta,
        })
    def _key(ev):
        return str(ev.get("date") or "")
    events = sorted(events, key=_key, reverse=True)[:120]
    return jsonify({"ok": True, "events": events})


@app.post("/api/candidate/events/add")
def api_candidate_events_add():
    """Ajoute un événement manuel à la timeline d'un candidat."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    cid = payload.get("candidate_id")
    if not cid:
        return jsonify(ok=False, error="candidate_id requis"), 400
    try:
        cid_i = int(cid)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="candidate_id invalide"), 400
    if not _candidate_owned(cid_i):
        return jsonify(ok=False, error="Accès refusé"), 403
    title = (payload.get("title") or "").strip() or "Événement"
    content = (payload.get("content") or "").strip()
    etype = (payload.get("type") or "event").strip()
    date = (payload.get("date") or datetime.datetime.now().isoformat(timespec="seconds")).strip()
    if len(date) > 19:
        date = date[:19]
    now = datetime.datetime.now().isoformat(timespec="seconds")
    meta = payload.get("meta")
    meta_json = json.dumps(meta, ensure_ascii=False) if meta is not None else None
    with _conn() as conn:
        conn.execute(
            "INSERT INTO candidate_events (candidate_id, date, type, title, content, meta, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?);",
            (cid_i, date, etype, title, content, meta_json, now),
        )
    return jsonify(ok=True)


# ====== Stats API ======
@app.get("/api/stats")
def api_stats():
    # Range modes:
    # - /api/stats?days=30
    # - /api/stats?range=all
    # - /api/stats?start=YYYY-MM-DD&end=YYYY-MM-DD  (inclusive)
    today = datetime.date.today()

    def _parse_iso_date(s: str):
        try:
            return datetime.date.fromisoformat((s or "").strip())
        except Exception:
            return None

    mode = "days"
    start_d = None
    end_d = None

    if (request.args.get("range") or "").strip().lower() == "all":
        mode = "all"
    else:
        start_q = request.args.get("start")
        end_q = request.args.get("end")
        if start_q and end_q:
            s = _parse_iso_date(start_q)
            e = _parse_iso_date(end_q)
            if s and e:
                mode = "custom"
                start_d, end_d = (s, e) if s <= e else (e, s)
        if start_d is None or end_d is None:
            days = request.args.get("days") or "30"
            try:
                days_i = max(1, min(365, int(days)))
            except Exception:
                days_i = 30
            mode = "days"
            end_d = today
            start_d = today - datetime.timedelta(days=days_i - 1)

    start_iso = start_d.isoformat() if start_d else ""
    end_iso = end_d.isoformat() if end_d else ""
    today_iso = _today_iso()
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        # BUG 27 : total = actifs (non supprimés, non archivés) pour cohérence avec /v30/prospects
        total_prospects = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='') "
            "AND (is_archived IS NULL OR is_archived=0);",
            (uid,),
        ).fetchone()["n"]
        total_companies = conn.execute(
            "SELECT COUNT(*) AS n FROM companies WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');",
            (uid,),
        ).fetchone()["n"]

        # status counts (all time) — prospects de l'utilisateur uniquement
        rdv_total = conn.execute("SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND statut='Rendez-vous';", (uid,)).fetchone()["n"]
        recall_total = conn.execute("SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND statut='À rappeler';", (uid,)).fetchone()["n"]

        # followups (always relative to today)
        late = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND nextFollowUp IS NOT NULL AND nextFollowUp != '' AND nextFollowUp < ?;",
            (uid, today_iso),
        ).fetchone()["n"]
        due_today = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND nextFollowUp = ?;",
            (uid, today_iso),
        ).fetchone()["n"]

        # activity (in selected range) — push_logs des prospects de l'utilisateur uniquement
        if mode == "all":
            pushes = conn.execute(
                "SELECT COUNT(*) AS n FROM push_logs l JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=?;",
                (uid,),
            ).fetchone()["n"]
        else:
            pushes = conn.execute(
                "SELECT COUNT(*) AS n FROM push_logs l JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=? WHERE substr(l.sentAt,1,10) >= ? AND substr(l.sentAt,1,10) <= ?;",
                (uid, start_iso, end_iso),
            ).fetchone()["n"]

        call_rows = conn.execute(
            "SELECT callNotes FROM prospects WHERE owner_id=? AND callNotes IS NOT NULL AND callNotes != '' AND (deleted_at IS NULL OR deleted_at = '');",
            (uid,),
        ).fetchall()
        call_notes = 0
        for r in call_rows:
            try:
                notes = json.loads(r["callNotes"] or "[]")
                if isinstance(notes, list):
                    for n in notes:
                        d = (n.get("date") if isinstance(n, dict) else "") or ""
                        d = d[:10]
                        if not d:
                            continue
                        if mode == "all":
                            call_notes += 1
                        else:
                            if start_iso <= d <= end_iso:
                                call_notes += 1
            except Exception:
                continue

        # Notes stockées dans prospect_events (mpAddNote, prospect_detail "+ Note", etc.)
        try:
            if mode == "all":
                call_notes += conn.execute(
                    """SELECT COUNT(*) AS n FROM prospect_events e
                       JOIN prospects p ON p.id=e.prospect_id
                       WHERE p.owner_id=? AND e.type IN ('note','note_libre','call_note')
                         AND (p.deleted_at IS NULL OR p.deleted_at='');""",
                    (uid,),
                ).fetchone()["n"]
            else:
                call_notes += conn.execute(
                    """SELECT COUNT(*) AS n FROM prospect_events e
                       JOIN prospects p ON p.id=e.prospect_id
                       WHERE p.owner_id=? AND e.type IN ('note','note_libre','call_note')
                         AND substr(e.date,1,10) >= ? AND substr(e.date,1,10) <= ?
                         AND (p.deleted_at IS NULL OR p.deleted_at='');""",
                    (uid, start_iso, end_iso),
                ).fetchone()["n"]
        except Exception:
            pass

        # Appels tracés (call_logs — clics bouton Appeler)
        try:
            if mode == "all":
                calls_count = conn.execute(
                    "SELECT COUNT(*) AS n FROM call_logs WHERE owner_id=?;", (uid,)
                ).fetchone()["n"]
            else:
                calls_count = conn.execute(
                    "SELECT COUNT(*) AS n FROM call_logs WHERE owner_id=? AND date>=? AND date<=?;",
                    (uid, start_iso, end_iso),
                ).fetchone()["n"]
        except Exception:
            calls_count = 0

        # Hot companies scoring (range for pushes, but late followups are always "today")
        hot = []
        if mode == "all":
            push_range_cond = "1=1"
            push_params = ()
        else:
            # Same robustness for hot companies scoring
            push_range_cond = "substr(l.sentAt,1,10) >= ? AND substr(l.sentAt,1,10) <= ?"
            push_params = (start_iso, end_iso)

        rows = conn.execute(
            f'''
            SELECT c.id, c.groupe, c.site,
                   COUNT(p.id) AS prospect_count,
                   SUM(CASE WHEN p.statut='Rendez-vous' THEN 1 ELSE 0 END) AS rdv_count,
                   SUM(CASE WHEN p.nextFollowUp IS NOT NULL AND p.nextFollowUp != '' AND p.nextFollowUp < ? THEN 1 ELSE 0 END) AS overdue_count,
                   (
                     SELECT COUNT(*)
                     FROM push_logs l
                     JOIN prospects p2 ON p2.id=l.prospect_id AND p2.owner_id=?
                     WHERE p2.company_id=c.id AND {push_range_cond}
                   ) AS pushes_recent
            FROM companies c
            LEFT JOIN prospects p ON p.company_id=c.id AND p.owner_id=? AND (p.deleted_at IS NULL OR p.deleted_at='')
            WHERE c.owner_id=? AND (c.deleted_at IS NULL OR c.deleted_at='')
            GROUP BY c.id
            ORDER BY (rdv_count*5 + overdue_count*3 + pushes_recent*2) DESC
            LIMIT 10;
            ''',
            (today_iso, uid, *push_params, uid, uid),
        ).fetchall()
        for r in rows:
            score = int((r["rdv_count"] or 0) * 5 + (r["overdue_count"] or 0) * 3 + (r["pushes_recent"] or 0) * 2)
            hot.append(
                {
                    "company_id": r["id"],
                    "groupe": r["groupe"],
                    "site": r["site"],
                    "score": score,
                    "prospectCount": r["prospect_count"] or 0,
                    "rdvCount": r["rdv_count"] or 0,
                    "lateFollowups": r["overdue_count"] or 0,
                }
            )

    payload = {
        "ok": True,
        "range": {"mode": mode, "from": start_iso if mode != "all" else "", "to": end_iso if mode != "all" else ""},
        "totals": {"prospects": total_prospects, "companies": total_companies},
        "activity": {"pushes": pushes, "callNotes": call_notes, "calls": calls_count},
        "followups": {"late": late, "dueToday": due_today},
        "statusCounts": {"Rendezvous": rdv_total, "A_rappeler": recall_total},
        "hotCompanies": hot,
        # legacy fields (compat)
        "total_prospects": total_prospects,
        "rdv": rdv_total,
        "pushes": pushes,
        "calls": call_notes,
        "overdue": late,
        "hot_companies": hot,
    }
    return jsonify(payload)


@app.post("/api/stats/insights")
def api_stats_insights():
    """Génère des insights IA à partir des statistiques actuelles et historiques."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    # Récupérer les paramètres de période (même logique que /api/stats)
    today = datetime.date.today()
    
    def _parse_iso_date(s: str):
        try:
            return datetime.date.fromisoformat((s or "").strip())
        except Exception:
            return None
    
    req_data = request.json if request.is_json else request.form
    mode = req_data.get("mode", "days")
    start_d = None
    end_d = None
    
    if mode == "all":
        start_d = None
        end_d = today
        prev_start_d = None
        prev_end_d = None
    elif mode == "custom":
        start_q = req_data.get("start")
        end_q = req_data.get("end")
        if start_q and end_q:
            s = _parse_iso_date(start_q)
            e = _parse_iso_date(end_q)
            if s and e:
                start_d, end_d = (s, e) if s <= e else (e, s)
        if start_d is None or end_d is None:
            # Fallback sur 30 jours
            end_d = today
            start_d = today - datetime.timedelta(days=29)
    else:
        # mode == "days"
        days = req_data.get("days", 30)
        try:
            days_i = max(1, min(365, int(days)))
        except Exception:
            days_i = 30
        end_d = today
        start_d = today - datetime.timedelta(days=days_i - 1)
    
    # Période précédente pour comparaison (si pas "all")
    if mode != "all" and start_d and end_d:
        period_days = (end_d - start_d).days + 1
        prev_end_d = start_d - datetime.timedelta(days=1)
        prev_start_d = prev_end_d - datetime.timedelta(days=period_days - 1)
    else:
        prev_start_d = None
        prev_end_d = None
    
    start_iso = start_d.isoformat() if start_d else ""
    end_iso = end_d.isoformat() if end_d else ""
    prev_start_iso = prev_start_d.isoformat() if prev_start_d else ""
    prev_end_iso = prev_end_d.isoformat() if prev_end_d else ""
    today_iso = _today_iso()

    with _conn() as conn:
        # Stats actuelles
        current_stats = {
            "totals": {
                "prospects": conn.execute("SELECT COUNT(*) AS n FROM prospects WHERE owner_id=?;", (uid,)).fetchone()["n"],
                "companies": conn.execute("SELECT COUNT(*) AS n FROM companies WHERE owner_id=?;", (uid,)).fetchone()["n"],
            },
            "activity": {},
            "followups": {},
            "statusCounts": {},
            "hotCompanies": [],
        }
        
        # Activity (période actuelle)
        if mode == "all":
            current_stats["activity"]["pushes"] = conn.execute(
                "SELECT COUNT(*) AS n FROM push_logs l JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=?;",
                (uid,),
            ).fetchone()["n"]
        else:
            current_stats["activity"]["pushes"] = conn.execute(
                "SELECT COUNT(*) AS n FROM push_logs l JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=? WHERE substr(l.sentAt,1,10) >= ? AND substr(l.sentAt,1,10) <= ?;",
                (uid, start_iso, end_iso),
            ).fetchone()["n"]
        
        # Call notes (période actuelle) — callNotes JSON + prospect_events de type note
        call_rows = conn.execute(
            "SELECT callNotes FROM prospects WHERE owner_id=? AND callNotes IS NOT NULL AND callNotes != '' AND (deleted_at IS NULL OR deleted_at = '');",
            (uid,),
        ).fetchall()
        call_notes = 0
        for r in call_rows:
            try:
                notes = json.loads(r["callNotes"] or "[]")
                if isinstance(notes, list):
                    for n in notes:
                        d = (n.get("date") if isinstance(n, dict) else "") or ""
                        d = d[:10]
                        if not d:
                            continue
                        if mode == "all":
                            call_notes += 1
                        else:
                            if start_iso <= d <= end_iso:
                                call_notes += 1
            except Exception:
                continue
        try:
            event_note_rows = conn.execute(
                """SELECT substr(e.date,1,10) AS d FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id
                   WHERE p.owner_id=? AND e.type IN ('note','note_libre','call_note')
                     AND (p.deleted_at IS NULL OR p.deleted_at='');""",
                (uid,),
            ).fetchall()
        except Exception:
            event_note_rows = []
        for r in event_note_rows:
            d = r["d"] or ""
            if not d:
                continue
            if mode == "all" or (start_iso <= d <= end_iso):
                call_notes += 1
        current_stats["activity"]["callNotes"] = call_notes
        
        # Followups
        current_stats["followups"]["late"] = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND nextFollowUp IS NOT NULL AND nextFollowUp != '' AND nextFollowUp < ?;",
            (uid, today_iso),
        ).fetchone()["n"]
        current_stats["followups"]["dueToday"] = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND nextFollowUp = ?;",
            (uid, today_iso),
        ).fetchone()["n"]
        
        # Status counts
        current_stats["statusCounts"]["Rendezvous"] = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND statut='Rendez-vous';", (uid,)
        ).fetchone()["n"]
        current_stats["statusCounts"]["A_rappeler"] = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND statut='À rappeler';", (uid,)
        ).fetchone()["n"]
        
        # Hot companies (top 5)
        hot_rows = conn.execute(
            '''
            SELECT c.id, c.groupe, c.site,
                   COUNT(p.id) AS prospect_count,
                   SUM(CASE WHEN p.statut='Rendez-vous' THEN 1 ELSE 0 END) AS rdv_count,
                   SUM(CASE WHEN p.nextFollowUp IS NOT NULL AND p.nextFollowUp != '' AND p.nextFollowUp < ? THEN 1 ELSE 0 END) AS overdue_count
            FROM companies c
            LEFT JOIN prospects p ON p.company_id=c.id AND p.owner_id=?
            WHERE c.owner_id=?
            GROUP BY c.id
            ORDER BY (rdv_count*5 + overdue_count*3) DESC
            LIMIT 5;
            ''',
            (today_iso, uid, uid),
        ).fetchall()
        current_stats["hotCompanies"] = [
            {
                "groupe": r["groupe"],
                "site": r["site"],
                "prospectCount": r["prospect_count"] or 0,
                "rdvCount": r["rdv_count"] or 0,
                "lateFollowups": r["overdue_count"] or 0,
            }
            for r in hot_rows
        ]
        
        # Stats période précédente (pour comparaison)
        prev_stats = {}
        if prev_start_d and prev_end_d:
            prev_stats["activity"] = {}
            if mode != "all":
                prev_stats["activity"]["pushes"] = conn.execute(
                    "SELECT COUNT(*) AS n FROM push_logs l JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=? WHERE substr(l.sentAt,1,10) >= ? AND substr(l.sentAt,1,10) <= ?;",
                    (uid, prev_start_iso, prev_end_iso),
                ).fetchone()["n"]
                
                prev_call_notes = 0
                for r in call_rows:
                    try:
                        notes = json.loads(r["callNotes"] or "[]")
                        if isinstance(notes, list):
                            for n in notes:
                                d = (n.get("date") if isinstance(n, dict) else "") or ""
                                d = d[:10]
                                if prev_start_iso <= d <= prev_end_iso:
                                    prev_call_notes += 1
                    except Exception:
                        continue
                for r in event_note_rows:
                    d = r["d"] or ""
                    if d and prev_start_iso <= d <= prev_end_iso:
                        prev_call_notes += 1
                prev_stats["activity"]["callNotes"] = prev_call_notes
                
                prev_stats["statusCounts"] = {}
                prev_stats["statusCounts"]["Rendezvous"] = conn.execute(
                    "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND statut='Rendez-vous' AND lastContact >= ? AND lastContact <= ?;",
                    (uid, prev_start_iso, prev_end_iso),
                ).fetchone()["n"]
        
        # Calcul du taux de conversion
        conversion_rate = 0
        if current_stats["totals"]["prospects"] > 0:
            conversion_rate = round((current_stats["statusCounts"]["Rendezvous"] / current_stats["totals"]["prospects"]) * 100, 1)
        
        # Construction du prompt pour Ollama
        prompt = f"""Tu es un analyste expert en prospection B2B. Analyse les statistiques suivantes et génère des insights structurés en JSON.

STATISTIQUES ACTUELLES (période: {start_iso} → {end_iso if end_iso else 'all time'}):
- Total prospects: {current_stats["totals"]["prospects"]}
- Total entreprises: {current_stats["totals"]["companies"]}
- Push envoyés: {current_stats["activity"]["pushes"]}
- Notes d'appel: {current_stats["activity"]["callNotes"]}
- Relances en retard: {current_stats["followups"]["late"]}
- Relances aujourd'hui: {current_stats["followups"]["dueToday"]}
- Prospects en RDV: {current_stats["statusCounts"]["Rendezvous"]}
- Prospects à rappeler: {current_stats["statusCounts"]["A_rappeler"]}
- Taux de conversion (RDV/Total): {conversion_rate}%
- Top entreprises chaudes: {json.dumps(current_stats["hotCompanies"], ensure_ascii=False)}"""

        if prev_stats:
            prompt += f"""

STATISTIQUES PÉRIODE PRÉCÉDENTE (période: {prev_start_iso} → {prev_end_iso}):
- Push envoyés: {prev_stats.get("activity", {}).get("pushes", 0)}
- Notes d'appel: {prev_stats.get("activity", {}).get("callNotes", 0)}
- Prospects en RDV: {prev_stats.get("statusCounts", {}).get("Rendezvous", 0)}"""

        prompt += """

ANALYSE À EFFECTUER:
1. Résumé automatique: Décris l'évolution du pipeline en 2-3 phrases (augmentation/diminution, points forts).
2. Points d'attention: Liste 2-4 alertes concrètes (ex: "3 prospects n'ont pas été contactés depuis 30 jours", "Relances en retard à traiter").
3. Suggestions stratégiques: Propose 2-3 recommandations actionnables basées sur les données (ex: "Les prospects du secteur X convertissent mieux", "Augmenter la fréquence de relance").
4. Benchmarking: Compare avec la période précédente si disponible, sinon avec les meilleures pratiques.

RÉPONSE ATTENDUE (JSON strict, pas de markdown):
{
  "summary": "Résumé en 2-3 phrases",
  "alerts": ["Alerte 1", "Alerte 2"],
  "recommendations": ["Recommandation 1", "Recommandation 2"],
  "benchmarks": {"current": X, "best": Y, "period": "description"}
}

IMPORTANT: Réponds UNIQUEMENT avec le JSON, sans texte avant ou après."""

        try:
            # Appel à l'IA
            ai_response = _call_ai(prompt, timeout=120)
            
            # Nettoyage de la réponse (enlever markdown si présent)
            ai_response = ai_response.strip()
            if ai_response.startswith("```json"):
                ai_response = ai_response[7:]
            if ai_response.startswith("```"):
                ai_response = ai_response[3:]
            if ai_response.endswith("```"):
                ai_response = ai_response[:-3]
            ai_response = ai_response.strip()
            
            # Parse JSON
            insights = json.loads(ai_response)
            
            # Validation de la structure
            if not isinstance(insights, dict):
                raise ValueError("Réponse IA n'est pas un objet JSON")
            
            # Structure par défaut si champs manquants
            result = {
                "summary": insights.get("summary", "Analyse en cours..."),
                "alerts": insights.get("alerts", []),
                "recommendations": insights.get("recommendations", []),
                "benchmarks": insights.get("benchmarks", {}),
            }
            
            return jsonify({"ok": True, "insights": result})
            
        except json.JSONDecodeError as e:
            logger.error("Erreur parsing JSON insights IA: %s", e)
            logger.error("Réponse brute: %s", ai_response[:500])
            return jsonify({
                "ok": False,
                "error": "Erreur parsing réponse IA",
                "raw": ai_response[:500] if 'ai_response' in locals() else "",
            }), 500
        except Exception as e:
            logger.error("Erreur génération insights: %s", e)
            return jsonify({"ok": False, "error": str(e)}), 500


@app.get("/api/stats/predictions")
def api_stats_predictions():
    """Génère des prédictions IA basées sur les statistiques historiques (tendances futures, conversions prévues)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    today = datetime.date.today()
    today_iso = _today_iso()
    
    # Récupérer les statistiques historiques (12 dernières semaines)
    weeks_data = []
    with _conn() as conn:
        for i in range(12, 0, -1):
            week_end = today - datetime.timedelta(days=(i - 1) * 7)
            week_start = week_end - datetime.timedelta(days=6)
            week_start_iso = week_start.isoformat()
            week_end_iso = week_end.isoformat()
            
            # Compter les actions de cette semaine
            pushes = conn.execute(
                "SELECT COUNT(*) AS n FROM push_logs l JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=? WHERE substr(l.sentAt,1,10) >= ? AND substr(l.sentAt,1,10) <= ?;",
                (uid, week_start_iso, week_end_iso),
            ).fetchone()["n"]
            
            # Compter les notes d'appel
            call_notes_count = 0
            prospects_rows = conn.execute(
                "SELECT callNotes FROM prospects WHERE owner_id=? AND callNotes IS NOT NULL AND callNotes != '';",
                (uid,),
            ).fetchall()
            for r in prospects_rows:
                try:
                    notes = json.loads(r["callNotes"] or "[]")
                    if isinstance(notes, list):
                        for n in notes:
                            note_date = (n.get("date") or "")[:10]
                            if note_date >= week_start_iso and note_date <= week_end_iso:
                                call_notes_count += 1
                except Exception:
                    pass
            
            # Compter les RDV
            rdv_count = conn.execute(
                "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND rdvDate IS NOT NULL AND rdvDate != '' AND substr(rdvDate,1,10) >= ? AND substr(rdvDate,1,10) <= ?;",
                (uid, week_start_iso, week_end_iso),
            ).fetchone()["n"]
            
            weeks_data.append({
                "week": f"S{week_end.isocalendar()[1]}",
                "pushes": pushes,
                "call_notes": call_notes_count,
                "rdv": rdv_count,
            })
    
    # Récupérer les totaux actuels (BUG 27 : exclure aussi les archivés)
    with _conn() as conn:
        total_prospects = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND deleted_at IS NULL "
            "AND (is_archived IS NULL OR is_archived=0);",
            (uid,),
        ).fetchone()["n"]
        total_companies = conn.execute("SELECT COUNT(*) AS n FROM companies WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchone()["n"]
        rdv_prospects = conn.execute("SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND statut='Rendez-vous' AND deleted_at IS NULL;", (uid,)).fetchone()["n"]
        overdue_count = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND nextFollowUp IS NOT NULL AND nextFollowUp != '' AND nextFollowUp < ? AND deleted_at IS NULL;",
            (uid, today_iso),
        ).fetchone()["n"]
    
    # Construire le prompt pour les prédictions
    prompt = f"""Tu es un assistant pour un CRM de prospection B2B. Analyse les données historiques et génère des prédictions pour les 4 prochaines semaines.

DONNÉES HISTORIQUES (12 dernières semaines):
{json.dumps(weeks_data, indent=2, ensure_ascii=False)}

SITUATION ACTUELLE:
- Total prospects: {total_prospects}
- Total entreprises: {total_companies}
- Prospects en RDV: {rdv_prospects}
- Relances en retard: {overdue_count}

PRÉDICTIONS À GÉNÉRER:
1. "trends": Tendances prévues pour les 4 prochaines semaines (pushes, notes, RDV)
2. "conversion_rate": Taux de conversion prévu (prospects → RDV)
3. "recommendations": 2-3 recommandations pour optimiser les résultats
4. "forecast": Prévisions chiffrées pour les 4 prochaines semaines

RÉPONSE ATTENDUE (JSON strict, pas de markdown):
{{
  "trends": {{
    "pushes": "tendance (augmentation/diminution/stabilité)",
    "call_notes": "tendance",
    "rdv": "tendance"
  }},
  "conversion_rate": {{
    "current": X,
    "predicted": Y,
    "explanation": "explication courte"
  }},
  "recommendations": ["Recommandation 1", "Recommandation 2"],
  "forecast": {{
    "week_1": {{"pushes": X, "call_notes": Y, "rdv": Z}},
    "week_2": {{"pushes": X, "call_notes": Y, "rdv": Z}},
    "week_3": {{"pushes": X, "call_notes": Y, "rdv": Z}},
    "week_4": {{"pushes": X, "call_notes": Y, "rdv": Z}}
  }}
}}

IMPORTANT: Réponds UNIQUEMENT avec le JSON, sans texte avant ou après."""
    
    try:
        # Appel à l'IA
        ai_response = _call_ai(prompt, timeout=120)
        
        # Nettoyage de la réponse (enlever markdown si présent)
        ai_response = ai_response.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:]
        if ai_response.startswith("```"):
            ai_response = ai_response[3:]
        if ai_response.endswith("```"):
            ai_response = ai_response[:-3]
        ai_response = ai_response.strip()
        
        # Parse JSON
        predictions = json.loads(ai_response)
        
        # Validation de la structure
        if not isinstance(predictions, dict):
            raise ValueError("Réponse IA n'est pas un objet JSON")
        
        # Structure par défaut si champs manquants
        result = {
            "trends": predictions.get("trends", {}),
            "conversion_rate": predictions.get("conversion_rate", {}),
            "recommendations": predictions.get("recommendations", []),
            "forecast": predictions.get("forecast", {}),
        }
        
        return jsonify({"ok": True, "predictions": result})
        
    except json.JSONDecodeError as e:
        logger.error("Erreur parsing JSON predictions IA: %s", e)
        logger.error("Réponse brute: %s", ai_response[:500] if 'ai_response' in locals() else "")
        return jsonify({
            "ok": False,
            "error": "Erreur parsing réponse IA",
            "raw": ai_response[:500] if 'ai_response' in locals() else "",
        }), 500
    except Exception as e:
        logger.error("Erreur génération predictions: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


# ====== Prospect Photo Upload ======
import uuid as _uuid

PHOTOS_DIR = DATA_DIR / "photos"
os.makedirs(PHOTOS_DIR, exist_ok=True)

AVATARS_DIR = DATA_DIR / "avatars"
os.makedirs(AVATARS_DIR, exist_ok=True)

# Migration: déplacer les photos existantes de static/photos/ vers data/photos/
_old_photos_dir = APP_DIR / "static" / "photos"
if _old_photos_dir.exists():
    for _f in _old_photos_dir.iterdir():
        if _f.is_file():
            _dest = PHOTOS_DIR / _f.name
            if not _dest.exists():
                _f.rename(_dest)
    try:
        _old_photos_dir.rmdir()
    except OSError:
        pass

# ====== Utilitaires validation et sécurité pour routes push ======
def _validate_positive_int(value: Any, param_name: str = "id") -> int:
    """Valide qu'une valeur est un entier positif. Lève ValueError si invalide."""
    if value is None:
        raise ValueError(f"{param_name} est requis")
    try:
        int_val = int(value)
        if int_val <= 0:
            raise ValueError(f"{param_name} doit être un entier positif")
        return int_val
    except (ValueError, TypeError) as e:
        if isinstance(e, ValueError) and "doit être" in str(e):
            raise
        raise ValueError(f"{param_name} doit être un entier valide") from e

def _validate_optional_positive_int(value: Any, param_name: str = "id") -> int | None:
    """Valide qu'une valeur est None ou un entier positif. Retourne None ou l'entier."""
    if value is None or value == "" or value == "null":
        return None
    try:
        int_val = int(value)
        if int_val <= 0:
            return None
        return int_val
    except (ValueError, TypeError):
        return None

def _safe_row_to_dict(row: sqlite3.Row | None) -> Dict[str, Any] | None:
    """Convertit un sqlite3.Row en dict de manière sécurisée. Retourne None si row est None."""
    if row is None:
        return None
    try:
        return dict(row)
    except Exception:
        return None

def _safe_execute_insert(conn: sqlite3.Connection, query: str, params: tuple) -> int:
    """Exécute une insertion de manière sécurisée. Retourne lastrowid. Lève Exception en cas d'erreur."""
    try:
        cur = conn.cursor()
        cur.execute(query, params)
        return cur.lastrowid
    except sqlite3.OperationalError as e:
        logger.error("Erreur insertion DB: %s", e)
        raise
    except Exception as e:
        logger.error("Erreur inattendue insertion DB: %s", e)
        raise

def _safe_execute_update(conn: sqlite3.Connection, query: str, params: tuple) -> None:
    """Exécute une mise à jour de manière sécurisée. Lève Exception en cas d'erreur."""
    try:
        conn.execute(query, params)
    except sqlite3.OperationalError as e:
        logger.error("Erreur mise à jour DB: %s", e)
        raise
    except Exception as e:
        logger.error("Erreur inattendue mise à jour DB: %s", e)
        raise

def _check_table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    """Vérifie si une table existe dans la base de données. Sécurisé contre injection SQL."""
    # Validation stricte : nom de table doit contenir uniquement lettres, chiffres, underscores
    if not table_name or not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name):
        logger.warning("Nom de table invalide pour _check_table_exists: %s", table_name)
        return False
    try:
        # Utilisation de quote_identifier serait idéale mais sqlite3 ne le supporte pas nativement
        # On valide donc le nom et on l'utilise directement (sécurisé car validé)
        conn.execute(f"SELECT 1 FROM {table_name} LIMIT 1").fetchone()
        return True
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower():
            return False
        raise

@app.post("/api/prospect/photo")
def api_prospect_photo():
    """Upload a photo for a prospect. Saves to static/photos/ and updates DB."""
    pid = request.form.get("prospect_id")
    if not pid:
        return jsonify({"ok": False, "error": "prospect_id required"}), 400
    pid = int(pid)
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _prospect_owned(pid):
        return jsonify({"ok": False, "error": "Accès refusé"}), 403

    f = request.files.get("photo")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400

    ok_upload, err_upload = _validate_upload(f, "image")
    if not ok_upload:
        return jsonify(ok=False, error=err_upload[0]), err_upload[1]
    ext = os.path.splitext(f.filename)[1].lower()

    # Save with unique name
    fname = f"prospect_{pid}{ext}"
    fpath = os.path.join(PHOTOS_DIR, fname)
    try:
        f.save(fpath)
    except OSError as e:
        logger.error("Photo save failed for prospect %s: %s", pid, e)
        return jsonify({"ok": False, "error": "Erreur sauvegarde fichier"}), 500

    photo_url = f"/api/photos/prospect/{pid}"

    with _conn() as conn:
        conn.execute("UPDATE prospects SET photo_url = ? WHERE id = ? AND owner_id=?;", (photo_url, pid, uid))

    return jsonify({"ok": True, "photo_url": photo_url})

@app.get("/api/photos/prospect/<int:prospect_id>")
def api_prospect_photo_serve(prospect_id):
    """Serve a prospect photo with ownership check (authenticated route)."""
    if not _prospect_owned(prospect_id):
        return jsonify({"error": "Accès non autorisé"}), 403
    _mimetypes = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        fpath = os.path.join(PHOTOS_DIR, f"prospect_{prospect_id}{ext}")
        if os.path.isfile(fpath):
            return send_file(fpath, mimetype=_mimetypes[ext])
    return jsonify({"error": "Photo non trouvée"}), 404

@app.delete("/api/prospect/photo")
def api_prospect_photo_delete():
    """Remove a prospect's photo."""
    pid = request.args.get("prospect_id") or request.form.get("prospect_id")
    if not pid:
        return jsonify({"ok": False, "error": "prospect_id required"}), 400
    pid = int(pid)
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _prospect_owned(pid):
        return jsonify({"ok": False, "error": "Accès refusé"}), 403

    for _ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        _old_path = PHOTOS_DIR / f"prospect_{pid}{_ext}"
        if _old_path.is_file():
            _old_path.unlink()
            break
    with _conn() as conn:
        conn.execute("UPDATE prospects SET photo_url = NULL WHERE id = ? AND owner_id=?;", (pid, uid))

    return jsonify({"ok": True})


# ====== Stats Charts API ======
@app.get("/api/stats/charts")
def api_stats_charts():
    """Provide aggregated data for Chart.js graphs on the stats page."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    today = datetime.date.today()
    today_iso = _today_iso()

    with _conn() as conn:
        # 1) Status distribution — prospects de l'utilisateur uniquement (hors supprimés)
        status_rows = conn.execute(
            "SELECT statut, COUNT(*) AS n FROM prospects WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') GROUP BY statut ORDER BY n DESC;",
            (uid,),
        ).fetchall()
        status_dist = {r["statut"]: r["n"] for r in status_rows}

        # 2) Push + calls + callNotes per week (last 12 weeks)
        # Pre-load note dates (callNotes JSON + prospect_events type note) pour bucketing rapide
        _cn_dates = []
        for r in conn.execute(
            "SELECT callNotes FROM prospects WHERE owner_id=? AND callNotes IS NOT NULL AND callNotes!='' AND (deleted_at IS NULL OR deleted_at='');",
            (uid,),
        ).fetchall():
            try:
                for n in (json.loads(r["callNotes"] or "[]") or []):
                    ds = (n.get("date") or "")[:10]
                    if ds:
                        _cn_dates.append(ds)
            except Exception:
                pass
        try:
            for r in conn.execute(
                """SELECT e.date FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id
                   WHERE p.owner_id=? AND e.type IN ('note','note_libre','call_note')
                     AND (p.deleted_at IS NULL OR p.deleted_at='');""",
                (uid,),
            ).fetchall():
                ds = (r["date"] or "")[:10]
                if ds:
                    _cn_dates.append(ds)
        except Exception:
            pass

        weeks = []
        activity_weeks = []
        for i in range(11, -1, -1):
            d = today - datetime.timedelta(weeks=i)
            mon = d - datetime.timedelta(days=d.weekday())
            sun = mon + datetime.timedelta(days=6)
            mon_iso, sun_iso = mon.isoformat(), sun.isoformat()
            label = f"S{mon.isocalendar()[1]}"
            push_n = conn.execute(
                "SELECT COUNT(*) AS n FROM push_logs l JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=? WHERE substr(l.sentAt,1,10)>=? AND substr(l.sentAt,1,10)<=?;",
                (uid, mon_iso, sun_iso),
            ).fetchone()["n"]
            try:
                calls_n = conn.execute(
                    "SELECT COUNT(*) AS n FROM call_logs WHERE owner_id=? AND date>=? AND date<=?;",
                    (uid, mon_iso, sun_iso),
                ).fetchone()["n"]
            except Exception:
                calls_n = 0
            notes_n = sum(1 for ds in _cn_dates if mon_iso <= ds <= sun_iso)
            weeks.append({"label": label, "count": push_n})
            activity_weeks.append({"label": label, "calls": calls_n, "callNotes": notes_n, "push": push_n})

        # 3) RDV pris par mois (6 derniers mois) — source primaire : prospect_events rdv_taken
        #    fallback : lastContact des prospects RDV sans événement (rétro-compatibilité)
        months_rdv = []
        for i in range(5, -1, -1):
            first = (today.replace(day=1) - datetime.timedelta(days=i * 28)).replace(day=1)
            if first.month == 12:
                last = first.replace(year=first.year + 1, month=1, day=1) - datetime.timedelta(days=1)
            else:
                last = first.replace(month=first.month + 1, day=1) - datetime.timedelta(days=1)
            count = conn.execute(
                """SELECT COUNT(DISTINCT pid) AS n FROM (
                     SELECT e.prospect_id AS pid
                     FROM prospect_events e
                     JOIN prospects p ON p.id=e.prospect_id
                     WHERE p.owner_id=? AND e.type='rdv_taken'
                       AND substr(e.date,1,10)>=? AND substr(e.date,1,10)<=?
                       AND (p.deleted_at IS NULL OR p.deleted_at='')
                     UNION
                     SELECT p.id AS pid
                     FROM prospects p
                     WHERE p.owner_id=? AND p.statut='Rendez-vous'
                       AND (p.deleted_at IS NULL OR p.deleted_at='')
                       AND p.lastContact>=? AND p.lastContact<=?
                       AND NOT EXISTS (
                         SELECT 1 FROM prospect_events e2
                         WHERE e2.prospect_id=p.id AND e2.type='rdv_taken'
                       )
                   )""",
                (uid, first.isoformat(), last.isoformat(),
                 uid, first.isoformat(), last.isoformat()),
            ).fetchone()["n"]
            months_rdv.append({"label": first.strftime("%b %Y"), "count": count})

        # 4) Top 8 companies by prospect count (prospects de l'utilisateur)
        top_companies = conn.execute(
            """SELECT c.groupe || CASE WHEN c.site IS NOT NULL AND c.site != '' THEN ' (' || c.site || ')' ELSE '' END AS name,
                      COUNT(p.id) AS n
               FROM companies c JOIN prospects p ON p.company_id = c.id AND p.owner_id=?
               GROUP BY c.id ORDER BY n DESC LIMIT 8;""",
            (uid,),
        ).fetchall()
        top_comp = [{"name": r["name"], "count": r["n"]} for r in top_companies]

        # 5) Pertinence distribution
        pert_rows = conn.execute(
            "SELECT pertinence, COUNT(*) AS n FROM prospects WHERE owner_id=? GROUP BY pertinence ORDER BY pertinence DESC;",
            (uid,),
        ).fetchall()
        pert_dist = {str(r["pertinence"]): r["n"] for r in pert_rows}

        # 6) Top consultants pushés (tout l'historique, top 6) — agrège candidate_id1 + candidate_id2
        top_pushed_rows = conn.execute(
            """SELECT ca.id AS cid, ca.name AS cname, COUNT(*) AS n FROM (
                   SELECT l.candidate_id1 AS cid FROM push_logs l
                     JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=?
                     WHERE l.candidate_id1 IS NOT NULL
                   UNION ALL
                   SELECT l.candidate_id2 AS cid FROM push_logs l
                     JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=?
                     WHERE l.candidate_id2 IS NOT NULL
               ) pc
               JOIN candidates ca ON ca.id = pc.cid AND ca.owner_id=?
               GROUP BY ca.id, ca.name
               ORDER BY n DESC LIMIT 6;""",
            (uid, uid, uid),
        ).fetchall()
        top_pushed = [{"name": r["cname"] or f"Candidat {r['cid']}", "count": r["n"]} for r in top_pushed_rows]

        # 7) Urgence des prospects (répartition pour Priorités IA)
        urgent_overdue = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') AND nextAction IS NOT NULL AND nextAction!='' AND nextAction<?;",
            (uid, today_iso),
        ).fetchone()["n"]
        urgent_today = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') AND nextAction=?;",
            (uid, today_iso),
        ).fetchone()["n"]
        week_end = (today + datetime.timedelta(days=7)).isoformat()
        urgent_week = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') AND nextAction>? AND nextAction<=?;",
            (uid, today_iso, week_end),
        ).fetchone()["n"]
        urgent_later = conn.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='') AND nextAction>?;",
            (uid, week_end),
        ).fetchone()["n"]
        urgency_dist = [
            {"label": "En retard", "count": urgent_overdue},
            {"label": "Aujourd'hui", "count": urgent_today},
            {"label": "Cette semaine", "count": urgent_week},
            {"label": "Plus tard", "count": urgent_later},
        ]

    return jsonify({
        "ok": True,
        "statusDistribution": status_dist,
        "pushPerWeek": weeks,
        "activityPerWeek": activity_weeks,
        "rdvPerMonth": months_rdv,
        "topCompanies": top_comp,
        "pertinenceDistribution": pert_dist,
        "topPushedConsultants": top_pushed,
        "urgencyDistribution": urgency_dist,
    })


# ────────────────────────────────────────────────────────────────────
# Export Excel hebdomadaire – suivi activité (v22.1)
# ────────────────────────────────────────────────────────────────────

@app.get("/api/stats/export_weekly_xlsx")
def api_stats_export_weekly_xlsx():
    """Generate an XLSX file following the exact 'Suivi activité' template for a given ISO week.
    Query params:
      - week: ISO week like 2026-W10  (defaults to current week)
      - ollama: 1 to enable Ollama enrichment (normalize métiers, extract besoins, generate codes notes)
    Format: 15 columns (A-O), zipped rows (candidate + prospection + push on same row),
    thick border on column G, goals on first data row (M-N-O).
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter
    import io

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    # ── Parse week param ──
    week_param = request.args.get("week", "").strip()
    use_ollama = request.args.get("ollama", "").strip() == "1"
    today = datetime.date.today()

    if week_param:
        try:
            year, w = week_param.split("-W")
            year, w = int(year), int(w)
            jan4 = datetime.date(year, 1, 4)
            start_of_w1 = jan4 - datetime.timedelta(days=jan4.isoweekday() - 1)
            monday = start_of_w1 + datetime.timedelta(weeks=w - 1)
        except Exception:
            monday = today - datetime.timedelta(days=today.weekday())
    else:
        monday = today - datetime.timedelta(days=today.weekday())

    sunday = monday + datetime.timedelta(days=6)
    start = monday.isoformat()
    end = sunday.isoformat()
    week_num = monday.isocalendar()[1]
    week_label = f"S{week_num}"

    # ── Helper: Call AI if enabled ──
    def _call_ollama(prompt: str) -> str:
        if not use_ollama:
            return ""
        try:
            return _call_ai(prompt, timeout=OLLAMA_TIMEOUT)
        except Exception:
            return ""

    with _conn() as conn:
        # ── 1) Candidats EC2 (passage à EC2 dans la semaine) ──
        ec2_rows = conn.execute(
            """SELECT DISTINCT ca.id, ca.name, ca.role, ca.sector, ca.seniority, ca.years_experience, ca.status, ca.notes,
                      COALESCE(e.date, substr(ca.updatedAt, 1, 10)) AS ec2_date
               FROM candidates ca
               LEFT JOIN candidate_events e ON e.candidate_id = ca.id AND e.type = 'ec2' AND e.date >= ? AND e.date <= ?
               WHERE ca.owner_id = ? AND ca.status = 'ec2'
               AND (e.date IS NOT NULL OR (substr(ca.updatedAt, 1, 10) >= ? AND substr(ca.updatedAt, 1, 10) <= ?))
               ORDER BY COALESCE(e.date, ca.updatedAt);""",
            (start, end, uid, start, end),
        ).fetchall()
        ec2_list = [dict(r) for r in ec2_rows]

        # ── 2) Candidats EC1 (entretiens de la semaine) ──
        ec1_rows = conn.execute(
            """SELECT ca.id, ca.name, ca.role, ca.sector, ca.seniority, ca.years_experience, ca.status,
                      json_extract(t.payload, '$.interviewAt') AS interviewAt,
                      json_extract(t.payload, '$.data') AS ec1_data,
                      json_extract(t.payload, '$.availability') AS availability,
                      json_extract(t.payload, '$.notes') AS tab_notes
               FROM candidate_tabs t
               JOIN candidates ca ON ca.id = t.candidate_id AND ca.owner_id = ?
               WHERE t.type = 'ec1'
                 AND json_extract(t.payload, '$.interviewAt') IS NOT NULL
                 AND substr(json_extract(t.payload, '$.interviewAt'), 1, 10) >= ?
                 AND substr(json_extract(t.payload, '$.interviewAt'), 1, 10) <= ?
               ORDER BY json_extract(t.payload, '$.interviewAt');""",
            (uid, start, end),
        ).fetchall()
        ec1_list = [dict(r) for r in ec1_rows]

        # ── 3) Candidats Sourcing (ajoutés cette semaine, hors EC1/EC2) ──
        ec1_ec2_ids = {r["id"] for r in ec2_list} | {r["id"] for r in ec1_rows}
        sourcing_rows = conn.execute(
            """SELECT id, name, role, sector, seniority, years_experience, status, notes, createdAt
               FROM candidates
               WHERE owner_id = ?
                 AND substr(createdAt, 1, 10) >= ? AND substr(createdAt, 1, 10) <= ?
               ORDER BY createdAt;""",
            (uid, start, end),
        ).fetchall()
        sourcing_list = [dict(r) for r in sourcing_rows if r["id"] not in ec1_ec2_ids]

        # ── 4) Prospections (RDV pris) ──
        prosp_rdv_rows = conn.execute(
            """SELECT DISTINCT p.id, p.name AS prospect_name, COALESCE(c.groupe, '') AS company_name,
                      COALESCE(e.date, substr(p.lastContact, 1, 10)) AS rdv_date
               FROM prospects p
               LEFT JOIN companies c ON c.id = p.company_id
               LEFT JOIN prospect_events e ON e.prospect_id = p.id AND e.type = 'rdv_taken' AND e.date >= ? AND e.date <= ?
               WHERE p.owner_id = ? AND p.statut = 'Rendez-vous' AND (
                   (e.date IS NOT NULL) OR
                   (p.lastContact >= ? AND p.lastContact <= ?)
               )
               ORDER BY COALESCE(e.date, p.lastContact);""",
            (start, end, uid, start, end),
        ).fetchall()
        prosp_rdv_list = [dict(r) for r in prosp_rdv_rows]

        # ── 5) Clients vus (RDV effectué) ──
        clients_vus_rows = conn.execute(
            """SELECT DISTINCT p.id, p.name AS prospect_name, COALESCE(c.groupe, '') AS company_name,
                      p.notes, p.callNotes, p.lastContact,
                      COALESCE(e.date, substr(p.lastContact, 1, 10)) AS meeting_date
               FROM prospects p
               LEFT JOIN companies c ON c.id = p.company_id
               LEFT JOIN prospect_events e ON e.prospect_id = p.id
                   AND e.type IN ('meeting', 'reunion', 'rdv_done')
                   AND e.date >= ? AND e.date <= ?
               WHERE p.owner_id = ? AND p.statut = 'Rendez-vous' AND (
                   (e.date IS NOT NULL) OR
                   (p.lastContact >= ? AND p.lastContact <= ?)
               )
               ORDER BY COALESCE(e.date, p.lastContact);""",
            (start, end, uid, start, end),
        ).fetchall()
        clients_vus_list = [dict(r) for r in clients_vus_rows]

        # ── 6) Pushs (groupés par candidat, triés par nb desc) ──
        push_rows = conn.execute(
            """SELECT l.candidate_id1, l.candidate_id2, ca1.name AS candidate1_name, ca2.name AS candidate2_name,
                      l.sentAt
               FROM push_logs l
               JOIN prospects p ON p.id = l.prospect_id AND p.owner_id = ?
               LEFT JOIN candidates ca1 ON ca1.id = l.candidate_id1 AND ca1.owner_id = ?
               LEFT JOIN candidates ca2 ON ca2.id = l.candidate_id2 AND ca2.owner_id = ?
               WHERE substr(l.sentAt, 1, 10) >= ? AND substr(l.sentAt, 1, 10) <= ?
               ORDER BY l.sentAt;""",
            (uid, uid, uid, start, end),
        ).fetchall()
        push_list = [dict(r) for r in push_rows]
        push_by_candidate: dict = {}
        for pl in push_list:
            for cid_key, cname_key in [("candidate_id1", "candidate1_name"), ("candidate_id2", "candidate2_name")]:
                cid = pl.get(cid_key)
                if cid:
                    cname = pl.get(cname_key) or f"Candidat {cid}"
                    entry = push_by_candidate.setdefault(cid, {"name": cname, "count": 0})
                    entry["count"] += 1
        push_consultants = sorted(push_by_candidate.values(), key=lambda x: -x["count"])

        # ── 7) Objectifs ──
        goals_cfg = _get_goals_config(conn)
        weekly_goals = goals_cfg.get("weekly", {})
        attendus_prosp = weekly_goals.get("rdv", {}).get("target", 5)
        attendus_entretiens = weekly_goals.get("sourcing_solid", {}).get("target", 3)
        attendus_pushs = weekly_goals.get("push", {}).get("target", 15)

    # ── Enrichissement Ollama (optionnel) ──
    if use_ollama:
        all_cands = [(ec, "ec2") for ec in ec2_list] + [(ec, "ec1") for ec in ec1_list] + [(ec, "sourcing") for ec in sourcing_list]
        for item, _type in all_cands:
            metier = item.get("role") or item.get("sector") or ""
            if not metier or len(metier) < 3:
                p = f"Normalise ce métier en un nom court et standard: '{metier}'. Réponds uniquement avec le métier normalisé."
                normalized = _call_ollama(p)
                item["_normalized_metier"] = (normalized or metier)[:50]
            else:
                item["_normalized_metier"] = metier

        for client in clients_vus_list:
            notes = (client.get("notes") or "") + " " + (client.get("callNotes") or "")
            if notes.strip():
                p = f"Extrais les besoins exprimés par ce client (une ligne par besoin, format court):\n{notes[:500]}"
                besoins = _call_ollama(p)
                client["_besoins"] = (besoins or "")[:200]
            else:
                client["_besoins"] = ""

        for ec1 in ec1_list:
            ec1_data_str = ec1.get("ec1_data") or "{}"
            try:
                ec1_data = json.loads(ec1_data_str) if ec1_data_str else {}
            except Exception:
                ec1_data = {}
            parts = []
            if ec1.get("role"):
                parts.append(f"Métier: {ec1['role']}")
            if ec1.get("years_experience"):
                parts.append(f"Expérience: {ec1['years_experience']} ans")
            if ec1_data:
                parts.append(f"Données EC1: {json.dumps(ec1_data, ensure_ascii=False)[:200]}")
            if parts:
                p = "Génère un code note court (ex: 'B OKS') pour ce candidat:\n" + "\n".join(parts) + "\nRéponds uniquement avec le code."
                code = _call_ollama(p)
                ec1["_code_note"] = (code or "")[:20]
            else:
                ec1["_code_note"] = ""

    # ── Helper: extraire exp numérique ──
    def _parse_exp(ec):
        exp = ec.get("years_experience") or ec.get("seniority") or ""
        try:
            if isinstance(exp, str) and exp.strip():
                m = re.search(r'\d+', exp)
                return int(m.group()) if m else exp
        except Exception:
            pass
        return exp

    # ── Construire la liste ordonnée des candidats (EC2 d'abord, puis EC1, puis Sourcing) ──
    all_candidates = (
        [("EC2", ec) for ec in ec2_list] +
        [("EC1", ec) for ec in ec1_list] +
        [("Sourcing", ec) for ec in sourcing_list]
    )

    # ══════════════════════════════════════════════════════
    # Build the XLSX workbook — 15 colonnes A-O, layout zip
    # ══════════════════════════════════════════════════════
    wb = Workbook()
    ws = wb.active
    ws.title = "Liste"

    # Styles
    header_fill = PatternFill(start_color="2B3A4E", end_color="2B3A4E", fill_type="solid")
    header_font_white = Font(bold=True, size=11, color="FFFFFF")
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )
    thick_border = Border(
        left=Side(style="thick", color="000000"), right=Side(style="thick", color="000000"),
        top=Side(style="thick", color="000000"), bottom=Side(style="thick", color="000000"),
    )

    # ── En-têtes (15 colonnes A-O) ──
    headers = [
        "Semaine",             # A
        "Entretiens",          # B  (EC1 / EC2 / Sourcing)
        "Métier",              # C  (Nom - Rôle)
        "Exp",                 # D
        "Dispo",               # E
        "Notes",               # F
        "Commenta",            # G  (séparateur — bordure épaisse)
        "Prospections RDV pris",  # H
        "Clients vus",         # I
        "Besoins",             # J
        "Pushs consultant",    # K
        "Nb pushs",            # L
        "Attendus Prosp",      # M
        "Attendus Entretiens", # N
        "Attendus Pushs",      # O
    ]
    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font_white
        cell.fill = header_fill
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center", wrap_text=True)

    # Largeurs de colonnes
    col_widths = [10, 12, 35, 6, 12, 18, 18, 28, 22, 30, 28, 9, 14, 18, 14]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # ── Layout zip : chaque ligne i combine le i-ème candidat + i-ème prospection + i-ème push ──
    total_rows = max(1, len(all_candidates), len(prosp_rdv_list), len(clients_vus_list), len(push_consultants))
    week_start_row = 2

    for i in range(total_rows):
        row = week_start_row + i

        # A: Semaine (sera fusionné verticalement à la fin)
        ws.cell(row=row, column=1, value=week_label)

        # B-G : candidat
        if i < len(all_candidates):
            ctype, ec = all_candidates[i]
            ws.cell(row=row, column=2, value=ctype)  # B: EC1 / EC2 / Sourcing
            # C: "Nom - Rôle"
            name = ec.get("name") or ""
            role = ec.get("_normalized_metier") if use_ollama else (ec.get("role") or ec.get("sector") or "")
            metier_str = f"{name} - {role}" if role else name
            ws.cell(row=row, column=3, value=metier_str)
            ws.cell(row=row, column=4, value=_parse_exp(ec))  # D: Exp
            # E: Dispo (depuis tab EC1 si disponible, sinon 'asap')
            dispo = ec.get("availability") or "asap"
            ws.cell(row=row, column=5, value=dispo)
            # F: Notes courtes
            if ctype == "EC1":
                ws.cell(row=row, column=6, value=ec.get("_code_note") if use_ollama else (ec.get("tab_notes") or ""))
            else:
                ws.cell(row=row, column=6, value=(ec.get("notes") or "")[:120])
            # G: Commenta (bordure épaisse — séparateur visuel)
            if ctype == "EC1":
                ec1_data_str = ec.get("ec1_data") or "{}"
                try:
                    ec1_data = json.loads(ec1_data_str) if ec1_data_str else {}
                    commenta = json.dumps(ec1_data, ensure_ascii=False)[:300] if ec1_data else ""
                except Exception:
                    commenta = ""
            else:
                commenta = (ec.get("notes") or "")[:300]
            ws.cell(row=row, column=7, value=commenta)

        # H: Prospections RDV pris
        if i < len(prosp_rdv_list):
            prosp = prosp_rdv_list[i]
            company = prosp.get("company_name", "")
            prosp_text = f"{prosp.get('prospect_name', '')} - {company}" if company else prosp.get("prospect_name", "")
            ws.cell(row=row, column=8, value=prosp_text)

        # I-J: Clients vus + Besoins
        if i < len(clients_vus_list):
            client = clients_vus_list[i]
            company = client.get("company_name", "")
            client_text = f"{client.get('prospect_name', '')} - {company}" if company else client.get("prospect_name", "")
            ws.cell(row=row, column=9, value=client_text)
            besoins = client.get("_besoins") if use_ollama else ""
            if not besoins:
                notes_raw = (client.get("notes") or "") + " " + (client.get("callNotes") or "")
                besoins = notes_raw.strip()[:200]
            ws.cell(row=row, column=10, value=besoins)

        # K-L: Pushs consultant + Nb pushs
        if i < len(push_consultants):
            pc = push_consultants[i]
            cnt = pc.get("count", 0)
            ws.cell(row=row, column=11, value=f"{pc.get('name', '')} ({cnt}x)")
            ws.cell(row=row, column=12, value=cnt)

        # M-N-O: Objectifs (première ligne de la semaine uniquement)
        if i == 0:
            ws.cell(row=row, column=13, value=attendus_prosp)
            ws.cell(row=row, column=14, value=attendus_entretiens)
            ws.cell(row=row, column=15, value=attendus_pushs)

        # Bordures
        for col in range(1, 16):
            ws.cell(row=row, column=col).border = thin_border
        ws.cell(row=row, column=7).border = thick_border  # Séparateur G

    # ── Fusionner la colonne A (Semaine) sur toutes les lignes de la semaine ──
    week_end_row = week_start_row + total_rows - 1
    if week_end_row > week_start_row:
        ws.merge_cells(f'A{week_start_row}:A{week_end_row}')
        merged_cell = ws.cell(row=week_start_row, column=1)
        merged_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # ── Wrap text / alignement vertical ──
    for r in range(week_start_row, week_end_row + 1):
        for col in [3, 7, 10, 11]:
            ws.cell(row=r, column=col).alignment = Alignment(wrap_text=True, vertical="top")

    # ── Stream le fichier ──
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"Suivi_activite_{week_label}_{monday.isoformat()}.xlsx"
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )


# ====== Duplicates API ======
def _norm_phone(s: str) -> str:
    digits = "".join(ch for ch in s if ch.isdigit())
    return digits[-10:] if len(digits) > 10 else digits


def _normalize(s: str) -> str:
    """Lowercase + strip + remove accents + collapse whitespace.

    Used for duplicate detection keys; must be deterministic across OS/timezone.
    """
    s = (s or "").strip().lower()
    # Remove accents/diacritics
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    # Keep it simple (avoid funky separators)
    s = re.sub(r"\s+", " ", s)
    return s


def _name_key_for_duplicate(name: str) -> str:
    """Normalise un nom pour comparaison doublons: INITIALES NOM (ex. PY CAMPION).

    Prénom(s) → initiales (chaque sous-mot - . - espace donne une lettre).
    Dernière partie = nom de famille.
    """
    s = _normalize(name or "")
    if not s:
        return ""
    parts = re.split(r"[\s,;]+", s)
    parts = [x for x in parts if x]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0].upper()
    lastname = parts[-1]
    first_parts = " ".join(parts[:-1])
    initials = []
    for sub in re.split(r"[\s.\-]+", first_parts):
        if sub:
            initials.append(sub[0])
    initials_str = "".join(initials).upper()
    return f"{initials_str} {lastname.upper()}".strip()


def _split_name_for_dup(name: str) -> tuple[str, str]:
    """Retourne (lastname_norm, firstname_norm) pour comparaison doublons stricte.

    Sépare explicitement le nom de famille (dernière partie) du prénom (reste).
    Exemple : "Jean-Pierre DUPONT" → ("dupont", "jean pierre")
    Utilisé pour éviter les faux positifs : exige même nom ET même initiale prénom.
    """
    s = _normalize(name or "")
    parts = [x for x in re.split(r"[\s,;]+", s) if x]
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    lastname = parts[-1]
    firstname = " ".join(parts[:-1])
    # Normaliser tirets/points dans le prénom → "jean-pierre" devient "jean pierre"
    firstname = re.sub(r"[\.\-]+", " ", firstname).strip()
    firstname = re.sub(r"\s+", " ", firstname)
    return (lastname, firstname)


# ────────────────────────────────────────────────────────────────────
# Stats v30 — données pour charts interactifs (période mensuelle + filtres)
# ────────────────────────────────────────────────────────────────────

@app.get("/api/stats/data")
def api_stats_data():
    """Agrégats pour les 4 charts v30 : RDV/mois, Appels/mois, Funnel, Top entreprises.
    Query params:
      - period : YYYY-MM (month-based sliding window, défaut = mois courant)
      - start / end : YYYY-MM-DD (custom range — prioritaire sur period)
      - tags : CSV de tags à filtrer
      - statuts : CSV de statuts à filtrer
      - user_id : int (admin only — filtrer par utilisateur)
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    today = datetime.date.today()

    # ── Résolution de la période ──
    start_s = (request.args.get("start") or "").strip()
    end_s = (request.args.get("end") or "").strip()
    period = (request.args.get("period") or "").strip()  # YYYY-MM

    if start_s and end_s:
        try:
            start_d = datetime.date.fromisoformat(start_s)
            end_d = datetime.date.fromisoformat(end_s)
            if start_d > end_d:
                start_d, end_d = end_d, start_d
        except Exception:
            start_d = today.replace(day=1)
            end_d = today
    elif period:
        try:
            y, m = int(period[:4]), int(period[5:7])
            start_d = datetime.date(y, m, 1)
            if m == 12:
                end_d = datetime.date(y + 1, 1, 1) - datetime.timedelta(days=1)
            else:
                end_d = datetime.date(y, m + 1, 1) - datetime.timedelta(days=1)
        except Exception:
            start_d = today.replace(day=1)
            end_d = today
    else:
        start_d = today.replace(day=1)
        end_d = today

    # ── Filtres optionnels ──
    tags_filter = [t.strip() for t in (request.args.get("tags") or "").split(",") if t.strip()]
    statuts_filter = [s.strip() for s in (request.args.get("statuts") or "").split(",") if s.strip()]

    # Admin peut filtrer par utilisateur
    target_uid = uid
    user_id_param = request.args.get("user_id", "").strip()
    if user_id_param:
        u = _get_current_user()
        if u and u.get("role") == "admin":
            try:
                target_uid = int(user_id_param)
            except Exception:
                pass

    # Construire des clauses SQL dynamiques
    base_cond = ("p.owner_id=? AND (p.deleted_at IS NULL OR p.deleted_at='') "
                 "AND (p.is_archived IS NULL OR p.is_archived=0)")
    base_params: list = [target_uid]

    if statuts_filter:
        ph = ",".join("?" * len(statuts_filter))
        base_cond += f" AND p.statut IN ({ph})"
        base_params.extend(statuts_filter)

    # RDV par mois (6 derniers mois se terminant par end_d)
    months_rdv = []
    months_calls = []
    for i in range(5, -1, -1):
        ref = end_d.replace(day=1)
        # reculer i mois
        y_off = ref.year + (ref.month - 1 - i) // 12
        m_off = (ref.month - 1 - i) % 12 + 1
        first = datetime.date(y_off, m_off, 1)
        if m_off == 12:
            last = datetime.date(y_off + 1, 1, 1) - datetime.timedelta(days=1)
        else:
            last = datetime.date(y_off, m_off + 1, 1) - datetime.timedelta(days=1)
        label = first.strftime("%b %Y")
        fi, li = first.isoformat(), last.isoformat()

        with _conn() as conn:
            rdv_n = conn.execute(
                f"""SELECT COUNT(DISTINCT e.prospect_id) AS n
                    FROM prospect_events e
                    JOIN prospects p ON p.id=e.prospect_id
                    WHERE {base_cond} AND e.type='rdv_taken'
                      AND substr(e.date,1,10)>=? AND substr(e.date,1,10)<=?""",
                base_params + [fi, li],
            ).fetchone()["n"]

            try:
                calls_n = conn.execute(
                    "SELECT COUNT(*) AS n FROM call_logs WHERE owner_id=? AND date>=? AND date<=?",
                    (target_uid, fi, li),
                ).fetchone()["n"]
            except Exception:
                calls_n = 0

        months_rdv.append({"label": label, "count": rdv_n})
        months_calls.append({"label": label, "count": calls_n})

    # Funnel
    with _conn() as conn:
        total_p = conn.execute(
            f"SELECT COUNT(*) AS n FROM prospects p WHERE {base_cond}", base_params
        ).fetchone()["n"]
        rdv_p = conn.execute(
            f"SELECT COUNT(*) AS n FROM prospects p WHERE {base_cond} AND p.statut='Rendez-vous'",
            base_params,
        ).fetchone()["n"]
        conv_rate = round(rdv_p / total_p, 4) if total_p > 0 else 0.0

        # Top entreprises
        top_rows = conn.execute(
            f"""SELECT c.groupe AS name, COUNT(p.id) AS n
                FROM companies c
                JOIN prospects p ON p.company_id=c.id
                WHERE {base_cond}
                GROUP BY c.id ORDER BY n DESC LIMIT 10""",
            base_params,
        ).fetchall()
        top_companies = [{"name": r["name"] or "—", "count": r["n"]} for r in top_rows]

    return jsonify(
        ok=True,
        period={"start": start_d.isoformat(), "end": end_d.isoformat()},
        rdv_by_month=[m["count"] for m in months_rdv],
        rdv_labels=[m["label"] for m in months_rdv],
        calls_by_month=[m["count"] for m in months_calls],
        calls_labels=[m["label"] for m in months_calls],
        funnel={"prospects": total_p, "rdv": rdv_p, "conversion_rate": conv_rate},
        top_companies=top_companies,
    )


@app.get("/api/stats/export")
def api_stats_export():
    """Export des données stats en JSON ou CSV.
    Query params:
      - period : YYYY-MM
      - start / end : YYYY-MM-DD
      - format : json | csv  (défaut json)
      - tags / statuts / user_id : mêmes filtres que /api/stats/data
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    fmt = (request.args.get("format") or "json").lower().strip()

    today = datetime.date.today()
    start_s = (request.args.get("start") or "").strip()
    end_s = (request.args.get("end") or "").strip()
    period = (request.args.get("period") or "").strip()
    tags_filter = [t.strip() for t in (request.args.get("tags") or "").split(",") if t.strip()]
    statuts_filter = [s.strip() for s in (request.args.get("statuts") or "").split(",") if s.strip()]

    if start_s and end_s:
        try:
            start_d = datetime.date.fromisoformat(start_s)
            end_d = datetime.date.fromisoformat(end_s)
        except Exception:
            start_d = today.replace(day=1); end_d = today
    elif period:
        try:
            y, m = int(period[:4]), int(period[5:7])
            start_d = datetime.date(y, m, 1)
            end_d = (datetime.date(y, m + 1, 1) - datetime.timedelta(days=1)) if m < 12 else datetime.date(y + 1, 1, 1) - datetime.timedelta(days=1)
        except Exception:
            start_d = today.replace(day=1); end_d = today
    else:
        start_d = today.replace(day=1); end_d = today

    target_uid = uid
    user_id_param = request.args.get("user_id", "").strip()
    if user_id_param:
        u = _get_current_user()
        if u and u.get("role") == "admin":
            try:
                target_uid = int(user_id_param)
            except Exception:
                pass

    base_cond = ("p.owner_id=? AND (p.deleted_at IS NULL OR p.deleted_at='') "
                 "AND (p.is_archived IS NULL OR p.is_archived=0)")
    base_params: list = [target_uid]
    if statuts_filter:
        ph = ",".join("?" * len(statuts_filter))
        base_cond += f" AND p.statut IN ({ph})"
        base_params.extend(statuts_filter)

    # Données brutes prospects pour l'export
    with _conn() as conn:
        rows = conn.execute(
            f"""SELECT p.id, p.name, p.statut, p.lastContact, p.nextFollowUp,
                       c.groupe AS company
                FROM prospects p
                LEFT JOIN companies c ON c.id=p.company_id AND c.owner_id=?
                WHERE {base_cond}
                  AND (p.lastContact>=? OR p.nextFollowUp>=?)
                ORDER BY p.name""",
            [target_uid] + base_params + [start_d.isoformat(), start_d.isoformat()],
        ).fetchall()
        data_rows = [dict(r) for r in rows]

    filename_base = f"stats_{start_d}_{end_d}"

    if fmt == "csv":
        import io as _io
        import csv as _csv
        out = _io.StringIO()
        writer = _csv.DictWriter(out, fieldnames=["id", "name", "company", "statut", "lastContact", "nextFollowUp"])
        writer.writeheader()
        writer.writerows(data_rows)
        csv_bytes = out.getvalue().encode("utf-8-sig")
        return Response(
            csv_bytes,
            mimetype="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'},
        )
    else:
        payload = json.dumps({"period": {"start": start_d.isoformat(), "end": end_d.isoformat()}, "prospects": data_rows}, ensure_ascii=False, indent=2)
        return Response(
            payload.encode("utf-8"),
            mimetype="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.json"'},
        )


@app.get("/api/duplicates")
def api_duplicates():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    min_score = request.args.get("min_score", type=float)
    if min_score is None or min_score < 0 or min_score > 1:
        min_score = 0.85
    with _conn() as conn:
        pros = [dict(r) for r in conn.execute(
            "SELECT id, name, email, telephone, linkedin, company_id, COALESCE(is_archived,0) AS is_archived FROM prospects WHERE owner_id=?;", (uid,)
        ).fetchall()]
        comps = {r["id"]: dict(r) for r in conn.execute("SELECT id, groupe, site FROM companies WHERE owner_id=?;", (uid,)).fetchall()}
        ignored_pairs: set[frozenset] = {
            frozenset([r["prospect_id_a"], r["prospect_id_b"]])
            for r in conn.execute(
                "SELECT prospect_id_a, prospect_id_b FROM duplicate_ignores WHERE owner_id=?;", (uid,)
            ).fetchall()
        }

    pros_for_dup = [p for p in pros if not p.get("is_archived")]
    groups = []

    def add_group(kind: str, key: str, ids: List[int], score: float | None = None):
        if len(ids) < 2:
            return
        # Filtrer les paires où TOUTES les combinaisons de 2 sont ignorées
        active_ids = []
        for pid in ids:
            # Garder ce prospect si au moins un autre prospect du groupe n'est pas ignoré avec lui
            has_active_pair = any(
                frozenset([pid, other]) not in ignored_pairs
                for other in ids if other != pid
            )
            if has_active_pair:
                active_ids.append(pid)
        if len(active_ids) < 2:
            return
        items = []
        for pid in active_ids:
            p = next((x for x in pros if x["id"] == pid), None)
            if not p:
                continue
            c = comps.get(p.get("company_id"))
            items.append(
                {
                    "id": p["id"],
                    "name": p.get("name"),
                    "email": p.get("email"),
                    "telephone": p.get("telephone"),
                    "linkedin": p.get("linkedin"),
                    "company": f"{(c.get('groupe') if c else '')} {(c.get('site') if c else '')}".strip(),
                }
            )
        if len(items) < 2:
            return
        g = {"type": kind, "key": key, "items": items}
        if score is not None:
            g["score"] = round(score, 2)
        groups.append(g)

    by_email = {}
    by_link = {}
    by_phone = {}

    for p in pros_for_dup:
        if p.get("email"):
            k = str(p["email"]).strip().lower()
            if k:
                by_email.setdefault(k, []).append(p["id"])
        if p.get("linkedin"):
            k = str(p["linkedin"]).strip().lower()
            if k:
                by_link.setdefault(k, []).append(p["id"])
        if p.get("telephone"):
            k = _norm_phone(str(p["telephone"]))
            if k:
                by_phone.setdefault(k, []).append(p["id"])

    for k, ids in by_email.items():
        add_group("email", k, ids)
    for k, ids in by_link.items():
        add_group("linkedin", k, ids)
    for k, ids in by_phone.items():
        add_group("telephone", k, ids)

    # Prospects déjà dans un groupe exact (email/linkedin/phone)
    in_exact = set()
    for g in groups:
        for it in g.get("items") or []:
            in_exact.add(it["id"])

    # Détection par similarité nom + même entreprise (uniquement parmi les non-contacts)
    by_company: Dict[int, List[Dict[str, Any]]] = {}
    for p in pros_for_dup:
        cid = p.get("company_id")
        if cid is not None:
            by_company.setdefault(int(cid), []).append(p)
    name_pairs: List[tuple[List[int], float]] = []
    for cid, company_pros in by_company.items():
        if len(company_pros) < 2:
            continue
        for i, p1 in enumerate(company_pros):
            ln1, fn1 = _split_name_for_dup(p1.get("name") or "")
            if not ln1:
                continue
            for p2 in company_pros[i + 1 :]:
                ln2, fn2 = _split_name_for_dup(p2.get("name") or "")
                if not ln2:
                    continue
                # Même nom de famille requis (exact, normalisé)
                if ln1 != ln2:
                    continue
                # Même première initiale du prénom requise (si les deux ont un prénom)
                if fn1 and fn2 and fn1[0] != fn2[0]:
                    continue
                # Comparaison complète des prénoms
                if fn1 and fn2:
                    ratio = difflib.SequenceMatcher(None, fn1, fn2).ratio()
                    if ratio < min_score:
                        continue
                else:
                    ratio = 1.0  # Même nom de famille sans prénom → doublon probable
                ids = sorted([p1["id"], p2["id"]])
                name_pairs.append((ids, ratio))
    # Fusionner les paires qui se chevauchent (A-B et B-C → A-B-C)
    merged: Dict[frozenset, float] = {}
    for ids, score in name_pairs:
        s = frozenset(ids)
        merged[s] = max(merged.get(s, 0), score)
    changed = True
    while changed:
        changed = False
        keys = list(merged.keys())
        for i, k1 in enumerate(keys):
            for k2 in keys[i + 1 :]:
                if k1 & k2:
                    new_set = k1 | k2
                    new_score = min(merged[k1], merged[k2])
                    if new_set not in merged or merged[new_set] < new_score:
                        merged[new_set] = max(merged.get(new_set, 0), new_score)
                        merged.pop(k1, None)
                        merged.pop(k2, None)
                        changed = True
                        break
            if changed:
                break
    for ids_set, score in merged.items():
        ids_list = sorted(ids_set)
        if len(ids_list) < 2:
            continue
        if all(pid in in_exact for pid in ids_list):
            continue
        p0 = next((x for x in pros if x["id"] == ids_list[0]), None)
        company_label = "même entreprise"
        if p0 and comps:
            c = comps.get(p0.get("company_id"))
            if c:
                company_label = (c.get("groupe") or "").strip() or "même entreprise"
        add_group("name_company", f"Similarité nom · {company_label}", ids_list, score=score)

    # sort bigger groups first
    groups.sort(key=lambda g: len(g.get("items") or []), reverse=True)
    # companies: duplicates by (groupe, site) — uniquement les miennes
    with _conn() as conn:
        comps = [dict(r) for r in conn.execute("SELECT * FROM companies WHERE owner_id=? ORDER BY id DESC;", (uid,)).fetchall()]

    def _norm(s: str) -> str:
        return _normalize(s or "")

    buckets = {}
    for c in comps:
        k = (_norm(c.get("groupe", "")), _norm(c.get("site", "")))
        buckets.setdefault(k, []).append(c)

    company_groups = []
    for k, lst in buckets.items():
        if len(lst) >= 2 and (k[0] or k[1]):
            company_groups.append({
                "key": f"{k[0]}|{k[1]}",
                "count": len(lst),
                "items": [{"id": x["id"], "groupe": x.get("groupe",""), "site": x.get("site",""), "notes": x.get("notes",""), "tags": x.get("tags", [])} for x in lst]
            })

    return jsonify({"ok": True, "prospect_groups": groups, "company_groups": company_groups})


@app.post("/api/duplicates/ignore")
@role_required('editor')
def api_duplicates_ignore():
    """Marque une paire de prospects comme 'pas un doublon' (persistant).

    Body JSON : { "id_a": int, "id_b": int }
    Les IDs sont triés avant insertion pour garantir l'unicité.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    try:
        id_a = int(payload["id_a"])
        id_b = int(payload["id_b"])
    except (KeyError, TypeError, ValueError):
        return jsonify(ok=False, error="id_a et id_b requis (entiers)"), 400
    if id_a == id_b:
        return jsonify(ok=False, error="Les deux IDs doivent être différents"), 400
    # Toujours stocker dans l'ordre croissant pour garantir l'unicité
    a, b = sorted([id_a, id_b])
    with _conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO duplicate_ignores (owner_id, prospect_id_a, prospect_id_b) VALUES (?,?,?);",
            (uid, a, b)
        )
    return jsonify(ok=True)


@app.post("/api/prospects/check-duplicates")
def api_prospects_check_duplicates():
    """Compare une liste de prospects (à ajouter) aux prospects déjà en base.
    Retourne les indices des doublons suspects (email, linkedin, téléphone, ou nom+entreprise)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    prospects = payload.get("prospects") or []
    if not isinstance(prospects, list):
        return jsonify(ok=False, error="prospects doit être une liste"), 400
    min_score = payload.get("min_score")
    if min_score is not None:
        try:
            min_score = float(min_score)
            if min_score < 0 or min_score > 1:
                min_score = 0.85
        except (TypeError, ValueError):
            min_score = 0.85
    else:
        min_score = 0.85

    with _conn() as conn:
        existing = [dict(r) for r in conn.execute(
            "SELECT id, name, email, telephone, linkedin, company_id FROM prospects WHERE owner_id=?;",
            (uid,),
        ).fetchall()]

    by_email: Dict[str, int] = {}
    by_link: Dict[str, int] = {}
    by_phone: Dict[str, int] = {}
    for p in existing:
        if p.get("email"):
            k = str(p["email"]).strip().lower()
            if k and k not in by_email:
                by_email[k] = p["id"]
        if p.get("linkedin"):
            k = str(p["linkedin"]).strip().lower()
            if k and k not in by_link:
                by_link[k] = p["id"]
        if p.get("telephone"):
            k = _norm_phone(str(p["telephone"]))
            if k and k not in by_phone:
                by_phone[k] = p["id"]

    by_company: Dict[int, List[Dict[str, Any]]] = {}
    for p in existing:
        cid = p.get("company_id")
        if cid is not None:
            by_company.setdefault(int(cid), []).append(p)

    duplicate_indexes: List[Dict[str, Any]] = []
    for idx, inc in enumerate(prospects):
        if not isinstance(inc, dict):
            continue
        existing_id = None
        reason = None
        if inc.get("email"):
            k = str(inc["email"]).strip().lower()
            if k and k in by_email:
                existing_id = by_email[k]
                reason = "email"
        if not reason and inc.get("linkedin"):
            k = str(inc["linkedin"]).strip().lower()
            if k and k in by_link:
                existing_id = by_link[k]
                reason = "linkedin"
        if not reason and inc.get("telephone"):
            k = _norm_phone(str(inc["telephone"]))
            if k and k in by_phone:
                existing_id = by_phone[k]
                reason = "telephone"
        if not reason and min_score and inc.get("name") and inc.get("company_id") is not None:
            cid = int(inc["company_id"]) if inc["company_id"] is not None else None
            if cid is not None and cid in by_company:
                ln1, fn1 = _split_name_for_dup(inc.get("name") or "")
                if ln1:
                    for p in by_company[cid]:
                        ln2, fn2 = _split_name_for_dup(p.get("name") or "")
                        if not ln2 or ln1 != ln2:
                            continue
                        if fn1 and fn2 and fn1[0] != fn2[0]:
                            continue
                        if fn1 and fn2:
                            if difflib.SequenceMatcher(None, fn1, fn2).ratio() < min_score:
                                continue
                        existing_id = p["id"]
                        reason = "name_company"
                        break
        if existing_id is not None and reason:
            duplicate_indexes.append({"index": idx, "existing_id": existing_id, "reason": reason})

    return jsonify({"ok": True, "duplicate_indexes": duplicate_indexes})


@app.post("/api/prospects/create")
@role_required('editor')
def api_prospect_create():
    """Crée un seul prospect. Retourne l'ID assigné côté serveur.
    Utilise le prochain id disponible côté serveur (MAX(id)+1) pour éviter les collisions
    entre sessions simultanées."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify(ok=False, error="name est requis"), 400

    def _dump_tags(v):
        if v is None:
            return "[]"
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return "[]"
            if s.startswith("["):
                return s
            parts = [t.strip() for t in s.split(",") if t.strip()]
            return json.dumps(parts, ensure_ascii=False)
        if isinstance(v, list):
            return json.dumps([str(t).strip() for t in v if str(t).strip()], ensure_ascii=False)
        return "[]"

    company_id = 0
    company_groupe = (payload.get("company_groupe") or "").strip()
    company_site = (payload.get("company_site") or "").strip()

    with _conn() as conn:
        # Résoudre ou créer l'entreprise si fournie
        if payload.get("company_id"):
            try:
                cid = int(payload["company_id"])
                row = conn.execute("SELECT id FROM companies WHERE id=? AND owner_id=?;", (cid, uid)).fetchone()
                if row:
                    company_id = cid
            except Exception:
                pass

        if not company_id and company_groupe:
            row = conn.execute(
                "SELECT id FROM companies WHERE owner_id=? AND LOWER(groupe)=LOWER(?) AND LOWER(COALESCE(site,''))=LOWER(?);",
                (uid, company_groupe, company_site or "")
            ).fetchone()
            if row:
                company_id = int(row["id"])
            else:
                max_co = conn.execute("SELECT COALESCE(MAX(id),0) as m FROM companies WHERE owner_id=?;", (uid,)).fetchone()["m"]
                new_co_id = int(max_co) + 1
                conn.execute(
                    "INSERT INTO companies (id, groupe, site, owner_id) VALUES (?,?,?,?);",
                    (new_co_id, company_groupe, company_site or "", uid)
                )
                company_id = new_co_id

        # Générer l'ID côté serveur
        max_p = conn.execute("SELECT COALESCE(MAX(id),0) as m FROM prospects WHERE owner_id=?;", (uid,)).fetchone()["m"]
        new_id = int(max_p) + 1
        now = _now_iso()

        conn.execute(
            """INSERT INTO prospects
            (id, name, company_id, fonction, telephone, email, linkedin, pertinence, statut,
             lastContact, notes, callNotes, tags, priority, owner_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);""",
            (
                new_id,
                name,
                company_id,
                (payload.get("fonction") or ""),
                (payload.get("telephone") or ""),
                (payload.get("email") or ""),
                (payload.get("linkedin") or ""),
                payload.get("pertinence") or "",
                payload.get("statut") or "Pas d'actions",
                payload.get("lastContact") or now,
                (payload.get("notes") or ""),
                "[]",
                _dump_tags(payload.get("tags")),
                2,
                uid,
            )
        )

    return jsonify({"ok": True, "id": new_id, "company_id": company_id})


# Champs prospect fusionnables (pour prévisualisation et choix utilisateur)
MERGEABLE_PROSPECT_FIELDS = [
    "name", "company_id", "fonction", "telephone", "email", "linkedin",
    "pertinence", "statut", "lastContact", "nextFollowUp", "priority",
    "notes", "callNotes", "pushEmailSentAt", "tags", "template_id",
]
# Champs pour lesquels on propose "both" (fusionner les deux)
MERGEABLE_TEXT_APPEND_FIELDS = ("notes", "callNotes", "tags")


@app.get("/api/duplicates/merge-preview")
def api_duplicates_merge_preview():
    """Retourne les deux prospects complets pour afficher la modale de fusion (choix par champ)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    keep_id = request.args.get("keep_id", type=int)
    merge_id = request.args.get("merge_id", type=int)
    if not keep_id or not merge_id or keep_id == merge_id:
        return jsonify({"ok": False, "error": "keep_id and merge_id required"}), 400
    with _conn() as conn:
        k = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (keep_id, uid)).fetchone()
        m = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (merge_id, uid)).fetchone()
        if not k or not m:
            return jsonify({"ok": False, "error": "prospect not found"}), 404
        k = dict(k)
        m = dict(m)
        companies = [dict(r) for r in conn.execute("SELECT id, groupe, site FROM companies WHERE owner_id=?;", (uid,)).fetchall()]
    keep_d = dict(k)
    merge_d = dict(m)
    # Nettoyer pour JSON (dates, None)
    for d in (keep_d, merge_d):
        for key in list(d.keys()):
            if d[key] is None:
                continue
            if hasattr(d[key], "isoformat"):
                d[key] = d[key].isoformat() if d[key] else None
    return jsonify({
        "ok": True,
        "keep": keep_d,
        "merge": merge_d,
        "companies": companies,
        "mergeable_fields": MERGEABLE_PROSPECT_FIELDS,
        "append_fields": list(MERGEABLE_TEXT_APPEND_FIELDS),
    })


@app.post("/api/duplicates/merge")
def api_duplicates_merge():
    payload = request.get_json(force=True, silent=False) or {}
    keep_id = payload.get("keep_id")
    merge_id = payload.get("merge_id")
    choices = payload.get("choices") or {}  # { "name": "keep"|"merge", "notes": "keep"|"merge"|"both", ... }
    if not keep_id or not merge_id:
        return jsonify({"ok": False, "error": "keep_id and merge_id are required"}), 400
    keep_id = int(keep_id)
    merge_id = int(merge_id)
    if keep_id == merge_id:
        return jsonify({"ok": False, "error": "ids must differ"}), 400

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        k = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (keep_id, uid)).fetchone()
        m = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (merge_id, uid)).fetchone()
        if not k or not m:
            return jsonify({"ok": False, "error": "prospect not found"}), 404
        k = dict(k)
        m = dict(m)

        def pick(a, b):
            return a if (a is not None and str(a).strip()) else b

        def parse_tags(v):
            try:
                j = json.loads(v or "[]")
                if isinstance(j, list):
                    return [str(x).strip() for x in j if str(x).strip()]
            except Exception:
                pass
            return []
        def parse_cn(v):
            try:
                j = json.loads(v or "[]")
                if isinstance(j, list):
                    return j
            except Exception:
                pass
            return []

        merged = {}
        for f in MERGEABLE_PROSPECT_FIELDS:
            choice = (choices.get(f) or "").strip().lower()
            kv = k.get(f)
            mv = m.get(f)
            if f in MERGEABLE_TEXT_APPEND_FIELDS:
                if choice == "both":
                    if f == "tags":
                        merged[f] = json.dumps(sorted(set(parse_tags(k.get("tags")) + parse_tags(m.get("tags")))), ensure_ascii=False)
                    elif f == "callNotes":
                        merged[f] = json.dumps(parse_cn(k.get("callNotes")) + parse_cn(m.get("callNotes")), ensure_ascii=False)
                    else:
                        merged[f] = (str(kv or "") + "\n" + str(mv or "")).strip() or None
                elif choice == "merge":
                    merged[f] = mv if (mv is not None and str(mv).strip()) else kv
                    if f == "tags":
                        merged[f] = json.dumps(parse_tags(merged[f]) if isinstance(merged[f], str) else (merged[f] or "[]"), ensure_ascii=False)
                    elif f == "callNotes":
                        merged[f] = json.dumps(parse_cn(merged[f]) if isinstance(merged[f], str) else (merged[f] or "[]"), ensure_ascii=False)
                else:
                    merged[f] = kv if (kv is not None and str(kv).strip()) else mv
                    if f == "tags":
                        merged[f] = json.dumps(parse_tags(merged[f]) if isinstance(merged[f], str) else (merged[f] or "[]"), ensure_ascii=False)
                    elif f == "callNotes":
                        merged[f] = json.dumps(parse_cn(merged[f]) if isinstance(merged[f], str) else (merged[f] or "[]"), ensure_ascii=False)
            else:
                if choice == "merge":
                    merged[f] = pick(mv, kv)
                else:
                    merged[f] = pick(kv, mv)

        conn.execute(
            '''
            UPDATE prospects
            SET name=?, company_id=?, fonction=?, telephone=?, email=?, linkedin=?, pertinence=?, statut=?, lastContact=?, nextFollowUp=?, priority=?, notes=?, callNotes=?, pushEmailSentAt=?, tags=?, template_id=?
            WHERE id=? AND owner_id=?;
            ''',
            (
                merged["name"],
                merged["company_id"],
                merged["fonction"],
                merged["telephone"],
                merged["email"],
                merged["linkedin"],
                merged["pertinence"],
                merged["statut"],
                merged["lastContact"],
                merged["nextFollowUp"],
                merged["priority"],
                merged["notes"],
                merged["callNotes"],
                merged["pushEmailSentAt"],
                merged["tags"],
                merged["template_id"],
                keep_id,
                uid,
            ),
        )

        conn.execute("UPDATE push_logs SET prospect_id=? WHERE prospect_id=?;", (keep_id, merge_id))
        conn.execute("DELETE FROM prospects WHERE id=? AND owner_id=?;", (merge_id, uid))

    _audit_log("merge_delete", "prospect", merge_id, new_value=str(keep_id))
    return jsonify({"ok": True})


# ====== Company merge (duplicates) ======
@app.post("/api/companies/merge")
def api_companies_merge():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True) or {}
    keep_id = int(payload.get("keep_id") or 0)
    merge_id = int(payload.get("merge_id") or 0)
    if not keep_id or not merge_id or keep_id == merge_id:
        return jsonify({"ok": False, "error": "keep_id and merge_id are required"}), 400

    if not _company_owned(keep_id):
        return jsonify({"error": "Accès non autorisé à cette entreprise"}), 403
    if not _company_owned(merge_id):
        return jsonify({"error": "Accès non autorisé à cette entreprise"}), 403

    with _conn() as conn:
        keep = conn.execute("SELECT * FROM companies WHERE id=? AND owner_id=?;", (keep_id, uid)).fetchone()
        merg = conn.execute("SELECT * FROM companies WHERE id=? AND owner_id=?;", (merge_id, uid)).fetchone()
        if not keep or not merg:
            return jsonify({"ok": False, "error": "company not found"}), 404

        keep_d = dict(keep)
        merg_d = dict(merg)

        def _merge_text(a, b):
            a = (a or "").strip()
            b = (b or "").strip()
            if not a: return b
            if not b: return a
            if b in a: return a
            return a + "\n" + b

        def _to_tags(v):
            if v is None:
                return []
            if isinstance(v, list):
                return [str(x).strip() for x in v if str(x).strip()]
            s = str(v).strip()
            if not s:
                return []
            # try json array
            try:
                j = json.loads(s)
                if isinstance(j, list):
                    return [str(x).strip() for x in j if str(x).strip()]
            except Exception:
                pass
            return [x.strip() for x in s.split(",") if x.strip()]

        tags = sorted(set(_to_tags(keep_d.get("tags")) + _to_tags(merg_d.get("tags"))))
        notes = _merge_text(keep_d.get("notes"), merg_d.get("notes"))

        conn.execute("UPDATE companies SET notes=?, tags=? WHERE id=? AND owner_id=?;", (notes, json.dumps(tags), keep_id, uid))
        conn.execute("UPDATE prospects SET company_id=? WHERE company_id=? AND owner_id=?;", (keep_id, merge_id, uid))
        conn.execute("DELETE FROM companies WHERE id=? AND owner_id=?;", (merge_id, uid))

    _audit_log("merge_delete", "company", merge_id, new_value=str(keep_id))
    return jsonify({"ok": True})



# ====== Focus queue API ======
@app.get("/api/focus_queue")
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
@app.get("/api/snapshots")
def api_snapshots_list():
    return jsonify({"ok": True, "items": list_snapshots()})


@app.post("/api/snapshots/create")
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


@app.post("/api/snapshots/restore")
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


@app.post("/api/snapshots/delete")
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
@app.get("/api/admin/backups")
@login_required
@role_required('admin')
def api_admin_backups_list():
    from backup import list_backups
    return jsonify(ok=True, backups=list_backups())


@app.post("/api/admin/backup/trigger")
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
@app.post("/api/reset")
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
@app.get("/api/push-logs/export.xlsx")
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


@app.get("/api/candidates/export.csv")
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
@app.get("/api/push-logs")
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


@app.post("/api/push-logs/add")
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

@app.post("/api/push-logs/undo_last")
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

@app.post("/api/push-logs/delete")
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


@app.get("/api/push-campaigns")
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


@app.post("/api/push-campaigns")
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


@app.put("/api/push-campaigns/<int:cid>")
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


@app.delete("/api/push-campaigns/<int:cid>")
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


@app.post("/api/push-campaigns/<int:cid>/recipients-preview")
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


@app.post("/api/push-campaigns/<int:cid>/send")
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
@app.get("/api/push/track")
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


@app.get("/api/push/track/click")
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


@app.get("/api/push/optimal-time")
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


@app.get("/api/push/analytics")
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


# ====== Saved Views API (v6) ======
@app.get("/api/views")
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

@app.post("/api/views/save")
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

@app.post("/api/views/delete")
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

@app.post("/api/rapport/export-pdf")
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
@app.delete("/api/views/<int:vid>")
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

@app.get("/api/tasks")
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


@app.post("/api/tasks/save")
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


@app.post("/api/tasks/done")
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


@app.post("/api/tasks/delete")
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
@app.get("/api/tasks/rules")
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


@app.post("/api/tasks/rules")
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


@app.post("/api/tasks/rules/delete")
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


@app.post("/api/tasks/daily-check")
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


@app.get("/api/tasks/optimize")
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


# ====== Company / Opportunities API (v6) ======
@app.get("/api/company/full")
def api_company_full():
    cid = request.args.get("id")
    if not cid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    cid_i = int(cid)
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        company = conn.execute("SELECT * FROM companies WHERE id=? AND owner_id=?;", (cid_i, uid)).fetchone()
        if not company:
            return jsonify({"ok": False, "error": "company not found"}), 404
        prospects = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM prospects WHERE company_id=? AND owner_id=? ORDER BY id DESC;",
                (cid_i, uid),
            ).fetchall()
        ]
        opps = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM opportunities WHERE company_id=? ORDER BY COALESCE(updatedAt, createdAt) DESC, id DESC;",
                (cid_i,),
            ).fetchall()
        ]
        # timeline = company_events + push logs of prospects in this company + prospect_events
        events = []
        try:
            rows = conn.execute(
                "SELECT date, type, title, content, meta, createdAt FROM company_events WHERE company_id=? ORDER BY date DESC, id DESC LIMIT 120;",
                (cid_i,),
            ).fetchall()
            for r in rows:
                d = dict(r)
                d["source"] = "company"
                events.append(d)
        except sqlite3.OperationalError as e:
            logger.warning("company_events query failed: %s", e)

        # push logs for prospects
        rows = conn.execute(
            '''
            SELECT l.sentAt AS date, 'push' AS type, 
                   ('Push (' || COALESCE(l.channel,'email') || ')') AS title,
                   COALESCE(l.subject,'') AS content,
                   json_object('to', l.to_email, 'template', l.template_name, 'prospect_id', p.id, 'prospect_name', p.name) AS meta,
                   l.createdAt AS createdAt
            FROM push_logs l
            JOIN prospects p ON p.id = l.prospect_id
            WHERE p.company_id=? AND p.owner_id=?
            ORDER BY l.id DESC
            LIMIT 120;
            ''',
            (cid_i, uid),
        ).fetchall()
        for r in rows:
            events.append(dict(r) | {"source":"push"})

        # prospect events for those prospects
        try:
            rows = conn.execute(
                '''
                SELECT e.date AS date, e.type AS type, e.title AS title, e.content AS content, e.meta AS meta, e.createdAt AS createdAt
                FROM prospect_events e
                JOIN prospects p ON p.id = e.prospect_id
                WHERE p.company_id=? AND p.owner_id=?
                ORDER BY e.date DESC, e.id DESC
                LIMIT 120;
                ''',
                (cid_i, uid),
            ).fetchall()
            for r in rows:
                events.append(dict(r) | {"source":"prospect"})
        except sqlite3.OperationalError as e:
            logger.warning("prospect_events query failed: %s", e)

    # Parse metas and sort
    out_events=[]
    for e in events:
        d=dict(e)
        try:
            d["meta"] = json.loads(d.get("meta") or "null")
        except Exception:
            d["meta"] = d.get("meta")
        out_events.append(d)
    out_events.sort(key=lambda x: str(x.get("date") or x.get("createdAt") or ""), reverse=True)
    return jsonify({"ok": True, "company": dict(company), "prospects": prospects, "opportunities": opps, "timeline": out_events[:200]})


@app.post("/api/company/update")
def api_company_update():
    payload, err = validate_payload({'id': (str, int)})
    if err:
        return err
    cid = payload.get("id")
    if not cid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    cid_i = int(cid)
    allowed = ["groupe","site","phone","notes","tags","website","linkedin","industry","size","address","city","country","stack","pain_points","budget","urgency"]
    fields = {k: payload.get(k) for k in allowed if k in payload}
    # tags can be list
    if "tags" in fields:
        v = fields["tags"]
        if isinstance(v, list):
            fields["tags"] = json.dumps([str(x).strip() for x in v if str(x).strip()], ensure_ascii=False)
        elif v is None:
            fields["tags"] = "[]"
        else:
            s=str(v).strip()
            if s.startswith("["):
                fields["tags"] = s
            else:
                parts=[t.strip() for t in s.split(",") if t.strip()]
                fields["tags"] = json.dumps(parts, ensure_ascii=False)
    now = _now_iso()
    if not fields:
        return jsonify({"ok": False, "error": "no fields"}), 400
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    # v23.4: Defensive check — only whitelisted column names can appear in SQL
    _COMPANY_ALLOWED_COLS = frozenset(allowed)
    assert all(k in _COMPANY_ALLOWED_COLS for k in fields), "Invalid column name"
    sets = ", ".join([f"{k}=?" for k in fields.keys()])
    vals = list(fields.values())
    with _conn() as conn:
        conn.execute(f"UPDATE companies SET {sets} WHERE id=? AND owner_id=?;", (*vals, cid_i, uid))
        row = conn.execute("SELECT * FROM companies WHERE id=? AND owner_id=?;", (cid_i, uid)).fetchone()
    
    # Synchroniser si l'entreprise est partagée
    _sync_shared_company_if_needed(cid_i, uid)
    
    _audit_log("update", "company", cid_i, new_value=json.dumps(fields, ensure_ascii=False))
    log_activity('update', 'entreprise', cid_i, row["groupe"] if row else None)
    return jsonify({"ok": True, "company": dict(row) if row else None})


def _sync_shared_company_if_needed(company_id: int, user_id: int) -> None:
    """Synchronise une entreprise partagée si elle est partagée avec d'autres utilisateurs."""
    with _auth_conn() as aconn:
        # Trouver tous les partages pour cette entreprise
        shares = aconn.execute(
            "SELECT from_user_id, to_user_id FROM shared_companies WHERE company_id = ?;",
            (company_id,)
        ).fetchall()
        
        for share in shares:
            from_user_id = share["from_user_id"]
            to_user_id = share["to_user_id"]
            
            # Si l'utilisateur actuel est celui qui a partagé, synchroniser vers le collaborateur
            if user_id == from_user_id:
                _sync_shared_company_to_collaborator(company_id, from_user_id, to_user_id)
            # Si l'utilisateur actuel est le collaborateur, synchroniser vers l'utilisateur source
            elif user_id == to_user_id:
                _sync_shared_company_to_collaborator(company_id, from_user_id, to_user_id)


@app.get("/api/audit-log")
def api_audit_log():
    """v23.5: Retrieve audit trail. Admin only."""
    user = _get_current_user()
    if not user or user.get("role") != "admin":
        return jsonify(ok=False, error="Admin requis"), 403
    try:
        page = max(1, int(request.args.get("page") or 1))
        limit = min(200, max(1, int(request.args.get("limit") or 50)))
    except (TypeError, ValueError):
        page, limit = 1, 50
    offset = (page - 1) * limit
    entity = request.args.get("entity")
    entity_id = request.args.get("entity_id")
    with _conn() as conn:
        if entity and entity_id:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE entity=? AND entity_id=? ORDER BY id DESC LIMIT ? OFFSET ?;",
                (entity, int(entity_id), limit, offset)
            ).fetchall()
            total = int(conn.execute("SELECT COUNT(*) FROM audit_log WHERE entity=? AND entity_id=?;", (entity, int(entity_id))).fetchone()[0])
        elif entity:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE entity=? ORDER BY id DESC LIMIT ? OFFSET ?;",
                (entity, limit, offset)
            ).fetchall()
            total = int(conn.execute("SELECT COUNT(*) FROM audit_log WHERE entity=?;", (entity,)).fetchone()[0])
        else:
            rows = conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?;", (limit, offset)).fetchall()
            total = int(conn.execute("SELECT COUNT(*) FROM audit_log;").fetchone()[0])
    from math import ceil
    return jsonify(ok=True, logs=[dict(r) for r in rows], pagination={"page": page, "limit": limit, "total": total, "pages": ceil(total / limit) if limit else 1})


@app.get("/api/activity")
@login_required
@role_required('admin')
def api_activity_logs():
    """v27.10: Journal d'activité multi-utilisateurs — admin only."""
    try:
        page = max(1, int(request.args.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    per_page = 50
    user_id_filter = request.args.get("user_id")
    action_filter = (request.args.get("action") or "").strip()

    where_clauses = []
    params = []
    if user_id_filter:
        try:
            where_clauses.append("user_id = ?")
            params.append(int(user_id_filter))
        except (TypeError, ValueError):
            pass
    if action_filter:
        where_clauses.append("action = ?")
        params.append(action_filter)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    with _auth_conn() as conn:
        total = int(conn.execute(
            f"SELECT COUNT(*) AS n FROM activity_logs {where_sql};", params
        ).fetchone()["n"])
        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT * FROM activity_logs {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?;",
            params + [per_page, offset]
        ).fetchall()
        users = conn.execute(
            "SELECT DISTINCT user_id, username FROM activity_logs ORDER BY username;"
        ).fetchall()
        action_rows = conn.execute(
            "SELECT DISTINCT action FROM activity_logs ORDER BY action;"
        ).fetchall()

    return jsonify(
        ok=True,
        logs=[dict(r) for r in rows],
        total=total,
        page=page,
        pages=max(1, math.ceil(total / per_page)),
        users=[dict(u) for u in users],
        actions=[a["action"] for a in action_rows]
    )


@app.post("/api/soft-deleted/restore")
def api_soft_deleted_restore():
    """v23.5: Restore a soft-deleted entity."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    entity = payload.get("entity")
    entity_id = payload.get("id")
    if entity not in ("prospect", "company", "candidate") or not entity_id:
        return jsonify(ok=False, error="entity and id required"), 400
    table = {"prospect": "prospects", "company": "companies", "candidate": "candidates"}[entity]
    with _conn() as conn:
        conn.execute(f"UPDATE {table} SET deleted_at=NULL WHERE id=? AND owner_id=?;", (int(entity_id), uid))
    _audit_log("restore", entity, int(entity_id))
    return jsonify(ok=True)


@app.post("/api/soft-deleted/purge")
def api_soft_deleted_purge():
    """v23.5: Permanently delete items soft-deleted more than 30 days ago. Admin only."""
    user = _get_current_user()
    if not user or user.get("role") != "admin":
        return jsonify(ok=False, error="Admin requis"), 403
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=30)).isoformat(timespec="seconds")
    purged = {}
    with _conn() as conn:
        for tbl in ("prospects", "companies", "candidates"):
            cur = conn.execute(f"DELETE FROM {tbl} WHERE deleted_at IS NOT NULL AND deleted_at < ?;", (cutoff,))
            purged[tbl] = cur.rowcount
    _audit_log("purge", "system", new_value=json.dumps(purged))
    return jsonify(ok=True, purged=purged)


@app.post("/api/company/events/add")
def api_company_events_add():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    cid = payload.get("company_id")
    if not cid:
        return jsonify({"ok": False, "error": "company_id is required"}), 400
    with _conn() as conn:
        row = conn.execute("SELECT id FROM companies WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        if not row:
            return jsonify(ok=False, error="Entreprise non trouvée"), 404
    title = (payload.get("title") or "").strip() or "Note"
    content = (payload.get("content") or "").rstrip()
    etype = (payload.get("type") or "note").strip()
    date = (payload.get("date") or _now_iso()).strip()
    meta = payload.get("meta")
    meta_json = json.dumps(meta, ensure_ascii=False) if meta is not None else None
    now = _now_iso()
    with _conn() as conn:
        conn.execute(
            "INSERT INTO company_events (company_id, date, type, title, content, meta, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?);",
            (int(cid), date, etype, title, content, meta_json, now),
        )
    return jsonify({"ok": True})


@app.post("/api/opportunities/save")
def api_opportunities_save():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    cid = payload.get("company_id")
    title = (payload.get("title") or "").strip()
    stage = (payload.get("stage") or "").strip()
    if not cid or not title or not stage:
        return jsonify({"ok": False, "error": "company_id, title, stage are required"}), 400
    with _conn() as conn:
        if not conn.execute("SELECT id FROM companies WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone():
            return jsonify(ok=False, error="Entreprise non trouvée"), 404
    oid = payload.get("id")
    candidate_name = (payload.get("candidate_name") or "").strip() or None
    candidate_link = (payload.get("candidate_link") or "").strip() or None
    notes = (payload.get("notes") or "").rstrip() or None
    amount = payload.get("amount")
    try:
        amount = float(amount) if amount not in (None, "", "null") else None
    except Exception:
        amount = None
    now = _now_iso()
    with _conn() as conn:
        cur = conn.cursor()
        if oid:
            cur.execute(
                '''
                UPDATE opportunities
                SET title=?, stage=?, candidate_name=?, candidate_link=?, amount=?, notes=?, updatedAt=?
                WHERE id=? AND company_id=?;
                ''',
                (title, stage, candidate_name, candidate_link, amount, notes, now, int(oid), int(cid)),
            )
            if cur.rowcount == 0:
                oid = None
        if not oid:
            cur.execute(
                '''
                INSERT INTO opportunities (company_id, title, stage, candidate_name, candidate_link, amount, notes, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                ''',
                (int(cid), title, stage, candidate_name, candidate_link, amount, notes, now, now),
            )
            oid = cur.lastrowid
    return jsonify({"ok": True, "id": oid})


@app.post("/api/opportunities/delete")
def api_opportunities_delete():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    oid = payload.get("id")
    if not oid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    with _conn() as conn:
        row = conn.execute("SELECT company_id FROM opportunities WHERE id=?;", (int(oid),)).fetchone()
        if row and conn.execute("SELECT id FROM companies WHERE id=? AND owner_id=?;", (row["company_id"], uid)).fetchone():
            conn.execute("DELETE FROM opportunities WHERE id=?;", (int(oid),))
    return jsonify({"ok": True})


# ====== Prospect quick actions (v6) ======
@app.post("/api/prospect/mark_done")
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


@app.post("/api/prospects/bulk-update")
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


@app.post("/api/prospects/bulk-field-update")
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


@app.post("/api/prospects/bulk-edit")
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


@app.post("/api/prospects/bulk-status-tags")
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


@app.post("/api/prospects/bulk-archive")
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


@app.post("/api/prospects/remove-tag-globally")
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


@app.post("/api/prospects/update-contacts")
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


@app.post("/api/ia-enrichment-log")
def api_ia_enrichment_log():
    """Log an IA enrichment event to the entity's timeline."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    etype = payload.get("type", "")  # prospect, candidate, company
    entity_id = payload.get("entity_id")
    fields_updated = payload.get("fields_updated", "")
    field_count = payload.get("field_count", 0)

    if not entity_id:
        return jsonify(ok=False, error="entity_id required"), 400
    try:
        entity_id_i = int(entity_id)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="entity_id invalide"), 400

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    title = f"Enrichissement IA — {field_count} champ(s)"
    content = f"Champs mis à jour : {fields_updated}"
    meta = json.dumps({"source": "ia_import", "field_count": field_count}, ensure_ascii=False)

    try:
        with _conn() as conn:
            if etype == "prospect":
                if not _prospect_owned(entity_id_i):
                    return jsonify(ok=False, error="Accès refusé"), 403
                conn.execute(
                    "INSERT INTO prospect_events (prospect_id, date, type, title, content, meta, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (entity_id_i, today, "ia_enrichment", title, content, meta, now),
                )
            elif etype == "company":
                if not _company_owned(entity_id_i):
                    return jsonify(ok=False, error="Accès refusé"), 403
                conn.execute(
                    "INSERT INTO company_events (company_id, date, type, title, content, meta, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (entity_id_i, today, "ia_enrichment", title, content, meta, now),
                )
            elif etype == "candidate":
                if not _candidate_owned(entity_id_i):
                    return jsonify(ok=False, error="Accès refusé"), 403
                # candidates n'ont pas encore de timeline dédiée
            else:
                return jsonify(ok=False, error="type invalide"), 400
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@app.post("/api/quickadd/parse-document")
def api_quickadd_parse_document():
    """Extrait le texte d'un PDF ou Word, envoie à Ollama pour identifier prospects/entreprises/candidats, renvoie une liste JSON."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if "file" not in request.files:
        return jsonify(ok=False, error="Fichier requis"), 400
    entity_type = (request.form.get("entity_type") or "prospect").strip().lower()
    if entity_type not in ("prospect", "company", "candidate"):
        entity_type = "prospect"
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify(ok=False, error="Aucun fichier"), 400
    ok_upload, err_upload = _validate_upload(f, "document")
    if not ok_upload:
        return jsonify(ok=False, error=err_upload[0]), err_upload[1]
    ext = os.path.splitext(f.filename)[1].lower()

    raw = f.read()
    text = ""
    try:
        if ext == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(BytesIO(raw))
            parts = []
            for page in reader.pages:
                parts.append(page.extract_text() or "")
            text = "\n".join(parts)
        elif ext in (".doc", ".docx"):
            from docx import Document
            doc = Document(BytesIO(raw))
            text = "\n".join(p.text for p in doc.paragraphs)
            for table in doc.tables:
                for row in table.rows:
                    text += "\n" + "\t".join(cell.text.strip() for cell in row.cells)
    except Exception as e:
        logger.exception("Parse document failed: %s", e)
        return jsonify(ok=False, error=f"Impossible de lire le document: {e}"), 400

    text = (text or "").strip()
    if not text or len(text) < 20:
        return jsonify(ok=False, error="Aucun texte extrait ou document trop court."), 400

    # Limiter la taille pour Ollama (éviter timeout)
    if len(text) > 25000:
        text = text[:25000] + "\n[... texte tronqué ...]"

    if entity_type == "prospect":
        prompt = """Tu dois extraire une liste de prospects (contacts B2B : nom, fonction, entreprise, téléphone, email, LinkedIn, notes) à partir du texte ci-dessous.
Retourne UNIQUEMENT un tableau JSON valide, sans texte avant ou après. Chaque élément doit avoir : name (ou nom), fonction (ou function), _company_name (ou entreprise, company), telephone (ou phone), email, linkedin, notes.
Exemple : [{"name":"Jean Dupont","fonction":"Directeur R&D","_company_name":"Acme","telephone":"06...","email":"jean@acme.fr","linkedin":"","notes":""}]
Texte :
"""
    elif entity_type == "company":
        prompt = """Tu dois extraire une liste d'entreprises (nom, site/ville, téléphone, secteur, notes) à partir du texte ci-dessous.
Retourne UNIQUEMENT un tableau JSON valide, sans texte avant ou après. Chaque élément : groupe (ou name, nom), site (ou city), phone (ou telephone), industry (ou sector), notes, tags (tableau de chaînes).
Exemple : [{"groupe":"Acme SA","site":"Paris","phone":"","industry":"Tech","notes":"","tags":[]}]
Texte :
"""
    else:
        prompt = """Tu dois extraire une liste de candidats (nom, rôle, localisation, LinkedIn, téléphone, email, compétences, notes) à partir du texte ci-dessous (CV, liste de profils, etc.).
Retourne UNIQUEMENT un tableau JSON valide, sans texte avant ou après. Chaque élément : name (ou nom), role, location (ou localisation), linkedin, phone (ou telephone), email, skills (tableau de chaînes), sector, notes.
Exemple : [{"name":"Marie Martin","role":"Ingénieur","location":"Lyon","linkedin":"","phone":"","email":"","skills":["Python","Java"],"notes":""}]
Texte :
"""
    prompt += text

    try:
        timeout = min(180, OLLAMA_TIMEOUT + 60)
        raw_response = _call_ai(prompt, timeout=timeout)
        match = re.search(r"\[[\s\S]*\]", raw_response)
        if not match:
            return jsonify(ok=False, error="L'IA n'a pas renvoyé de liste valide. Essayez un modèle plus puissant ou importez en Excel/CSV."), 400
        items = json.loads(match.group(0))
        if not isinstance(items, list):
            items = [items]
        return jsonify(ok=True, items=items, entity_type=entity_type)
    except urllib.error.URLError as e:
        logger.warning("AI unreachable (parse-document): %s", e)
        return jsonify(ok=False, error="IA indisponible. Vérifiez la configuration dans Paramètres > Configuration IA."), 503
    except json.JSONDecodeError as e:
        logger.warning("AI invalid JSON (parse-document): %s", e)
        return jsonify(ok=False, error="Réponse IA invalide (modèle peut-être trop léger). Essayez un modèle plus puissant ou importez en Excel/CSV."), 400
    except Exception as e:
        logger.exception("quickadd parse-document failed: %s", e)
        return jsonify(ok=False, error=str(e)), 500


def _sse_message(event: str, data: Any) -> str:
    """Format one SSE message (event + data). data can be dict (will be JSON-encoded) or str."""
    payload = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else str(data)
    return f"event: {event}\ndata: {payload}\n\n"


@app.post("/api/quickadd/parse-document-stream")
def api_quickadd_parse_document_stream():
    """Like parse-document but streams SSE: phase (upload, extract, ollama), then token events, then done with items.
    Allows the client to show live progress. File must be in request.files['file'], entity_type in form."""
    uid = _uid()
    if not uid:
        return Response(_sse_message("error", {"message": "Non authentifié"}), status=401, mimetype="text/event-stream")
    if "file" not in request.files:
        return Response(_sse_message("error", {"message": "Fichier requis"}), status=400, mimetype="text/event-stream")
    entity_type = (request.form.get("entity_type") or "prospect").strip().lower()
    if entity_type not in ("prospect", "company", "candidate"):
        entity_type = "prospect"
    f = request.files["file"]
    if not f or not f.filename:
        return Response(_sse_message("error", {"message": "Aucun fichier"}), status=400, mimetype="text/event-stream")
    ok_upload, err_upload = _validate_upload(f, "document")
    if not ok_upload:
        return Response(_sse_message("error", {"message": err_upload[0]}), status=err_upload[1], mimetype="text/event-stream")
    ext = os.path.splitext(f.filename)[1].lower()

    def generate():
        try:
            yield _sse_message("phase", {"step": "extract", "label": "Extraction du document…"})
            raw = f.read()
            text = ""
            if ext == ".pdf":
                from pypdf import PdfReader
                reader = PdfReader(BytesIO(raw))
                text = "\n".join((p.extract_text() or "") for p in reader.pages)
            elif ext in (".doc", ".docx"):
                from docx import Document
                doc = Document(BytesIO(raw))
                text = "\n".join(p.text for p in doc.paragraphs)
                for table in doc.tables:
                    for row in table.rows:
                        text += "\n" + "\t".join(cell.text.strip() for cell in row.cells)
            text = (text or "").strip()
            if not text or len(text) < 20:
                yield _sse_message("error", {"message": "Aucun texte extrait ou document trop court."})
                return
            if len(text) > 25000:
                text = text[:25000] + "\n[... texte tronqué ...]"

            if entity_type == "prospect":
                prompt = """Tu dois extraire une liste de prospects (contacts B2B : nom, fonction, entreprise, téléphone, email, LinkedIn, notes) à partir du texte ci-dessous.
Retourne UNIQUEMENT un tableau JSON valide, sans texte avant ou après. Chaque élément doit avoir : name (ou nom), fonction (ou function), _company_name (ou entreprise, company), telephone (ou phone), email, linkedin, notes.
Exemple : [{"name":"Jean Dupont","fonction":"Directeur R&D","_company_name":"Acme","telephone":"06...","email":"jean@acme.fr","linkedin":"","notes":""}]
Texte :
"""
            elif entity_type == "company":
                prompt = """Tu dois extraire une liste d'entreprises (nom, site/ville, téléphone, secteur, notes) à partir du texte ci-dessous.
Retourne UNIQUEMENT un tableau JSON valide, sans texte avant ou après. Chaque élément : groupe (ou name, nom), site (ou city), phone (ou telephone), industry (ou sector), notes, tags (tableau de chaînes).
Exemple : [{"groupe":"Acme SA","site":"Paris","phone":"","industry":"Tech","notes":"","tags":[]}]
Texte :
"""
            else:
                prompt = """Tu dois extraire une liste de candidats (nom, rôle, localisation, LinkedIn, téléphone, email, compétences, notes) à partir du texte ci-dessous (CV, liste de profils, etc.).
Retourne UNIQUEMENT un tableau JSON valide, sans texte avant ou après. Chaque élément : name (ou nom), role, location (ou localisation), linkedin, phone (ou telephone), email, skills (tableau de chaînes), sector, notes.
Exemple : [{"name":"Marie Martin","role":"Ingénieur","location":"Lyon","linkedin":"","phone":"","email":"","skills":["Python","Java"],"notes":""}]
Texte :
"""
            prompt += text

            config = _load_ai_config()
            provider_label = "Groq" if config.get("provider") == "groq" else "Ollama"
            yield _sse_message("phase", {"step": "ollama", "label": f"Analyse par l'IA ({provider_label})…"})
            timeout = min(180, OLLAMA_TIMEOUT + 60)
            full_response = []
            for sse_line in _stream_ai_sse(prompt, None, timeout):
                if not sse_line.startswith("data: "):
                    continue
                data_str = sse_line.strip().removeprefix("data: ").strip()
                if not data_str:
                    continue
                try:
                    evt = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
                if evt.get("type") == "token":
                    token_text = evt.get("text", "")
                    if token_text:
                        full_response.append(token_text)
                        yield _sse_message("token", {"text": token_text})
                elif evt.get("type") == "error":
                    yield _sse_message("error", {"message": evt.get("message", "Erreur IA")})
                    return
            raw_response = "".join(full_response)
            match = re.search(r"\[[\s\S]*\]", raw_response)
            if not match:
                yield _sse_message("error", {
                    "message": "L'IA n'a pas renvoyé de liste valide. Essayez un modèle plus puissant ou importez en Excel/CSV."
                })
                return
            try:
                items = json.loads(match.group(0))
            except json.JSONDecodeError:
                yield _sse_message("error", {"message": "Réponse IA invalide. Essayez un modèle plus puissant ou importez en Excel/CSV."})
                return
            if not isinstance(items, list):
                items = [items]
            yield _sse_message("done", {"items": items, "entity_type": entity_type})
        except urllib.error.URLError as e:
            logger.warning("AI unreachable (parse-document-stream): %s", e)
            yield _sse_message("error", {
                "message": "IA indisponible. Vérifiez la configuration dans Paramètres > Configuration IA."
            })
        except Exception as e:
            logger.exception("quickadd parse-document-stream failed: %s", e)
            yield _sse_message("error", {"message": str(e)})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# /api/ollama/generate, /generate-stream, /api/ai/config, /api/ai/test
# — déplacés dans routes/ai.py

# ═══════════════════════════════════════════════════════════════════
# v25.8: Intégration automatique des tags dans l'arbre des métiers via Ollama
# ═══════════════════════════════════════════════════════════════════
_TAG_INTEGRATION_CACHE_FILE = APP_DIR / "data" / "tag_integrations.json"

def _load_tag_integrations() -> Dict[str, Dict[str, Any]]:
    """Charge le cache des intégrations de tags."""
    if _TAG_INTEGRATION_CACHE_FILE.exists():
        try:
            with open(_TAG_INTEGRATION_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning("Erreur chargement cache intégrations tags: %s", e)
    return {}

def _save_tag_integrations(cache: Dict[str, Dict[str, Any]]):
    """Sauvegarde le cache des intégrations de tags."""
    try:
        _TAG_INTEGRATION_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_TAG_INTEGRATION_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error("Erreur sauvegarde cache intégrations tags: %s", e)

@app.post("/api/metiers/integrate-tags")
def api_metiers_integrate_tags():
    """Intègre automatiquement des tags manquants dans l'arbre des métiers via Ollama.
    
    Phase 1 amélioré : utilise aussi la similarité sémantique pour trouver les meilleures correspondances.
    
    Reçoit: { "tags": ["tag1", "tag2"], "context": { "company": "...", "fonction": "...", "linkedin": "..." } }
    Retourne: { "ok": true, "integrations": { "tag1": { "category": "...", "specialty": "...", "techCategory": "...", "similarity": 0.85 } } }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    payload = request.get_json(force=True, silent=True) or {}
    tags = payload.get("tags", [])
    context = payload.get("context", {})
    
    if not tags or not isinstance(tags, list):
        return jsonify(ok=False, error="Liste de tags requise"), 400
    
    cache = _load_tag_integrations()
    results = {}
    
    # Structure des métiers pour le prompt Ollama
    metiers_structure_detailed = """Ingénierie Logicielle:
  - Logiciel applicatif
  - Test / Validation / Qualification logicielle
  - Logiciels embarqués / Systèmes embarqués / IoT
  - Data Science / ML / Deep Learning / Vision
  - DevOps / Infrastructure / Cloud
  - Gestion de projet logiciel / Scrum Master
  - Développement Web / Fullstack

Ingénierie Électronique:
  - Électronique analogique
  - Électronique numérique
  - Électronique de puissance
  - Génie électrique / Électrotechnique
  - Industrialisation
  - FPGA / ASIC / SoC

Ingénierie Système:
  - Mécatronique / Robotique
  - Model Based Design (MBD)
  - Safety / Sûreté de fonctionnement
  - Contrôle commande / Automatique
  - Simulation multiphysique / Modélisation
  - Mécanique
  - Système (ingénierie système)
  - Test / Validation / Essais système

Life Science:
  - Qualification d'équipements (Pharma & DM)
  - Validation de systèmes automatisés (VSA)
  - Validation de systèmes d'informations (VSI)
  - Validation de produits (Dispositifs Médicaux)"""
    
    # Liste des catégories de tech possibles
    tech_categories = [
        "Langages", "Systèmes", "IDE", "Bases de données", "Méthodologies",
        "Outils", "Librairies", "Protocoles", "Microcontrôleurs", "Capteurs",
        "Frameworks", "Matériel", "Outils CAO", "Serveurs", "Secteurs"
    ]
    
    for tag in tags:
        tag_lower = tag.lower().strip()
        
        # Vérifier le cache
        if tag_lower in cache:
            results[tag] = cache[tag_lower]
            continue
        
        # Construire le prompt pour Ollama
        context_str = ""
        if context.get("company"):
            context_str += f"Entreprise: {context['company']}. "
        if context.get("fonction"):
            context_str += f"Poste: {context['fonction']}. "
        if context.get("linkedin"):
            context_str += f"LinkedIn disponible. "
        
        prompt = f"""Tu es un expert en classification de compétences techniques pour l'ingénierie.

Contexte du prospect: {context_str}

Tag à classer: "{tag}"

Arbre des métiers disponible:
{metiers_structure_detailed}

Catégories de technologies possibles: {', '.join(tech_categories)}

Instructions:
1. Analyse le tag "{tag}" dans le contexte donné
2. Identifie la catégorie métier (Ingénierie Logicielle, Ingénierie Électronique, Ingénierie Système, ou Life Science)
3. Identifie la spécialité la plus appropriée dans cette catégorie
4. Identifie la catégorie de technologie la plus appropriée

Réponds UNIQUEMENT avec un JSON valide au format suivant (sans markdown, sans code block):
{{"category": "Nom exact de la catégorie métier", "specialty": "Nom exact de la spécialité", "techCategory": "Catégorie de technologie la plus appropriée", "reasoning": "Explication courte (1 phrase)"}}

Si le tag ne correspond clairement à aucun métier, réponds avec {{"category": null, "reasoning": "..."}}."""
        
        # Phase 1: Essayer d'abord la similarité sémantique avec les tags du référentiel
        # Charger tous les tags du référentiel depuis metiers-data.js (via import ou lecture)
        # Pour l'instant, on utilise Ollama directement mais on pourrait améliorer avec embeddings
        
        try:
            response_text = _call_ai(prompt, timeout=60)
            
            # Extraire le JSON de la réponse (gérer les blocs de code markdown)
            json_block = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response_text, re.DOTALL)
            if json_block:
                response_text = json_block.group(1)
            else:
                # Chercher directement un objet JSON
                json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', response_text, re.DOTALL)
                if json_match:
                    response_text = json_match.group(0)
            
            try:
                integration = json.loads(response_text)
                if integration.get("category") and integration.get("specialty") and integration.get("category") != "null":
                    # Phase 1: Calculer similarité avec tags référentiel (optionnel, pour info)
                    # On pourrait améliorer en comparant avec les tags existants dans la spécialité trouvée
                    cache[tag_lower] = integration
                    results[tag] = integration
                else:
                    results[tag] = {"category": None, "reason": "Tag non classable selon Ollama"}
            except json.JSONDecodeError:
                results[tag] = {"category": None, "reason": "Réponse Ollama invalide (JSON non parsable)"}
        except urllib.error.URLError:
            results[tag] = {"category": None, "reason": "Ollama indisponible"}
        except Exception as e:
            logger.warning("Erreur intégration tag %s: %s", tag, e)
            results[tag] = {"category": None, "reason": str(e)}
    
    # Sauvegarder le cache
    if results:
        _save_tag_integrations(cache)
    
    return jsonify(ok=True, integrations=results)


@app.get("/api/metiers/integrations-cache")
def api_metiers_integrations_cache():
    """Retourne le cache des intégrations de tags."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    cache = _load_tag_integrations()
    return jsonify(ok=True, integrations=cache)


# ═══════════════════════════════════════════════════════════════════
# Post-update validation — rollback automatique si non confirmé en 3 min
# ═══════════════════════════════════════════════════════════════════
_VALIDATION_TIMER: threading.Timer | None = None
_VALIDATION_LOCK = threading.Lock()
_VALIDATION_TIMEOUT_SECONDS = 180  # 3 minutes


def _write_pending_validation(previous_commit_full: str) -> None:
    """Écrit .pending_validation avant le restart post-pull."""
    data = {
        "triggered_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "previous_commit": previous_commit_full,
        "timeout_seconds": _VALIDATION_TIMEOUT_SECONDS,
    }
    try:
        (APP_DIR / ".pending_validation").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )
        logger.info("Pending validation écrit (rollback vers %s si non confirmé dans %ds)",
                    previous_commit_full[:7], _VALIDATION_TIMEOUT_SECONDS)
    except Exception as e:
        logger.warning("Impossible d'écrire .pending_validation: %s", e)


def _auto_rollback_on_timeout() -> None:
    """Déclenché après 3 min sans confirmation — rollback automatique vers le commit précédent."""
    pv_file = APP_DIR / ".pending_validation"
    if not pv_file.exists():
        return  # Déjà confirmé ou annulé

    logger.warning("Validation timeout — rollback automatique déclenché")

    previous_commit = ""
    triggered_at = ""
    try:
        pv_data = json.loads(pv_file.read_text(encoding="utf-8"))
        previous_commit = pv_data.get("previous_commit", "")
        triggered_at = pv_data.get("triggered_at", "")
    except Exception:
        pass

    # Journal d'erreur détaillé
    error_log: dict = {
        "reason": "timeout",
        "message": "Aucune confirmation reçue dans les 3 minutes — rollback automatique",
        "triggered_at": triggered_at,
        "rollback_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "previous_commit": previous_commit[:7] if previous_commit else "unknown",
        "git_log": "",
    }
    try:
        cp_log = subprocess.run(
            ["git", "log", "--oneline", "-10"],
            cwd=str(APP_DIR), capture_output=True, text=True, timeout=5,
        )
        error_log["git_log"] = cp_log.stdout.strip()
    except Exception:
        pass

    try:
        (APP_DIR / ".validation_error_log").write_text(
            json.dumps(error_log, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as e:
        logger.error("Impossible d'écrire .validation_error_log: %s", e)

    try:
        pv_file.unlink(missing_ok=True)
    except Exception:
        pass

    # Rollback git vers le commit précédent
    if previous_commit:
        try:
            result = subprocess.run(
                ["git", "reset", "--hard", previous_commit],
                cwd=str(APP_DIR), capture_output=True, text=True, timeout=30,
            )
            logger.info("Rollback auto: git reset --hard %s → returncode=%d",
                        previous_commit[:7], result.returncode)
        except Exception as e:
            logger.error("Rollback auto git échoué: %s", e)

    _schedule_restart(delay=3.0)


def _start_validation_timer() -> None:
    """Lance le timer de validation (3 min avant rollback automatique)."""
    global _VALIDATION_TIMER
    with _VALIDATION_LOCK:
        if _VALIDATION_TIMER is not None:
            _VALIDATION_TIMER.cancel()
        _VALIDATION_TIMER = threading.Timer(_VALIDATION_TIMEOUT_SECONDS, _auto_rollback_on_timeout)
        _VALIDATION_TIMER.daemon = True
        _VALIDATION_TIMER.start()
    logger.info("Timer de validation démarré (%ds)", _VALIDATION_TIMEOUT_SECONDS)


def _cancel_validation_timer() -> None:
    """Annule le timer de validation (appelé quand l'utilisateur confirme)."""
    global _VALIDATION_TIMER
    with _VALIDATION_LOCK:
        if _VALIDATION_TIMER is not None:
            _VALIDATION_TIMER.cancel()
            _VALIDATION_TIMER = None
    logger.info("Timer de validation annulé (confirmation reçue)")


def _schedule_restart(delay: float = 10.0):
    """Restart after responding.

    - If launched via PROSPUP.bat (or _run_serveur.bat), it will restart on exit code 42.
    - If launched directly (python app.py), it spawns a new process then exits.
    - On Windows, the new process is detached to survive terminal closure (Cursor, etc.).

    Le délai permet aux clients (Cloudflare, navigateurs) de recevoir la réponse HTTP
    avant que le serveur ne redémarre, évitant les erreurs 502.
    """
    def _do():
        time.sleep(float(delay))
        launcher = (os.environ.get("PROSPUP_LAUNCHER") or "").strip().upper()
        if launcher == "BAT":
            logger.info("Restart: exit code 42 pour le superviseur")
            os._exit(42)
        try:
            import sys as _sys
            args = [_sys.executable] + _sys.argv
            logger.info("Restart: lancement nouveau processus: %s", " ".join(args))
            
            # Sur Windows, détacher le processus pour qu'il survive à la fermeture du terminal
            # (utile quand lancé depuis Cursor ou un terminal qui peut être fermé)
            creation_flags = 0
            if sys.platform == "win32":
                # CREATE_NEW_PROCESS_GROUP + DETACHED_PROCESS pour indépendance du terminal
                # Note: DETACHED_PROCESS peut ne pas être disponible sur toutes les versions
                try:
                    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
                except AttributeError:
                    # Fallback si DETACHED_PROCESS n'existe pas (anciennes versions Python)
                    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP
            
            proc = subprocess.Popen(
                args,
                cwd=str(APP_DIR),
                creationflags=creation_flags if sys.platform == "win32" else 0,
                # Sur Unix, utiliser start_new_session pour détacher du terminal
                start_new_session=(sys.platform != "win32")
            )
            time.sleep(2.0)
            logger.info("Restart: nouveau processus lancé (PID %d), arrêt de l'ancien serveur", proc.pid)
        except Exception as e:
            logger.error("Restart: erreur lors du lancement du nouveau processus: %s", e)
        os._exit(0)

    threading.Thread(target=_do, daemon=True).start()


# /api/deploy/pull, /restart, /health, /validation-status, /confirm-validation
# — déplacés dans routes/deploy.py


@app.route("/api/system/check-deployment", methods=["GET"])
def api_system_check_deployment():
    """Vérifie si le code de vérification système est déployé."""
    user = _get_current_user()
    if not user or user.get("role") != "admin":
        return jsonify(ok=False, error="Admin requis"), 403
    
    verify_script = APP_DIR / "scripts" / "verify_all.py"
    verify_script_exists = verify_script.exists()
    
    # Vérifier si la section est dans templates/parametres.html
    parametres_file = APP_DIR / "templates" / "parametres.html"
    has_section = False
    if parametres_file.exists():
        try:
            content = parametres_file.read_text(encoding="utf-8")
            has_section = "systemVerifySection" in content and "Vérification système" in content
        except Exception:
            pass
    
    # Vérifier aussi si le fichier existe à la racine (compatibilité)
    if not has_section:
        parametres_file_root = APP_DIR / "parametres.html"
        if parametres_file_root.exists():
            try:
                content = parametres_file_root.read_text(encoding="utf-8")
                has_section = "systemVerifySection" in content and "Vérification système" in content
            except Exception:
                pass
    
    # Vérifier si la fonction JS existe
    page_settings_file = APP_DIR / "static" / "js" / "page-settings.js"
    has_js_function = False
    if page_settings_file.exists():
        try:
            content = page_settings_file.read_text(encoding="utf-8")
            has_js_function = "runSystemVerify" in content
        except Exception:
            pass
    
    # Dernier commit et branche (pour affichage "version en ligne")
    last_commit = "unknown"
    commit_hash = "unknown"
    branch = "main"
    try:
        cp = subprocess.run(
            ["git", "log", "-1", "--oneline", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp.returncode == 0:
            last_commit = (cp.stdout or "").strip()[:50]
        cp2 = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp2.returncode == 0:
            commit_hash = (cp2.stdout or "").strip()[:7]
        cp3 = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp3.returncode == 0 and (cp3.stdout or "").strip():
            branch = (cp3.stdout or "").strip()
    except Exception:
        pass
    
    return jsonify(
        ok=True,
        verify_script_exists=verify_script_exists,
        html_section_exists=has_section,
        js_function_exists=has_js_function,
        all_deployed=verify_script_exists and has_section and has_js_function,
        last_commit=last_commit,
        version=APP_VERSION,
        commit_hash=commit_hash,
        branch=branch,
    )


@app.route("/api/system/logs", methods=["GET"])
def api_system_logs():
    """Retourne les dernières lignes du log serveur. Admin uniquement."""
    user = _get_current_user()
    if not user or user.get("role") != "admin":
        return jsonify(ok=False, error="Admin requis"), 403
    
    log_file = APP_DIR / "logs" / "prospup.log"
    lines = request.args.get("lines", 50, type=int)
    lines = min(max(10, lines), 500)  # Entre 10 et 500 lignes
    
    if not log_file.exists():
        return jsonify(ok=False, error="Fichier de log introuvable"), 404
    
    try:
        # Lire les dernières lignes du fichier
        with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()
            last_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
        
        return jsonify(
            ok=True,
            lines=last_lines,
            total_lines=len(all_lines),
            file_size=log_file.stat().st_size,
        )
    except Exception as e:
        logger.exception("Failed to read logs")
        return jsonify(ok=False, error=str(e)), 500


@app.post("/api/system/verify")
def api_system_verify():
    """Exécute le script de vérification système et retourne les résultats détaillés."""
    user = _get_current_user()
    if not user or user.get("role") != "admin":
        return jsonify(ok=False, error="Admin requis"), 403
    
    verify_script = APP_DIR / "scripts" / "verify_all.py"
    if not verify_script.exists():
        return jsonify(ok=False, error="Script de vérification introuvable"), 404
    
    try:
        # Exécuter le script avec capture de la sortie
        proc = subprocess.run(
            [sys.executable, str(verify_script)],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=60,
        )
        
        # Parser les résultats (le script utilise des exit codes)
        checks = {
            "git": {"ok": True, "message": "OK"},
            "ollama": {"ok": True, "message": "OK"},
            "flask": {"ok": True, "message": "OK"},
            "api_ollama": {"ok": True, "message": "OK"},
            "scripts": {"ok": True, "message": "OK"},
            "env": {"ok": True, "message": "OK"},
        }
        
        # Déterminer quel check a échoué selon l'exit code
        if proc.returncode == 1:
            checks["git"]["ok"] = False
            checks["git"]["message"] = proc.stderr or "Erreur Git (repo, branche ou pull)"
        elif proc.returncode == 2:
            checks["ollama"]["ok"] = False
            checks["ollama"]["message"] = proc.stderr or "Ollama inaccessible ou modèle introuvable"
        elif proc.returncode == 3:
            checks["flask"]["ok"] = False
            checks["flask"]["message"] = proc.stderr or "Flask ne répond pas"
        elif proc.returncode == 4:
            checks["api_ollama"]["ok"] = False
            checks["api_ollama"]["message"] = proc.stderr or "API Ollama via Flask en erreur (possible erreur 405)"
        elif proc.returncode == 5:
            checks["scripts"]["ok"] = False
            checks["scripts"]["message"] = proc.stderr or "Erreur dans les scripts Python"
        elif proc.returncode == 6:
            checks["env"]["ok"] = False
            checks["env"]["message"] = proc.stderr or "Variables d'environnement invalides"
        
        all_ok = proc.returncode == 0
        
        return jsonify(
            ok=all_ok,
            exit_code=proc.returncode,
            checks=checks,
            stdout=proc.stdout,
            stderr=proc.stderr,
        )
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="Timeout lors de l'exécution du script"), 504
    except Exception as e:
        logger.exception("System verify failed")
        return jsonify(ok=False, error=str(e)), 500


@app.route("/api/app-version", methods=["GET"])
def api_app_version():
    """Retourne la version de l'app, le hash du commit et la date du dernier commit pour affichage badge."""
    try:
        # Hash du commit actuel
        cp = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        commit_hash = (cp.stdout or "").strip()[:7] if cp.returncode == 0 else "unknown"
        
        # Date du dernier commit
        cp2 = subprocess.run(
            ["git", "log", "-1", "--format=%ci", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        commit_date = (cp2.stdout or "").strip() if cp2.returncode == 0 else ""
        
        # Branche actuelle (ex. main)
        cp3 = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        branch = (cp3.stdout or "").strip() or "main"
        
        # Générer une couleur basée sur le hash (pour changement visuel)
        if commit_hash != "unknown":
            # Utiliser les 6 premiers caractères du hash pour générer une couleur
            hash_int = int(commit_hash[:6], 16) if len(commit_hash) >= 6 else 0
            # Palette de couleurs vives mais lisibles
            colors = [
                "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
                "#ec4899", "#14b8a6", "#6366f1", "#f97316", "#06b6d4"
            ]
            color_index = hash_int % len(colors)
            badge_color = colors[color_index]
        else:
            badge_color = "#64748b"
        
        return jsonify(ok=True, version=APP_VERSION, commit_hash=commit_hash, commit_date=commit_date, branch=branch, badge_color=badge_color)
    except Exception as e:
        logger.warning("App version fetch error: %s", e)
        return jsonify(ok=True, version=APP_VERSION, commit_hash="unknown", commit_date="", branch="main", badge_color="#64748b")


@app.get("/api/health")
def api_health():
    """Health check endpoint. Sensitive details only for admins (v23.4)."""
    info: Dict[str, Any] = {"status": "ok", "version": APP_VERSION}
    is_admin = False
    user = _get_current_user()
    if user and user.get('role') == 'admin':
        is_admin = True

    _table_names = ("prospects", "companies", "push_logs", "candidates")
    try:
        with _conn() as con:
            cur = con.cursor()
            for tbl in _table_names:
                try:
                    info[f"{tbl}_count"] = int(cur.execute(
                        f"SELECT COUNT(*) FROM {tbl}"  # noqa: table names are hardcoded above
                    ).fetchone()[0])
                except Exception:
                    info[f"{tbl}_count"] = None
    except Exception as e:
        info["db_error"] = "unavailable"
        if is_admin:
            info["db_error_detail"] = str(e)

    # Only expose paths to admin users
    if is_admin:
        current_db = _current_user_db_path()
        info["db_path"] = str(current_db)
        info["db_exists"] = current_db.exists()
        info["per_user_db"] = str(current_db) != str(DB_PATH)

    return jsonify(info)

@app.get("/api/data")
def api_data():
    uid = _uid()
    if uid is None:
        return jsonify(ok=False, error="Non authentifié"), 401
    # v23.4: Optional pagination via ?page=&limit= query params
    page_param = request.args.get("page")
    limit_param = request.args.get("limit")
    if page_param is not None:
        # Paginated mode
        try:
            page = max(1, int(page_param))
            limit = min(500, max(1, int(limit_param or 200)))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="page/limit must be integers"), 400
        offset = (page - 1) * limit
        # v23.5: lazy=1 excludes heavy fields (callNotes, notes) for faster list loading
        lazy = request.args.get("lazy") == "1"
        with _conn() as conn:
            # Companies: always return all (typically small dataset)
            companies = [dict(r) for r in conn.execute(
                "SELECT * FROM companies WHERE owner_id=? AND deleted_at IS NULL ORDER BY id;", (uid,)
            ).fetchall()]
            # Prospects: paginated
            total = int(conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)
            ).fetchone()[0])
            prospects_rows = conn.execute(
                "SELECT * FROM prospects WHERE owner_id=? AND deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?;",
                (uid, limit, offset)
            ).fetchall()
            max_pid = int(conn.execute(
                "SELECT COALESCE(MAX(id), 0) FROM prospects WHERE owner_id=?;", (uid,)
            ).fetchone()[0])
            max_cid = int(conn.execute(
                "SELECT COALESCE(MAX(id), 0) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0])
        # Parse tags/callNotes
        from math import ceil
        for c in companies:
            t = c.get("tags")
            if t and isinstance(t, str):
                try:
                    c["tags"] = json.loads(t)
                except Exception:
                    c["tags"] = [x.strip() for x in t.split(",") if x.strip()]
            elif not t:
                c["tags"] = []
        prospects = []
        for r in prospects_rows:
            d = dict(r)
            if lazy:
                # v23.5: exclude heavy fields for list view performance
                d.pop("callNotes", None)
                d.pop("notes", None)
            else:
                try:
                    d["callNotes"] = json.loads(d.get("callNotes") or "[]")
                except Exception:
                    d["callNotes"] = []
            t = d.get("tags")
            if t and isinstance(t, str):
                try:
                    d["tags"] = json.loads(t)
                except Exception:
                    d["tags"] = [x.strip() for x in t.split(",") if x.strip()]
            elif not t:
                d["tags"] = []
            d["is_archived"] = int(d.get("is_archived") or 0)
            prospects.append(d)
        return jsonify({
            "companies": companies,
            "prospects": prospects,
            "maxProspectId": max_pid,
            "maxCompanyId": max_cid,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "pages": ceil(total / limit) if limit else 1,
            }
        })
    # Non-paginated mode (backward compatible)
    payload = read_all(owner_id=uid)
    with _conn() as conn:
        payload["maxProspectId"] = int(conn.execute(
            "SELECT COALESCE(MAX(id), 0) AS n FROM prospects WHERE owner_id=?;",
            (uid,),
        ).fetchone()["n"])
        payload["maxCompanyId"] = int(conn.execute(
            "SELECT COALESCE(MAX(id), 0) AS n FROM companies WHERE owner_id=?;",
            (uid,),
        ).fetchone()["n"])
    return jsonify(payload)


@app.post("/api/save")
def api_save():
    chk = _require_same_origin()
    if chk:
        return chk
    data, err = validate_payload({})
    if err:
        return err
    try:
        upsert_all(data)
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    except Exception as e:
        if app.config.get("TESTING"):
            err_msg = str(e) + "\n" + traceback.format_exc()
        else:
            err_msg = "Erreur lors de l'enregistrement."
        return jsonify(ok=False, error=err_msg), 500
    _auto_snapshot_if_needed()
    return jsonify({"ok": True})


def _excel_map_pertinence(val: str | None) -> str | None:
    if not val:
        return None
    s = str(val).strip()
    mapping = {
        "À contacter": "Pas d'actions",
        "A contacter": "Pas d'actions",
        "Appelé": "Appelé",
        "A rappeler": "À rappeler",
        "À rappeler": "À rappeler",
        "Rendez-vous": "Rendez-vous",
        "Prospecté": "Prospecté",
        "Messagerie": "Messagerie",
        "Pas intéressé": "Pas intéressé",
        "Pas interesse": "Pas intéressé",
    }
    return mapping.get(s, s)

def _excel_map_statut(val: str | None) -> str | None:
    if not val:
        return None
    s = str(val).strip()
    # Normaliser vers les libellés "simples" utilisés dans l'UI.
    mapping = {
        "À contacter": "Pas d'actions",
        "A contacter": "Pas d'actions",
        "□ Pas d'actions": "Pas d'actions",

        "Appelé": "Appelé",

        "A rappeler": "À rappeler",
        "À rappeler": "À rappeler",

        "Rendez-vous": "Rendez-vous",

        "Prospecté": "Prospecté",

        "Messagerie": "Messagerie",

        "Pas intéressé": "Pas intéressé",
        "Pas interesse": "Pas intéressé",
    }
    return mapping.get(s, s)

def _excel_cell_str(v):
    """Normalise les retours à la ligne pour Excel (évite \\r qui provoque décalages)."""
    if v is None or not isinstance(v, str):
        return v
    return v.replace("\r\n", "\n").replace("\r", "\n")


def _excel_concat_notes(prospect: dict) -> str | None:
    parts = []
    notes = (prospect.get("notes") or "").strip()
    if notes:
        parts.append(_excel_cell_str(notes))

    call_notes = prospect.get("callNotes") or []
    for n in call_notes:
        d = (n.get("date") or "").strip()
        c = (n.get("content") or "").strip()
        if not (d or c):
            continue
        if d and c:
            parts.append(f"{d} - {_excel_cell_str(c)}")
        else:
            parts.append(d or _excel_cell_str(c))
    out = "\n".join(parts).strip()
    return out or None


@app.get("/api/export/xlsx")
def api_export_xlsx():
    """Génère un fichier Excel à partir du template et des données SQLite (ligne entreprise + lignes prospects)."""
    from openpyxl import load_workbook

    if not TEMPLATE_PATH.exists():
        return jsonify({"ok": False, "error": "Template Excel introuvable"}), 500

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = read_all(owner_id=uid)
    companies = payload.get("companies") or []
    prospects = payload.get("prospects") or []

    # Index prospects par entreprise
    pros_by_company: dict[int, list[dict]] = {}
    for p in prospects:
        try:
            cid = int(p.get("company_id"))
        except Exception:
            continue
        pros_by_company.setdefault(cid, []).append(p)

    # Tri : entreprises par groupe/site, prospects par nom
    companies_sorted = sorted(
        companies,
        key=lambda c: (str(c.get("groupe", "")).lower(), str(c.get("site", "")).lower()),
    )
    for cid in list(pros_by_company.keys()):
        pros_by_company[cid] = sorted(pros_by_company[cid], key=lambda p: str(p.get("name", "")).lower())

    wb = load_workbook(TEMPLATE_PATH)
    ws = wb["Liste"]

    # Headers sur la ligne 1
    headers: dict[str, int] = {}
    for c in range(1, ws.max_column + 1):
        v = ws.cell(1, c).value
        if isinstance(v, str) and v.strip():
            headers[v.strip()] = c

    # Styles sources (dans votre template) : une ligne entreprise + une ligne prospect
    company_style_row = 3
    prospect_style_row = 4
    max_col = ws.max_column

    def _capture_row_style(src_row: int):
        style = {"height": ws.row_dimensions[src_row].height, "cells": []}
        for col in range(1, max_col + 1):
            c = ws.cell(src_row, col)
            style["cells"].append(
                {
                    "_style": copy(c._style),
                    "font": copy(c.font),
                    "fill": copy(c.fill),
                    "border": copy(c.border),
                    "alignment": copy(c.alignment),
                    "number_format": c.number_format,
                    "protection": copy(c.protection),
                }
            )
        return style

    company_style = _capture_row_style(company_style_row)
    prospect_style = _capture_row_style(prospect_style_row)

    def _apply_row_style(style, dst_row: int):
        ws.row_dimensions[dst_row].height = style.get("height")
        for col in range(1, max_col + 1):
            d = ws.cell(dst_row, col)
            st = style["cells"][col - 1]
            d._style = copy(st["_style"])
            d.font = copy(st["font"])
            d.fill = copy(st["fill"])
            d.border = copy(st["border"])
            d.alignment = copy(st["alignment"])
            d.number_format = st["number_format"]
            d.protection = copy(st["protection"])
            d.comment = None

    def set_cell(row: int, header: str, value):
        col = headers.get(header)
        if not col:
            return
        if isinstance(value, str):
            value = _excel_cell_str(value)
        ws.cell(row, col).value = value

    def parse_date(iso: str | None):
        if not iso:
            return None
        try:
            return datetime.datetime.strptime(iso[:10], "%Y-%m-%d").date()
        except Exception:
            return None

    # Nettoyer anciennes données (garder lignes 1-2 du template)
    start_row = 3
    if ws.max_row >= start_row:
        ws.delete_rows(start_row, ws.max_row - start_row + 1)

    current_row = start_row

    for comp in companies_sorted:
        cid = int(comp["id"])

        # Ligne entreprise
        ws.insert_rows(current_row)
        _apply_row_style(company_style, current_row)
        set_cell(current_row, "GROUPE", comp.get("groupe"))
        set_cell(current_row, "SITE", comp.get("site"))
        set_cell(current_row, "TEL", comp.get("phone"))
        current_row += 1

        # Lignes prospects
        for p in pros_by_company.get(cid, []):
            ws.insert_rows(current_row)
            _apply_row_style(prospect_style, current_row)
            set_cell(current_row, "NOM", p.get("name"))
            set_cell(current_row, "TEL", p.get("telephone"))
            set_cell(current_row, "FONCTION", p.get("fonction"))
            set_cell(current_row, "PERTINENCE", _excel_map_pertinence(p.get("pertinence")))
            set_cell(current_row, "STATUT", _excel_map_statut(p.get("statut")))
            set_cell(current_row, "DATE DERNIER CONTACT", parse_date(p.get("lastContact")))
            set_cell(current_row, "COMMENTAIRE", _excel_concat_notes(p))
            set_cell(current_row, "MAIL", p.get("email"))
            set_cell(current_row, "LINKEDIN_URL", p.get("linkedin"))
            current_row += 1

    # Sauvegarde en mémoire et téléchargement
    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    filename = f"Prospects_export_{datetime.date.today().isoformat()}.xlsx"
    return send_file(
        bio,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

# ────────────────────────────────────────────────────────────────────
# Export "Ma journée" (P7) – récap du jour pour téléchargement
# ────────────────────────────────────────────────────────────────────

@app.get("/api/export/day")
def api_export_day():
    """Return a JSON recap of the day (contacts, notes, push, overdue, due_today) for download."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    date_str = request.args.get("date", "").strip() or _today_iso()
    try:
        datetime.date.fromisoformat(date_str)
    except Exception:
        date_str = _today_iso()

    with _conn() as conn:
        prospects = [dict(r) for r in conn.execute("SELECT * FROM prospects WHERE owner_id=?;", (uid,)).fetchall()]
        push_logs = [dict(r) for r in conn.execute(
            "SELECT * FROM push_logs WHERE prospect_id IN (SELECT id FROM prospects WHERE owner_id=?);",
            (uid,),
        ).fetchall()]
        try:
            note_events = [dict(r) for r in conn.execute(
                """SELECT e.date, e.content, e.prospect_id, p.name AS prospect_name
                   FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id
                   WHERE p.owner_id=? AND e.type IN ('note','note_libre','call_note');""",
                (uid,),
            ).fetchall()]
        except Exception:
            note_events = []

    all_notes = []
    for p in prospects:
        try:
            notes = json.loads(p.get("callNotes") or "[]")
            for n in (notes if isinstance(notes, list) else []):
                n["_pid"] = p["id"]
                n["_name"] = p.get("name", "")
                all_notes.append(n)
        except Exception:
            pass
    for ne in note_events:
        all_notes.append({
            "date": ne.get("date") or "",
            "content": ne.get("content") or "",
            "_pid": ne.get("prospect_id"),
            "_name": ne.get("prospect_name") or "",
        })

    contacts_today = [p for p in prospects if (p.get("lastContact") or "").strip() == date_str]
    notes_today = [n for n in all_notes if (n.get("date") or "")[:10] == date_str]
    push_today = [pl for pl in push_logs if (pl.get("sentAt") or "")[:10] == date_str]
    overdue = [p for p in prospects if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < date_str]
    due_today = [p for p in prospects if (p.get("nextFollowUp") or "").strip() == date_str]

    recap = {
        "date": date_str,
        "relances_count": len(contacts_today),
        "relances": [{"id": p["id"], "name": p.get("name"), "company_id": p.get("company_id")} for p in contacts_today],
        "notes_count": len(notes_today),
        "notes": [{"prospect_id": n.get("_pid"), "prospect_name": n.get("_name"), "date": n.get("date"), "content": (n.get("content") or "")[:200]} for n in notes_today],
        "push_count": len(push_today),
        "push": [{"prospect_id": pl.get("prospect_id"), "subject": pl.get("subject"), "to_email": pl.get("to_email"), "sentAt": pl.get("sentAt")} for pl in push_today],
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
    }
    return jsonify(ok=True, recap=recap)


# ────────────────────────────────────────────────────────────────────
# Rapport hebdomadaire – export markdown / copie OneNote
# ────────────────────────────────────────────────────────────────────

@app.get("/rapport")
def page_rapport():
    return redirect("/v30/rapport", code=302)


@app.get("/api/rapport-hebdo")
def api_rapport_hebdo():
    """Generate a weekly report with KPIs, activity, and pipeline summary."""
    # Determine week: defaults to current, or ?week=2026-W07
    week_param = request.args.get("week", "").strip()
    today = _today_iso()
    d_today = datetime.date.fromisoformat(today)

    if week_param:
        # Parse ISO week like 2026-W07
        try:
            year, w = week_param.split("-W")
            year, w = int(year), int(w)
            # Monday of that week
            jan4 = datetime.date(year, 1, 4)
            start_of_w1 = jan4 - datetime.timedelta(days=jan4.isoweekday() - 1)
            monday = start_of_w1 + datetime.timedelta(weeks=w - 1)
            sunday = monday + datetime.timedelta(days=6)
        except Exception:
            monday = d_today - datetime.timedelta(days=d_today.weekday())
            sunday = monday + datetime.timedelta(days=6)
    else:
        monday = d_today - datetime.timedelta(days=d_today.weekday())
        sunday = monday + datetime.timedelta(days=6)

    start = monday.isoformat()
    end = sunday.isoformat()
    week_label = f"S{monday.isocalendar()[1]} — {start} → {end}"

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        prospects = [dict(r) for r in conn.execute("SELECT * FROM prospects WHERE owner_id=?;", (uid,)).fetchall()]
        push_logs = [dict(r) for r in conn.execute(
            "SELECT * FROM push_logs WHERE prospect_id IN (SELECT id FROM prospects WHERE owner_id=?);",
            (uid,),
        ).fetchall()]
        companies = [dict(r) for r in conn.execute("SELECT * FROM companies WHERE owner_id=?;", (uid,)).fetchall()]
        try:
            calls_row = conn.execute(
                "SELECT COUNT(*) AS n FROM call_logs WHERE owner_id=? AND date>=? AND date<=?;",
                (uid, start, end),
            ).fetchone()
            calls_count = int(calls_row["n"]) if calls_row else 0
        except Exception:
            calls_count = 0
        try:
            note_events = [dict(r) for r in conn.execute(
                """SELECT e.date, e.content, e.prospect_id, p.name AS prospect_name,
                          p.statut AS prospect_statut, p.company_id AS prospect_company_id
                   FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id
                   WHERE p.owner_id=? AND e.type IN ('note','note_libre','call_note');""",
                (uid,),
            ).fetchall()]
        except Exception:
            note_events = []

    # Parse call notes (callNotes JSON + prospect_events de type note)
    all_notes = []
    for p in prospects:
        try:
            notes = json.loads(p.get("callNotes") or "[]")
            for n in (notes if isinstance(notes, list) else []):
                n["_pid"] = p["id"]
                n["_pname"] = p.get("name", "")
                n["_statut"] = p.get("statut", "")
                n["_company_id"] = p.get("company_id")
                all_notes.append(n)
        except Exception:
            pass
    for ne in note_events:
        all_notes.append({
            "date": ne.get("date") or "",
            "content": ne.get("content") or "",
            "_pid": ne.get("prospect_id"),
            "_pname": ne.get("prospect_name") or "",
            "_statut": ne.get("prospect_statut") or "",
            "_company_id": ne.get("prospect_company_id"),
        })

    week_notes = [n for n in all_notes if start <= (n.get("date") or "")[:10] <= end]
    week_push = [pl for pl in push_logs if start <= (pl.get("sentAt") or "")[:10] <= end]
    week_relances = [p for p in prospects if start <= (p.get("lastContact") or "") <= end]

    push_email = sum(1 for pl in week_push if pl.get("channel") == "email")
    push_linkedin = sum(1 for pl in week_push if pl.get("channel") == "linkedin")

    # Status snapshot (BUG 17 : on regroupe les statuts vides sous "Autre" et on filtre les archivés/supprimés)
    statuts = {}
    for p in prospects:
        if p.get("deleted_at") or p.get("is_archived"):
            continue
        s = (p.get("statut") or "").strip()
        if not s or s.lower() == "inconnu":
            s = "Autre"
        statuts[s] = statuts.get(s, 0) + 1

    rdv_count = statuts.get("Rendez-vous", 0)
    total = len(prospects)

    # Overdue
    overdue = [p for p in prospects if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < today]

    # New contacts this week (lastContact in range AND not before)
    new_relances_count = len(week_relances)

    # Companies touched this week + stats par entreprise
    prospects_by_id = {p["id"]: p for p in prospects}
    companies_map = {c["id"]: c for c in companies}

    week_company_ids = set()
    for n in week_notes:
        cid = n.get("_company_id")
        if cid:
            week_company_ids.add(cid)
    for pl in week_push:
        pid = pl.get("prospect_id")
        p = prospects_by_id.get(pid)
        if p:
            week_company_ids.add(p.get("company_id"))

    # Compter pushs et relances par company_id pour la semaine
    company_push_counts: dict = {}
    for pl in week_push:
        p = prospects_by_id.get(pl.get("prospect_id"))
        if p and p.get("company_id"):
            cid = p["company_id"]
            company_push_counts[cid] = company_push_counts.get(cid, 0) + 1

    company_relance_counts: dict = {}
    for p in week_relances:
        cid = p.get("company_id")
        if cid:
            company_relance_counts[cid] = company_relance_counts.get(cid, 0) + 1

    def _company_name(cid):
        c = companies_map.get(cid, {})
        return c.get("groupe") or c.get("site") or f"ID {cid}"

    top_companies = sorted(
        [
            {
                "name": _company_name(cid),
                "pushs": company_push_counts.get(cid, 0),
                "prospects": company_relance_counts.get(cid, 0),
            }
            for cid in week_company_ids if cid
        ],
        key=lambda x: -(x["pushs"] + x["prospects"]),
    )[:15]

    # Activity detail (BUG 16 : on inclut prospect_name partout)
    notes_detail = [{
        "prospect_id": n.get("_pid"),
        "prospect_name": n.get("_pname", ""),
        "name": n.get("_pname", ""),
        "statut": n.get("_statut", ""),
        "content": (n.get("content") or "")[:150],
        "date": n.get("date", ""),
    } for n in sorted(week_notes, key=lambda x: x.get("date", ""))]

    push_detail = [{
        "channel": pl.get("channel", ""),
        "date": (pl.get("sentAt") or "")[:10],
        "prospect_id": pl.get("prospect_id"),
        "prospect_name": (prospects_by_id.get(pl.get("prospect_id"), {}) or {}).get("name", ""),
    } for pl in sorted(week_push, key=lambda x: x.get("sentAt", ""))]

    # Conversion rate
    conversion_pct = round((rdv_count / total) * 100, 1) if total else 0

    return jsonify(ok=True, data={
        "week_label": week_label,
        "start": start,
        "end": end,
        "kpi": {
            "relances": new_relances_count,
            "notes": len(week_notes),
            "push_total": len(week_push),
            "push_email": push_email,
            "push_linkedin": push_linkedin,
            "rdv": rdv_count,
            "overdue": len(overdue),
            "conversion_pct": conversion_pct,
            "total_prospects": total,
            "companies_touched": len(top_companies),
            "calls": calls_count,
        },
        "statuts": statuts,
        "top_companies": top_companies,
        "touched_companies": [c["name"] for c in top_companies],
        "notes_detail": notes_detail[:20],
        "push_detail": push_detail[:20],
    })


# ────────────────────────────────────────────────────────────────────
# Custom Métiers – ajout de compétences / spécialités / catégories
# ────────────────────────────────────────────────────────────────────

@app.get("/api/custom_metiers")
def api_custom_metiers_list():
    try:
        with _conn() as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS custom_metiers (
                id INTEGER PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL,
                specialty TEXT, tech_group TEXT, value TEXT NOT NULL, createdAt TEXT)''')
            rows = conn.execute("SELECT * FROM custom_metiers ORDER BY category, specialty, tech_group, value").fetchall()
            items = [dict(r) for r in rows]
        return jsonify(ok=True, items=items)
    except Exception as exc:
        logger.exception("Erreur api_custom_metiers_list")
        return jsonify(ok=False, error=str(exc)), 500


@app.post("/api/custom_metiers")
def api_custom_metiers_add():
    d = request.get_json(force=True)
    tp = d.get("type", "tech")  # tech | specialty | category | sector
    cat = (d.get("category") or "").strip()
    spec = (d.get("specialty") or "").strip() or None
    tg = (d.get("tech_group") or "").strip() or None
    val = d.get("value", "").strip()
    if not val:
        return jsonify(ok=False, error="value required"), 400
    now = datetime.datetime.now().isoformat(timespec="seconds")
    try:
        with _conn() as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS custom_metiers (
                id INTEGER PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL,
                specialty TEXT, tech_group TEXT, value TEXT NOT NULL, createdAt TEXT)''')
            # Check duplicate
            existing = conn.execute(
                "SELECT id FROM custom_metiers WHERE type=? AND category=? AND value=?",
                (tp, cat, val)
            ).fetchone()
            if existing:
                return jsonify(ok=False, error="duplicate"), 409
            conn.execute(
                "INSERT INTO custom_metiers (type, category, specialty, tech_group, value, createdAt) VALUES (?,?,?,?,?,?)",
                (tp, cat, spec, tg, val, now)
            )
        return jsonify(ok=True)
    except Exception as exc:
        logger.exception("Erreur api_custom_metiers_add")
        return jsonify(ok=False, error=str(exc)), 500


@app.delete("/api/custom_metiers/<int:item_id>")
def api_custom_metiers_delete(item_id):
    try:
        with _conn() as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS custom_metiers (
                id INTEGER PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL,
                specialty TEXT, tech_group TEXT, value TEXT NOT NULL, createdAt TEXT)''')
            conn.execute("DELETE FROM custom_metiers WHERE id=?", (item_id,))
        return jsonify(ok=True)
    except Exception as exc:
        logger.exception("Erreur api_custom_metiers_delete")
        return jsonify(ok=False, error=str(exc)), 500


# ═══════════════════════════════════════════════════════════════════
# v27.21 : Gestion des tags non référencés — classification IA batch
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/prospects/tags-count")
def api_prospects_tags_count():
    """Retourne tous les tags utilisés dans les prospects avec leur nombre d'occurrences.
    Triés par count décroissant.
    Retourne: { "ok": true, "tags": [{"tag": "Python", "count": 12}, ...] }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    counts = {}
    try:
        with _conn() as conn:
            rows = conn.execute(
                "SELECT tags FROM prospects WHERE owner_id=?",
                (uid,)
            ).fetchall()
        for row in rows:
            for tag in _parse_tags(row["tags"]):
                key = tag.strip()
                if key:
                    counts[key] = counts.get(key, 0) + 1
    except Exception as exc:
        logger.exception("Erreur api_prospects_tags_count")
        return jsonify(ok=False, error=str(exc)), 500
    sorted_tags = [{"tag": t, "count": c}
                   for t, c in sorted(counts.items(), key=lambda x: -x[1])]
    return jsonify(ok=True, tags=sorted_tags)


@app.post("/api/metiers/classify-tags-batch")
def api_metiers_classify_tags_batch():
    """Classifie une liste de tags non référencés via Ollama en un seul prompt batch.

    Body: { "tags": ["tag1", "tag2", ...] }
    Retourne: { "ok": true, "results": [{"tag":"...","category":"...","specialty":"...","techCategory":"...","confidence":0.9}, ...] }
    En cas d'erreur Ollama: { "ok": false, "error": "ollama_unavailable" }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    payload = request.get_json(force=True, silent=True) or {}
    tags = payload.get("tags", [])
    if not tags or not isinstance(tags, list):
        return jsonify(ok=False, error="Liste de tags requise"), 400

    # Arbre métiers de référence pour le contexte Ollama
    metiers_ref = """Ingénierie Logicielle:
  Spécialités: Logiciel applicatif, Test/Validation/Qualification logicielle, Logiciels embarqués/IoT, Data Science/ML/Deep Learning, DevOps/Infrastructure/Cloud, Gestion de projet logiciel/Scrum Master, Développement Web/Fullstack

Ingénierie Électronique:
  Spécialités: Électronique analogique, Électronique numérique, Électronique de puissance, Génie électrique/Électrotechnique, Industrialisation, FPGA/ASIC/SoC

Ingénierie Système:
  Spécialités: Mécatronique/Robotique, Model Based Design (MBD), Safety/Sûreté de fonctionnement, Contrôle commande/Automatique, Simulation multiphysique/Modélisation, Mécanique, Ingénierie système, Test/Validation/Essais système

Life Science:
  Spécialités: Qualification d'équipements (Pharma & DM), Validation de systèmes automatisés (VSA), Validation de systèmes d'informations (VSI), Validation de produits (Dispositifs Médicaux)"""

    tech_groups = "Langages, Frameworks, Librairies, Outils, Bases de données, Systèmes, IDE, Protocoles, Microcontrôleurs, Capteurs, Outils CAO, Serveurs, Méthodologies, Matériel, Certifications"

    all_results = []
    # Lots de 5 : le frontend gère la boucle, chaque appel reste court (~15-30s)
    batch_size = 5
    try:
        for i in range(0, len(tags), batch_size):
            batch = tags[i:i + batch_size]
            tags_json = json.dumps(batch, ensure_ascii=False)
            prompt = f"""Tu es un expert en classification de compétences techniques pour l'ingénierie B2B (ESN/cabinet de conseil).

Arbre des métiers de référence:
{metiers_ref}

Groupes technologiques possibles: {tech_groups}

Voici une liste de tags à classifier. Pour chaque tag, détermine:
- La catégorie métier la plus appropriée (exactement l'un des 4 noms ci-dessus)
- La spécialité la plus appropriée dans cette catégorie
- Le groupe technologique le plus approprié
- Ta confiance de 0.0 à 1.0

Tags à classifier: {tags_json}

Réponds UNIQUEMENT avec un tableau JSON valide (sans markdown, sans texte avant ou après):
[
  {{"tag": "NomDuTag", "category": "Catégorie exacte", "specialty": "Spécialité exacte", "techCategory": "Groupe tech", "confidence": 0.9}},
  ...
]

Si un tag ne correspond à aucune catégorie connue, mets category null."""

            # Forcer Ollama : ce prompt ne nécessite pas de recherche web,
            # et l'utilisateur n'a peut-être plus de crédits Tavily
            response_text = _call_ai_provider("ollama", prompt, _load_ai_config(), 60)

            # Extraire le JSON du texte de réponse
            json_block = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', response_text, re.DOTALL)
            if json_block:
                response_text = json_block.group(1)
            else:
                arr_match = re.search(r'\[[\s\S]*\]', response_text, re.DOTALL)
                if arr_match:
                    response_text = arr_match.group(0)

            try:
                batch_results = json.loads(response_text)
                if isinstance(batch_results, list):
                    all_results.extend(batch_results)
                else:
                    # Réponse invalide pour ce batch : retourner les tags non classés
                    for t in batch:
                        all_results.append({"tag": t, "category": None, "reason": "Réponse Ollama non parsable"})
            except json.JSONDecodeError:
                for t in batch:
                    all_results.append({"tag": t, "category": None, "reason": "JSON invalide"})

    except urllib.error.URLError:
        return jsonify(ok=False, error="ollama_unavailable")
    except Exception as e:
        logger.warning("Erreur classify-tags-batch: %s", e)
        return jsonify(ok=False, error=str(e))

    return jsonify(ok=True, results=all_results)


@app.post("/api/metiers/batch-confirm-tags")
def api_metiers_batch_confirm_tags():
    """Enregistre en lot les tags confirmés dans custom_metiers.

    Body: [{"tag":"Kubernetes","category":"Ingénierie Logicielle","specialty":"DevOps/Infrastructure/Cloud","tech_group":"Outils"}, ...]
    Retourne: { "ok": true, "saved": N, "skipped": M }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    payload = request.get_json(force=True, silent=True) or []
    if not isinstance(payload, list):
        return jsonify(ok=False, error="Tableau JSON attendu"), 400

    saved = 0
    skipped = 0
    now = datetime.datetime.now().isoformat(timespec="seconds")

    try:
        with _conn() as conn:
            # Auto-créer la table si absente (per-user DBs créées avant v27.22)
            conn.execute('''CREATE TABLE IF NOT EXISTS custom_metiers (
                id INTEGER PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL,
                specialty TEXT, tech_group TEXT, value TEXT NOT NULL, createdAt TEXT)''')
            for item in payload:
                tag_val = str(item.get("tag", "")).strip()
                category = str(item.get("category", "")).strip()
                specialty = str(item.get("specialty", "")).strip()
                tech_group = str(item.get("tech_group", "")).strip() or None
                if not tag_val or not category:
                    skipped += 1
                    continue
                existing = conn.execute(
                    "SELECT id FROM custom_metiers WHERE type='tech' AND LOWER(category)=LOWER(?) AND LOWER(COALESCE(specialty,''))=LOWER(?) AND LOWER(value)=LOWER(?)",
                    (category, specialty, tag_val)
                ).fetchone()
                if existing:
                    skipped += 1
                else:
                    conn.execute(
                        "INSERT INTO custom_metiers (type, category, specialty, tech_group, value, createdAt) VALUES (?,?,?,?,?,?)",
                        ("tech", category, specialty, tech_group, tag_val, now)
                    )
                    saved += 1
            conn.commit()
    except Exception as exc:
        logger.exception("Erreur batch-confirm-tags")
        return jsonify(ok=False, error=str(exc)), 500

    return jsonify(ok=True, saved=saved, skipped=skipped)


# ────────────────────────────────────────────────────────────────────
# Calendar – vue calendrier des actions
# ────────────────────────────────────────────────────────────────────

@app.get("/calendrier")
def page_calendar():
    return redirect("/v30/calendrier", code=302)


@app.get("/collab")
@login_required
def page_collab():
    return redirect("/v30/collab", code=302)


@app.get("/api/calendar_events")
def api_calendar_events():
    """Return all dated events for calendar display (prospects + candidats du user)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        prospects = conn.execute(
            """SELECT p.id, p.name, p.statut, p.nextFollowUp, p.rdvDate, p.fonction,
                      c.groupe AS company_groupe, c.site AS company_site
               FROM prospects p
               LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = ?
               WHERE p.owner_id = ?
                 AND ((p.nextFollowUp IS NOT NULL AND p.nextFollowUp != '')
                  OR (p.rdvDate IS NOT NULL AND p.rdvDate != ''))
            """,
            (uid, uid),
        ).fetchall()

        # Candidate EC1 interviews (v25: candidate_tabs type=ec1)
        cand_ec1 = conn.execute(
            """SELECT c.id, c.name, c.role, json_extract(t.payload, '$.interviewAt') AS interviewAt
               FROM candidates c
               JOIN candidate_tabs t ON t.candidate_id = c.id AND t.type = 'ec1'
               WHERE c.owner_id = ?
                 AND json_extract(t.payload, '$.interviewAt') IS NOT NULL
                 AND json_extract(t.payload, '$.interviewAt') != ''""",
            (uid,),
        ).fetchall()

        # Candidate EC2 (v25.1) — candidats avec status='ec2'
        cand_ec2 = conn.execute(
            """SELECT c.id, c.name, c.role, c.updatedAt,
                      COALESCE(ce.date, c.updatedAt) AS event_date
               FROM candidates c
               LEFT JOIN candidate_events ce ON ce.candidate_id = c.id 
                 AND ce.type = 'candidate_solid'
               WHERE c.owner_id = ?
                 AND c.status = 'ec2'
                 AND (ce.date IS NOT NULL OR c.updatedAt IS NOT NULL)""",
            (uid,),
        ).fetchall()

    events = []
    # Prospects
    for p in prospects:
        d = dict(p)
        nf = (d.get("nextFollowUp") or "").strip()
        rd = (d.get("rdvDate") or "").strip()
        company = d.get("company_groupe") or d.get("company_site") or ""
        if nf:
            events.append({
                "id": d["id"], "name": d["name"], "company": company,
                "date": nf[:10], "time": nf[11:16] if len(nf) > 10 else "",
                "type": "relance", "statut": d.get("statut", ""),
            })
        if rd:
            events.append({
                "id": d["id"], "name": d["name"], "company": company,
                "date": rd[:10], "time": rd[11:16] if len(rd) > 10 else "",
                "type": "rdv", "statut": d.get("statut", ""),
            })

    # Candidates EC1
    for r in cand_ec1:
        d = dict(r)
        ia = (d.get("interviewAt") or "").strip()
        if not ia:
            continue
        events.append({
            "id": d["id"],
            "name": d.get("name") or "Candidat",
            "company": d.get("role") or "EC1",
            "date": ia[:10],
            "time": ia[11:16] if len(ia) > 10 else "",
            "type": "ec1",
            "statut": "EC1",
            "url": f"/candidat?id={d['id']}&section=ec1",
        })

    # Candidates EC2
    for r in cand_ec2:
        d = dict(r)
        event_date = (d.get("event_date") or "").strip()
        if not event_date:
            continue
        events.append({
            "id": d["id"],
            "name": d.get("name") or "Candidat",
            "company": d.get("role") or "EC2",
            "date": event_date[:10],
            "time": event_date[11:16] if len(event_date) > 10 else "",
            "type": "ec2",
            "statut": "EC2",
            "url": f"/candidat?id={d['id']}",
        })

    # Standalone calendar events (créés depuis l'UI v30)
    try:
        with _conn() as conn:
            custom_rows = conn.execute(
                """SELECT e.id, e.title, e.event_date, e.event_time, e.duration_min,
                          e.location, e.notes, e.status, e.event_type,
                          e.prospect_id, e.candidate_id, e.company_id,
                          p.name AS prospect_name,
                          c.groupe AS company_groupe, c.site AS company_site
                   FROM calendar_events e
                   LEFT JOIN prospects p ON p.id = e.prospect_id AND p.owner_id = e.owner_id
                   LEFT JOIN companies c ON c.id = e.company_id AND c.owner_id = e.owner_id
                   WHERE e.owner_id=? AND e.deleted_at IS NULL""",
                (uid,)
            ).fetchall()
        for r in custom_rows:
            d = dict(r)
            comp = d.get("company_groupe") or d.get("company_site") or ""
            url = ""
            if d.get("prospect_id"):
                url = f"/v30/prospect/{d['prospect_id']}"
            elif d.get("candidate_id"):
                url = f"/v30/candidat/{d['candidate_id']}"
            events.append({
                "id": d["id"],
                "custom_event_id": d["id"],
                "name": d.get("title") or d.get("prospect_name") or "RDV",
                "prospect_id": d.get("prospect_id"),
                "candidate_id": d.get("candidate_id"),
                "company_id": d.get("company_id"),
                "company": comp,
                "date": (d.get("event_date") or "")[:10],
                "time": (d.get("event_time") or "")[:5],
                "type": d.get("event_type") or "rdv",
                "duration": d.get("duration_min") or 60,
                "location": d.get("location") or "",
                "notes": d.get("notes") or "",
                "statut": d.get("status") or "planifie",
                "url": url,
                "source": "custom",
            })
    except Exception as _e:
        logger.warning("api_calendar_events: custom events failed: %s", _e)

    return jsonify(ok=True, events=events)


@app.post("/api/calendar_events")
def api_calendar_events_create():
    """Crée un événement de calendrier custom (v30)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    event_date = (payload.get("date") or payload.get("event_date") or "").strip()
    if not title:
        return jsonify(ok=False, error="title requis"), 400
    if not event_date:
        return jsonify(ok=False, error="date requise"), 400
    # Validation simple AAAA-MM-JJ
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", event_date):
        return jsonify(ok=False, error="date invalide (format YYYY-MM-DD)"), 400
    event_time = (payload.get("time") or payload.get("event_time") or "").strip() or None
    if event_time and not re.match(r"^\d{2}:\d{2}(:\d{2})?$", event_time):
        return jsonify(ok=False, error="heure invalide (format HH:MM)"), 400
    duration = payload.get("duration") or payload.get("duration_min")
    try:
        duration = int(duration) if duration not in (None, "") else 60
    except (TypeError, ValueError):
        duration = 60
    location = (payload.get("location") or "").strip() or None
    notes = (payload.get("notes") or "").strip() or None
    status = (payload.get("status") or "planifie").strip()
    if status not in ("planifie", "confirme", "annule", "termine"):
        status = "planifie"
    event_type = (payload.get("event_type") or payload.get("type") or "rdv").strip()
    if event_type not in ("rdv", "relance", "ec1", "ec2", "appel", "autre"):
        event_type = "rdv"
    def _opt_int(v):
        try:
            return int(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None
    prospect_id = _opt_int(payload.get("prospect_id"))
    candidate_id = _opt_int(payload.get("candidate_id"))
    company_id = _opt_int(payload.get("company_id"))
    now = datetime.datetime.now().isoformat()
    with _conn() as conn:
        cur = conn.execute(
            """INSERT INTO calendar_events
               (title, event_date, event_time, duration_min, location, notes, status, event_type,
                prospect_id, candidate_id, company_id, owner_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);""",
            (title, event_date, event_time, duration, location, notes, status, event_type,
             prospect_id, candidate_id, company_id, uid, now, now)
        )
        new_id = cur.lastrowid
        conn.commit()
    return jsonify(ok=True, id=new_id)


@app.put("/api/calendar_events/<int:event_id>")
def api_calendar_events_update(event_id):
    """Met à jour un événement custom (les champs fournis uniquement)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    fields = {}
    if "title" in payload:
        t = (payload.get("title") or "").strip()
        if not t:
            return jsonify(ok=False, error="title vide"), 400
        fields["title"] = t
    if "date" in payload or "event_date" in payload:
        d = (payload.get("date") or payload.get("event_date") or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            return jsonify(ok=False, error="date invalide"), 400
        fields["event_date"] = d
    if "time" in payload or "event_time" in payload:
        t2 = (payload.get("time") or payload.get("event_time") or "").strip()
        if t2 and not re.match(r"^\d{2}:\d{2}(:\d{2})?$", t2):
            return jsonify(ok=False, error="heure invalide"), 400
        fields["event_time"] = t2 or None
    if "duration" in payload or "duration_min" in payload:
        try:
            fields["duration_min"] = int(payload.get("duration") or payload.get("duration_min") or 60)
        except (TypeError, ValueError):
            fields["duration_min"] = 60
    if "location" in payload:
        fields["location"] = (payload.get("location") or "").strip() or None
    if "notes" in payload:
        fields["notes"] = (payload.get("notes") or "").strip() or None
    if "status" in payload:
        s = (payload.get("status") or "planifie").strip()
        fields["status"] = s if s in ("planifie", "confirme", "annule", "termine") else "planifie"
    if "event_type" in payload or "type" in payload:
        et = (payload.get("event_type") or payload.get("type") or "rdv").strip()
        fields["event_type"] = et if et in ("rdv", "relance", "ec1", "ec2", "appel", "autre") else "rdv"
    if "prospect_id" in payload:
        try:
            fields["prospect_id"] = int(payload["prospect_id"]) if payload["prospect_id"] not in (None, "") else None
        except (TypeError, ValueError):
            fields["prospect_id"] = None
    if "candidate_id" in payload:
        try:
            fields["candidate_id"] = int(payload["candidate_id"]) if payload["candidate_id"] not in (None, "") else None
        except (TypeError, ValueError):
            fields["candidate_id"] = None
    if "company_id" in payload:
        try:
            fields["company_id"] = int(payload["company_id"]) if payload["company_id"] not in (None, "") else None
        except (TypeError, ValueError):
            fields["company_id"] = None
    if not fields:
        return jsonify(ok=False, error="aucun champ à mettre à jour"), 400
    fields["updated_at"] = datetime.datetime.now().isoformat()
    cols = ", ".join(f"{k}=?" for k in fields)
    params = list(fields.values()) + [event_id, uid]
    with _conn() as conn:
        cur = conn.execute(
            f"UPDATE calendar_events SET {cols} WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            tuple(params)
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify(ok=False, error="not_found"), 404
    return jsonify(ok=True, id=event_id)


@app.delete("/api/calendar_events/<int:event_id>")
def api_calendar_events_delete(event_id):
    """Soft delete d'un événement custom."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    now = datetime.datetime.now().isoformat()
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE calendar_events SET deleted_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (now, event_id, uid)
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify(ok=False, error="not_found"), 404
    return jsonify(ok=True, id=event_id)


def _parse_ics_to_events(ics_text: str) -> List[Dict[str, Any]]:
    """Parse ICS text and return list of events { date, time, name, teams_url, event_url }."""
    events = []
    if not ics_text or "BEGIN:VEVENT" not in ics_text:
        return events
    blocks = ics_text.split("BEGIN:VEVENT")
    for block in blocks[1:]:
        part = block.split("END:VEVENT")[0]
        # Unfold ICS lines (RFC 5545: CRLF + whitespace = continuation)
        unfolded = re.sub(r"\r?\n[ \t]", "", part)
        summary = ""
        start_date = ""
        start_time = ""
        teams_url = ""
        event_url = ""

        summary_m = re.search(r"SUMMARY[^:]*:(.*?)(?:\r?\n(?!\s))", part, re.DOTALL)
        if summary_m:
            summary = re.sub(r"\r?\n\s+", "", summary_m.group(1)).strip()

        start_m = re.search(r"DTSTART[^:]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?", part)
        if start_m:
            start_date = f"{start_m.group(1)}-{start_m.group(2)}-{start_m.group(3)}"
            if start_m.group(4):
                start_time = f"{start_m.group(4)}:{start_m.group(5) or '00'}"

        # Teams meeting URL (proprietary Microsoft fields, unfolded)
        teams_m = re.search(
            r"X-MICROSOFT-(?:SKYPETEAMSMEETINGURL|ONLINEMEETINGURL)[^:]*:(https://teams\.microsoft\.com/\S+)",
            unfolded, re.IGNORECASE,
        )
        if teams_m:
            teams_url = teams_m.group(1).strip()
        if not teams_url:
            # Fallback: search DESCRIPTION for a Teams join URL
            desc_m = re.search(r"DESCRIPTION[^:]*:(.*?)(?=\r?\n[A-Z])", unfolded, re.DOTALL)
            if desc_m:
                t_url = re.search(r"https://teams\.microsoft\.com/l/meetup-join/\S+", desc_m.group(1))
                if t_url:
                    teams_url = t_url.group(0).rstrip("\\>").strip()

        # Generic URL field
        url_m = re.search(r"^URL[^:]*:(.+)$", unfolded, re.MULTILINE)
        if url_m:
            event_url = url_m.group(1).strip()

        # Duration from DTEND (in minutes)
        duration = 60
        end_m = re.search(r"DTEND[^:]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?", unfolded)
        if end_m and start_time and end_m.group(4):
            end_mins = int(end_m.group(4)) * 60 + int(end_m.group(5) or 0)
            start_mins = int(start_time[:2]) * 60 + int(start_time[3:5])
            d_mins = end_mins - start_mins
            if d_mins > 0:
                duration = d_mins

        if start_date and summary:
            events.append({
                "date": start_date, "time": start_time, "name": summary,
                "teams_url": teams_url, "event_url": event_url, "duration": duration,
            })
    return events


@app.get("/api/calendar_events_external")
def api_calendar_events_external():
    """Fetch an external .ics URL (Outlook/Google) and return events. Avoids CORS."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    url = (request.args.get("url") or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        return jsonify(ok=False, error="URL invalide"), 400
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Prosp'Up/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            ics_text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return jsonify(ok=False, error=f"HTTP {e.code}"), 502
    except urllib.error.URLError as e:
        return jsonify(ok=False, error=str(e.reason) if getattr(e, "reason", None) else "Erreur réseau"), 502
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 502
    raw = _parse_ics_to_events(ics_text)
    events = [
        {
            "id": None, "name": e["name"], "company": "", "date": e["date"],
            "time": e.get("time") or "", "type": "external", "statut": "",
            "url": e.get("event_url") or "",
            "teams_url": e.get("teams_url") or "",
            "duration": e.get("duration") or 60,
        }
        for e in raw
    ]
    return jsonify(ok=True, events=events)


# ────────────────────────────────────────────────────────────────────
# Dashboard – activité quotidienne / hebdo
# ────────────────────────────────────────────────────────────────────

@app.get("/dashboard")
def page_dashboard():
    return redirect("/v30/dashboard", code=302)


# Gamified goals helpers are extracted in services/dashboard_goals.py.


@app.get("/api/dashboard")
def api_dashboard():
    """Return KPIs for today + this week + trends. Accepts ?week=YYYY-WNN for historical navigation."""
    real_today = _today_iso()
    real_d_today = datetime.date.fromisoformat(real_today)

    week_param = request.args.get('week', '').strip()
    is_past_week = False
    d_today = real_d_today
    today = real_today
    if week_param and '-W' in week_param:
        try:
            yr_s, wn_s = week_param.split('-W')
            yr_p, wn_p = int(yr_s), int(wn_s)
            jan4_p = datetime.date(yr_p, 1, 4)
            w1_monday = jan4_p - datetime.timedelta(days=jan4_p.isoweekday() - 1)
            req_monday_d = w1_monday + datetime.timedelta(weeks=wn_p - 1)
            req_sunday_d = req_monday_d + datetime.timedelta(days=6)
            if req_monday_d <= real_d_today:
                d_today = min(req_sunday_d, real_d_today)
                today = d_today.isoformat()
                is_past_week = req_sunday_d < real_d_today
        except Exception:
            pass

    # Monday of the target week
    monday = (d_today - datetime.timedelta(days=d_today.weekday())).isoformat()
    # Previous week for trend comparison
    prev_monday = (d_today - datetime.timedelta(days=d_today.weekday() + 7)).isoformat()
    prev_sunday = (d_today - datetime.timedelta(days=d_today.weekday() + 1)).isoformat()

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        # BUG 27 : on exclut aussi les archivés pour cohérence KPIs dashboard
        prospects = conn.execute(
            "SELECT * FROM prospects WHERE owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='') "
            "AND (is_archived IS NULL OR is_archived=0);",
            (uid,),
        ).fetchall()
        push_logs = conn.execute(
            "SELECT l.* FROM push_logs l JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=? AND (p.deleted_at IS NULL OR p.deleted_at='');",
            (uid,),
        ).fetchall()
        goals_cfg = _get_goals_config(conn)

        # Appels (call_logs) par jour de la semaine courante
        try:
            call_logs_rows = conn.execute(
                "SELECT date, COUNT(*) AS n FROM call_logs WHERE owner_id=? AND date >= ? AND date <= ? GROUP BY date;",
                (uid, monday, today),
            ).fetchall()
            calls_by_date = {r["date"]: r["n"] for r in call_logs_rows}
            calls_today = calls_by_date.get(today, 0)
            calls_week = sum(calls_by_date.values())
        except Exception:
            calls_by_date = {}
            calls_today = 0
            calls_week = 0

        # Event-based KPIs (for goals)
        # Fallback UNION: pour les prospects qui n'ont jamais eu d'event rdv_taken (DB ancienne sans prospect_events),
        # on comptabilise aussi les prospects statut='Rendez-vous' dont lastContact est dans la période
        # Condition "NOT EXISTS (ANY event)" pour éviter le surcômptage des RDV anciens déjà comptabilisés.
        try:
            rdv_taken_today = conn.execute(
                """SELECT COUNT(DISTINCT pid) FROM (
                    SELECT e.prospect_id AS pid
                    FROM prospect_events e
                    JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
                    WHERE e.type='rdv_taken' AND e.date=?
                      AND (p.deleted_at IS NULL OR p.deleted_at='')
                    UNION
                    SELECT p.id AS pid
                    FROM prospects p
                    WHERE p.owner_id=? AND p.statut='Rendez-vous'
                      AND (p.deleted_at IS NULL OR p.deleted_at='')
                      AND p.rdvDate IS NOT NULL AND p.rdvDate != ''
                      AND substr(p.lastContact,1,10)=?
                      AND NOT EXISTS (
                          SELECT 1 FROM prospect_events e2
                          WHERE e2.prospect_id=p.id AND e2.type='rdv_taken'
                      )
                )""",
                (uid, today, uid, today),
            ).fetchone()[0]
            rdv_taken_week = conn.execute(
                """SELECT COUNT(DISTINCT pid) FROM (
                    SELECT e.prospect_id AS pid
                    FROM prospect_events e
                    JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
                    WHERE e.type='rdv_taken' AND e.date BETWEEN ? AND ?
                      AND (p.deleted_at IS NULL OR p.deleted_at='')
                    UNION
                    SELECT p.id AS pid
                    FROM prospects p
                    WHERE p.owner_id=? AND p.statut='Rendez-vous'
                      AND (p.deleted_at IS NULL OR p.deleted_at='')
                      AND p.rdvDate IS NOT NULL AND p.rdvDate != ''
                      AND substr(p.lastContact,1,10) BETWEEN ? AND ?
                      AND NOT EXISTS (
                          SELECT 1 FROM prospect_events e2
                          WHERE e2.prospect_id=p.id AND e2.type='rdv_taken'
                      )
                )""",
                (uid, monday, today, uid, monday, today),
            ).fetchone()[0]
        except Exception:
            rdv_taken_today = 0
            rdv_taken_week = 0

        try:
            cand_contacted_today = conn.execute(
                "SELECT COUNT(*) FROM candidate_events e JOIN candidates c ON c.id=e.candidate_id AND c.owner_id=? WHERE e.type='candidate_contacted' AND e.date=?",
                (uid, today),
            ).fetchone()[0]
            cand_contacted_week = conn.execute(
                "SELECT COUNT(*) FROM candidate_events e JOIN candidates c ON c.id=e.candidate_id AND c.owner_id=? WHERE e.type='candidate_contacted' AND e.date BETWEEN ? AND ?",
                (uid, monday, today),
            ).fetchone()[0]
            cand_solid_week = conn.execute(
                "SELECT COUNT(*) FROM candidate_events e JOIN candidates c ON c.id=e.candidate_id AND c.owner_id=? WHERE e.type='candidate_solid' AND e.date BETWEEN ? AND ?",
                (uid, monday, today),
            ).fetchone()[0]
        except Exception:
            cand_contacted_today = 0
            cand_contacted_week = 0
            cand_solid_week = 0

        try:
            inmails_today = conn.execute(
                "SELECT COUNT(*) FROM linkedin_inmails WHERE owner_id=? AND sent_at=?",
                (uid, today),
            ).fetchone()[0]
            inmails_week = conn.execute(
                "SELECT COUNT(*) FROM linkedin_inmails WHERE owner_id=? AND sent_at BETWEEN ? AND ?",
                (uid, monday, today),
            ).fetchone()[0]
        except Exception:
            inmails_today = 0
            inmails_week = 0

        # RDV events par jour de la semaine (pour les barres d'activité)
        try:
            rdv_rows = conn.execute(
                """SELECT e.date, COUNT(DISTINCT e.prospect_id) AS n
                   FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
                   WHERE e.type='rdv_taken' AND e.date BETWEEN ? AND ?
                     AND (p.deleted_at IS NULL OR p.deleted_at='')
                   GROUP BY e.date""",
                (uid, monday, today),
            ).fetchall()
            rdv_by_date = {r["date"]: r["n"] for r in rdv_rows}
        except Exception:
            rdv_by_date = {}

        # Prospects passés en RDV (aujourd'hui, ou toute la semaine pour une semaine passée)
        try:
            feed_start = monday if is_past_week else today
            today_rdv_rows = conn.execute(
                """SELECT DISTINCT p.id, p.name, COALESCE(c.groupe, '') AS company_name,
                          p.rdvDate, e.createdAt
                   FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
                   LEFT JOIN companies c ON c.id=p.company_id
                   WHERE e.type='rdv_taken' AND e.date BETWEEN ? AND ?
                     AND (p.deleted_at IS NULL OR p.deleted_at='')
                   ORDER BY e.createdAt DESC LIMIT 20""",
                (uid, feed_start, today),
            ).fetchall()
            today_rdv_prospects = [dict(r) for r in today_rdv_rows]
        except Exception:
            today_rdv_prospects = []

        # Manual KPI ajustements pour la semaine courante
        try:
            mkpi_rows = conn.execute(
                "SELECT type, SUM(count) AS total FROM manual_kpi WHERE user_id=? AND date BETWEEN ? AND ? GROUP BY type",
                (uid, monday, today),
            ).fetchall()
            manual_kpi_week = {r["type"]: r["total"] for r in mkpi_rows}
            mkpi_today_rows = conn.execute(
                "SELECT type, SUM(count) AS total FROM manual_kpi WHERE user_id=? AND date=? GROUP BY type",
                (uid, today),
            ).fetchall()
            manual_kpi_today = {r["type"]: r["total"] for r in mkpi_today_rows}
            mkpi_calls_rows = conn.execute(
                "SELECT date, SUM(count) AS total FROM manual_kpi WHERE user_id=? AND date BETWEEN ? AND ? AND type='contact' GROUP BY date",
                (uid, monday, today),
            ).fetchall()
            manual_calls_by_date = {r["date"]: int(r["total"]) for r in mkpi_calls_rows}
        except Exception:
            manual_kpi_week = {}
            manual_kpi_today = {}
            manual_calls_by_date = {}

        # Notes stockées dans prospect_events (types note / note_libre / call_note)
        try:
            note_event_rows = conn.execute(
                """SELECT e.date, e.content, e.prospect_id, p.name AS prospect_name
                   FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id
                   WHERE p.owner_id=? AND e.type IN ('note','note_libre','call_note')
                     AND (p.deleted_at IS NULL OR p.deleted_at='')
                     AND (p.is_archived IS NULL OR p.is_archived=0);""",
                (uid,),
            ).fetchall()
            note_events = [dict(r) for r in note_event_rows]
        except Exception:
            note_events = []

    # Merge manual KPI "contact" adjustments into calls counts (for graph + totals)
    for _d, _cnt in manual_calls_by_date.items():
        calls_by_date[_d] = calls_by_date.get(_d, 0) + _cnt
    calls_today = max(0, calls_by_date.get(today, 0))
    calls_week = max(0, sum(calls_by_date.values()))

    prospects_list = [dict(r) for r in prospects]
    push_list = [dict(r) for r in push_logs]

    # Parse all call notes (callNotes JSON column + prospect_events de type note)
    all_notes = []
    for p in prospects_list:
        try:
            notes = json.loads(p.get("callNotes") or "[]")
            for n in (notes if isinstance(notes, list) else []):
                n["_prospect_id"] = p["id"]
                n["_prospect_name"] = p["name"]
                all_notes.append(n)
        except Exception:
            pass
    for ne in note_events:
        all_notes.append({
            "date": ne.get("date") or "",
            "content": ne.get("content") or "",
            "_prospect_id": ne.get("prospect_id"),
            "_prospect_name": ne.get("prospect_name") or "",
        })

    def count_relances(date_str):
        return sum(1 for p in prospects_list if (p.get("lastContact") or "") == date_str)

    def count_relances_range(start, end):
        return sum(1 for p in prospects_list if start <= (p.get("lastContact") or "") <= end)

    def count_notes(date_str):
        return sum(1 for n in all_notes if (n.get("date") or "")[:10] == date_str)

    def count_notes_range(start, end):
        return sum(1 for n in all_notes if start <= (n.get("date") or "")[:10] <= end)

    def count_push(date_str):
        return sum(1 for pl in push_list if (pl.get("sentAt") or "")[:10] == date_str)

    def count_push_range(start, end):
        return sum(1 for pl in push_list if start <= (pl.get("sentAt") or "")[:10] <= end)

    def count_push_channel(start, end, channel):
        return sum(1 for pl in push_list
                   if start <= (pl.get("sentAt") or "")[:10] <= end
                   and (pl.get("channel") or "") == channel)

    # Overdue / due today
    overdue = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < today]
    due_today = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() == today]
    due_week = [p for p in prospects_list if monday <= (p.get("nextFollowUp") or "").strip() <= today]

    # RDV count
    rdv_total = sum(1 for p in prospects_list if p.get("statut") == "Rendez-vous")

    # Notes/push for activity feed — full week range for past weeks, today only otherwise
    feed_start = monday if is_past_week else today
    today_notes = sorted(
        [n for n in all_notes if feed_start <= (n.get("date") or "")[:10] <= today],
        key=lambda x: x.get("date", ""), reverse=True
    )
    today_push = sorted(
        [pl for pl in push_list if feed_start <= (pl.get("sentAt") or "")[:10] <= today],
        key=lambda x: x.get("createdAt", ""), reverse=True
    )

    # Statut distribution
    statuts = {}
    for p in prospects_list:
        s = p.get("statut") or "Inconnu"
        statuts[s] = statuts.get(s, 0) + 1

    # Week daily breakdown for sparkline
    week_days = []
    for i in range(7):
        d = (datetime.date.fromisoformat(monday) + datetime.timedelta(days=i)).isoformat()
        if d > today:
            break
        week_days.append({
            "date": d,
            "relances": count_relances(d),
            "notes": count_notes(d),
            "push": count_push(d),
            "calls": calls_by_date.get(d, 0),
            "rdv": rdv_by_date.get(d, 0),
        })

    # Goals / gamification payload (daily + weekly)
    # Intègre les ajustements manual_kpi (peuvent être négatifs pour corriger les sur-comptages)
    goals_daily_counts = {
        "rdv": max(0, rdv_taken_today + int(manual_kpi_today.get("rdv", 0))),
        "push": max(0, count_push(today) + int(manual_kpi_today.get("push_email", 0)) + int(manual_kpi_today.get("push_linkedin", 0))),
        "sourcing_contacted": max(0, cand_contacted_today + inmails_today + int(manual_kpi_today.get("sourcing", 0))),
    }
    goals_weekly_counts = {
        "rdv": max(0, rdv_taken_week + int(manual_kpi_week.get("rdv", 0))),
        "push": max(0, count_push_range(monday, today) + int(manual_kpi_week.get("push_email", 0)) + int(manual_kpi_week.get("push_linkedin", 0))),
        "sourcing_contacted": max(0, cand_contacted_week + inmails_week + int(manual_kpi_week.get("sourcing", 0))),
        "sourcing_solid": max(0, cand_solid_week),
    }
    goals_payload = _build_goals_payload(
        goals_cfg=goals_cfg,
        daily_counts=goals_daily_counts,
        weekly_counts=goals_weekly_counts,
    )

    return jsonify(ok=True, data={
        "is_past_week": is_past_week,
        "today": {
            "date": today,
            "relances": count_relances(today),
            "notes": count_notes(today),
            "calls": calls_today,
            "push_total": count_push(today),
            "push_email": count_push_channel(today, today, "email"),
            "push_linkedin": count_push_channel(today, today, "linkedin"),
        },
        "goals": goals_payload,
        "week": {
            "start": monday,
            "end": today,
            "week_num": datetime.date.fromisoformat(monday).isocalendar()[1],
            "relances": count_relances_range(monday, today),
            "notes": count_notes_range(monday, today),
            "calls": calls_week,
            "push_total": count_push_range(monday, today),
            "push_email": count_push_channel(monday, today, "email"),
            "push_linkedin": count_push_channel(monday, today, "linkedin"),
            "rdv_total": rdv_taken_week,
            "days": week_days,
        },
        "prev_week": {
            "relances": count_relances_range(prev_monday, prev_sunday),
            "notes": count_notes_range(prev_monday, prev_sunday),
            "push_total": count_push_range(prev_monday, prev_sunday),
        },
        "pipeline": {
            "total": len(prospects_list),
            "rdv": rdv_total,
            "overdue": len(overdue),
            "due_today": len(due_today),
            "statuts": statuts,
        },
        "feed": {
            "notes": [{
                "prospect_id": n.get("_prospect_id"),
                "prospect_name": n.get("_prospect_name", ""),
                "content": n.get("content", ""),
                "date": n.get("date", ""),
            } for n in today_notes[:10]],
            "push": [{
                "prospect_id": pl.get("prospect_id"),
                "channel": pl.get("channel", ""),
                "subject": pl.get("subject", ""),
                "to_email": pl.get("to_email", ""),
                "createdAt": pl.get("createdAt", ""),
            } for pl in today_push[:10]],
            "rdv": [{
                "prospect_id": r.get("id"),
                "prospect_name": r.get("name", ""),
                "company_name": r.get("company_name", ""),
                "rdvDate": r.get("rdvDate", ""),
                "createdAt": r.get("createdAt", ""),
            } for r in today_rdv_prospects],
        },
        "overdue_list": [{
            "id": p["id"],
            "name": p["name"],
            "nextFollowUp": p.get("nextFollowUp", ""),
            "statut": p.get("statut", ""),
            "company_id": p.get("company_id"),
        } for p in sorted(overdue, key=lambda x: x.get("nextFollowUp", ""))[:10]],
        "today_appointments": [{
            "prospect_id": p["id"],
            "prospect_name": p.get("name", ""),
            "company_name": p.get("company_groupe") or p.get("company_site") or "",
            "rdvDate": p.get("rdvDate", ""),
        } for p in sorted(
            [p for p in prospects_list if (p.get("rdvDate") or "").strip()[:10] == today],
            key=lambda x: x.get("rdvDate", "")
        )],
        "upcoming_rdv": [{
            "id": p["id"],
            "name": p["name"],
            "rdvDate": p.get("rdvDate", ""),
            "statut": p.get("statut", ""),
        } for p in sorted(
            [p for p in prospects_list if (p.get("rdvDate") or "").strip()[:10] > today],
            key=lambda x: x.get("rdvDate", "")
        )[:5]],
    })


@app.get("/api/dashboard/stats")
def api_dashboard_stats():
    """Données Performance Pulse par semaine pour le dashboard v30.
    Accepte ?week=YYYY-Www. Retourne daily_rdv, daily_calls, insight + totaux."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    real_today = _today_iso()
    real_d = datetime.date.fromisoformat(real_today)

    week_param = request.args.get("week", "").strip()
    d_today = real_d
    if week_param and "-W" in week_param:
        try:
            yr_s, wn_s = week_param.split("-W")
            yr_p, wn_p = int(yr_s), int(wn_s)
            jan4_p = datetime.date(yr_p, 1, 4)
            w1_mon = jan4_p - datetime.timedelta(days=jan4_p.isoweekday() - 1)
            req_mon = w1_mon + datetime.timedelta(weeks=wn_p - 1)
            req_sun = req_mon + datetime.timedelta(days=6)
            if req_mon <= real_d:
                d_today = min(req_sun, real_d)
        except Exception:
            pass

    monday = d_today - datetime.timedelta(days=d_today.weekday())
    prev_monday = monday - datetime.timedelta(weeks=1)
    prev_sunday = monday - datetime.timedelta(days=1)
    today_iso = d_today.isoformat()
    monday_iso = monday.isoformat()
    prev_monday_iso = prev_monday.isoformat()
    prev_sunday_iso = prev_sunday.isoformat()

    week_num = monday.isocalendar()[1]
    week_label = f"{monday.year}-W{week_num:02d}"

    daily_rdv = [0] * 7
    daily_calls = [0] * 7

    with _conn() as conn:
        try:
            rdv_rows = conn.execute(
                """SELECT e.date, COUNT(DISTINCT e.prospect_id) AS n
                   FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
                   WHERE e.type='rdv_taken' AND e.date BETWEEN ? AND ?
                     AND (p.deleted_at IS NULL OR p.deleted_at='')
                   GROUP BY e.date""",
                (uid, monday_iso, today_iso),
            ).fetchall()
            for r in rdv_rows:
                try:
                    d = datetime.date.fromisoformat(r["date"])
                    idx = (d - monday).days
                    if 0 <= idx < 7:
                        daily_rdv[idx] = r["n"]
                except Exception:
                    pass
        except Exception:
            pass

        try:
            call_rows = conn.execute(
                "SELECT date, COUNT(*) AS n FROM call_logs WHERE owner_id=? AND date BETWEEN ? AND ? GROUP BY date;",
                (uid, monday_iso, today_iso),
            ).fetchall()
            for r in call_rows:
                try:
                    d = datetime.date.fromisoformat(r["date"])
                    idx = (d - monday).days
                    if 0 <= idx < 7:
                        daily_calls[idx] = r["n"]
                except Exception:
                    pass
        except Exception:
            pass

        try:
            rdv_prev = conn.execute(
                """SELECT COUNT(DISTINCT e.prospect_id)
                   FROM prospect_events e
                   JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
                   WHERE e.type='rdv_taken' AND e.date BETWEEN ? AND ?
                     AND (p.deleted_at IS NULL OR p.deleted_at='')""",
                (uid, prev_monday_iso, prev_sunday_iso),
            ).fetchone()[0]
        except Exception:
            rdv_prev = 0

    rdv_total = sum(daily_rdv)
    calls_total = sum(daily_calls)
    rdv_delta = rdv_total - rdv_prev
    sign = "+" if rdv_delta >= 0 else ""
    insight = f"{rdv_total} RDV cette semaine ({sign}{rdv_delta} vs semaine passée)"

    return jsonify(ok=True, data={
        "week": week_label,
        "daily_rdv": daily_rdv,
        "daily_calls": daily_calls,
        "rdv_total": rdv_total,
        "calls_total": calls_total,
        "rdv_prev_week": rdv_prev,
        "insight": insight,
    })


# ────────────────────────────────────────────────────────────────────
# RDV Checklist – grille de qualification prospect en rendez‑vous
# ────────────────────────────────────────────────────────────────────

RDV_CHECKLIST_THEMES = [
    {"key": "metiers_equipe",        "theme": "Métiers équipe",          "question": "Quels métiers dans l'équipe ?"},
    {"key": "outils",                "theme": "Outils",                  "question": "Quels outils (dev, gestion de projet, tests…) ?"},
    {"key": "taille_equipe",         "theme": "Taille équipe",           "question": "Nb pers dont internes / externes ?"},
    {"key": "projets_actuels",       "theme": "Projets actuels",         "question": "Projets en cours ?"},
    {"key": "projets_a_venir",       "theme": "Projets à venir",         "question": "Projets / roadmap à venir (3–12 mois) ?"},
    {"key": "societe",               "theme": "Société",                 "question": "Nb employés (site / groupe) ?"},
    {"key": "produits",              "theme": "Produits",                 "question": "Produits / systèmes principaux ?"},
    {"key": "autres_equipes",        "theme": "Autres équipes",          "question": "Autres équipes au même niveau ?"},
    {"key": "hierarchie",            "theme": "Hiérarchie",              "question": "Chefs / organisation (N+1, N+2…) ?"},
    {"key": "missions_externes",     "theme": "Missions externes",       "question": "Types de missions confiées aux consultants ?"},
    {"key": "duree_missions",        "theme": "Durée missions",          "question": "Durée moyenne des missions ?"},
    {"key": "vision_externalisation", "theme": "Vision externalisation", "question": "Vision sur l'externalisation (hausse, baisse, stable) ?"},
    {"key": "profils_recherches",    "theme": "Profils recherchés",      "question": "Profils types (ingé / tech, gestion de projet…) ?"},
    {"key": "xp_attendue",           "theme": "XP attendue",             "question": "Niveau d'XP (junior / confirmé / senior, exemples) ?"},
    {"key": "domaines_externalises", "theme": "Domaines externalisés",   "question": "Domaines / sujets le plus souvent externalisés ?"},
    {"key": "seniorite_consultants", "theme": "Séniorité consultants",   "question": "Séniorité moyenne / âge de l'équipe de consultants ?"},
    {"key": "formations_privilegiees","theme": "Formations privilégiées","question": "Écoles / formations préférées ?"},
    {"key": "xp_minimum",            "theme": "XP minimum",             "question": "Nb d'années d'XP minimum ?"},
    {"key": "origine_profils",       "theme": "Origine profils",         "question": "Origine habituelle des consultants (ESN, industrie…) ?"},
    {"key": "outils_indispensables", "theme": "Outils indispensables",   "question": "Outils / normes / environnements à maîtriser absolument ?"},
    {"key": "panel",                 "theme": "Panel",                   "question": "Panel ESN existant ? Partenaires principaux ?"},
    {"key": "process_achat",         "theme": "Process achat",           "question": "Comment se passe le process achat (demande, validation, délais) ?"},
    {"key": "validation_technique",  "theme": "Validation technique",    "question": "Comment est faite la validation technique des profils ?"},
    {"key": "appel_offre",           "theme": "Appel d'offre",           "question": "Appels d'offre ou consultations directes ?"},
    {"key": "criteres_partenaire",   "theme": "Critères partenaire",     "question": "Critères clés pour choisir un partenaire (réactivité, spécialisation, tarifs, etc.) ?"},
    {"key": "besoin_identifie",      "theme": "Besoin identifié",        "question": "Besoins ouverts / à venir ?"},
    {"key": "profils_a_proposer",    "theme": "Profils à proposer",      "question": "Typologie de profils à envoyer (compétences, techno, séniorité) ?"},
    {"key": "stakeholders",          "theme": "Stakeholders",            "question": "Décideurs / influenceurs impliqués ?"},
    {"key": "next_step",             "theme": "Next step",               "question": "Prochaine étape (envoi de profils, réunion technique…) + date / deadline ?"},
]


# ═══════════════════════════════════════════════════════════════════
# v26.3: Fonctions utilitaires pour "Avant réunion IA" — génération PDF
# ═══════════════════════════════════════════════════════════════════

def build_ollama_prompt_rdv(prospect: Dict[str, Any], company: Dict[str, Any] = None) -> str:
    """Construit le prompt Ollama pour analyser un profil LinkedIn et générer une fiche de préparation RDV.
    
    Args:
        prospect: Dict avec les champs du prospect (name, fonction, linkedin, etc.)
        company: Dict avec les infos de l'entreprise (groupe, site, etc.)
    
    Returns:
        String prompt structuré pour Ollama
    """
    nom_complet = prospect.get("name", "").strip()
    prenom = prospect.get("prenom", "").strip() or nom_complet.split()[0] if nom_complet else ""
    nom = prospect.get("nom", "").strip() or " ".join(nom_complet.split()[1:]) if len(nom_complet.split()) > 1 else nom_complet
    poste = prospect.get("fonction", "").strip()
    entreprise = ""
    ville = ""
    if company:
        entreprise = f"{company.get('groupe', '')} ({company.get('site', '')})".strip(" ()")
        ville = company.get("site", "").strip()
    linkedin = (prospect.get("linkedin") or "").strip()
    
    return f"""Tu es un expert en prospection B2B pour une ESN spécialisée en systèmes embarqués, robotique et ingénierie industrielle (société UpTechnologie, Lyon).

Tu dois analyser le profil LinkedIn suivant et générer une fiche de préparation RDV structurée en JSON.

--- PROFIL ---
Nom : {prenom} {nom}
Poste actuel : {poste}
Entreprise : {entreprise}
Ville : {ville}
URL LinkedIn : {linkedin}

--- FORMAT DE SORTIE ATTENDU (JSON strict) ---
{{
  "qui_est_il": {{
    "resume": "2-3 phrases de synthèse sur son profil, sa sensibilité, ses priorités",
    "titre_actuel": "...",
    "parcours": "résumé du parcours en 1-2 phrases",
    "stack_specialites": ["...", "..."],
    "activite_complementaire": "freelance / autre activité éventuelle"
  }},
  "contexte_entreprise": {{
    "description": "description de l'entreprise en 2-3 phrases",
    "taille": "...",
    "secteurs": ["...", "..."],
    "metiers_autour": ["...", "..."],
    "conclusion_matching": "pourquoi ces métiers matchent avec des candidats embarqué/robotique/IA"
  }},
  "besoins_probables": {{
    "data_referentiels": ["..."],
    "digital_bi2b": ["..."],
    "automatisation": ["..."],
    "ressources_contraintes": ["..."],
    "candidats_a_positionner": ["Ingé embarqué / industrie 4.0", "Dev back-end / data", "Ingé systèmes / intégration"]
  }},
  "interlocuteurs_potentiels": {{
    "marketing_digital": ["..."],
    "commerce_technique": ["..."],
    "technique_projet": ["..."],
    "conclusion": "..."
  }}
}}

Réponds UNIQUEMENT avec le JSON valide. Aucune source, aucun commentaire, aucune URL après le JSON. Commence directement par {{ et termine par }}.
"""


def build_fallback_prompt_rdv(prospect: Dict[str, Any], company: Dict[str, Any] = None) -> str:
    """Construit un prompt complet pour fallback (copier-coller dans une autre IA).
    
    Args:
        prospect: Dict avec les champs du prospect
        company: Dict avec les infos de l'entreprise
    
    Returns:
        String prompt complet
    """
    nom_complet = prospect.get("name", "").strip()
    prenom = prospect.get("prenom", "").strip() or nom_complet.split()[0] if nom_complet else ""
    nom = prospect.get("nom", "").strip() or " ".join(nom_complet.split()[1:]) if len(nom_complet.split()) > 1 else nom_complet
    poste = prospect.get("fonction", "").strip()
    entreprise = ""
    ville = ""
    if company:
        entreprise = f"{company.get('groupe', '')} ({company.get('site', '')})".strip(" ()")
        ville = company.get("site", "").strip()
    linkedin = (prospect.get("linkedin") or "").strip()
    
    return f"""Tu es un expert en prospection B2B pour une ESN spécialisée en systèmes embarqués, robotique et ingénierie industrielle (société UpTechnologie, Lyon).

Génère une fiche de préparation RDV complète au format JSON strict pour ce prospect :

Nom : {prenom} {nom}
Poste : {poste}
Entreprise : {entreprise}
Ville : {ville}
LinkedIn : {linkedin}

--- FORMAT DE SORTIE ATTENDU (JSON strict) ---
{{
  "qui_est_il": {{
    "resume": "2-3 phrases de synthèse sur son profil, sa sensibilité, ses priorités",
    "titre_actuel": "...",
    "parcours": "résumé du parcours en 1-2 phrases",
    "stack_specialites": ["...", "..."],
    "activite_complementaire": "freelance / autre activité éventuelle"
  }},
  "contexte_entreprise": {{
    "description": "description de l'entreprise en 2-3 phrases",
    "taille": "...",
    "secteurs": ["...", "..."],
    "metiers_autour": ["...", "..."],
    "conclusion_matching": "pourquoi ces métiers matchent avec des candidats embarqué/robotique/IA"
  }},
  "besoins_probables": {{
    "data_referentiels": ["..."],
    "digital_bi2b": ["..."],
    "automatisation": ["..."],
    "ressources_contraintes": ["..."],
    "candidats_a_positionner": ["Ingé embarqué / industrie 4.0", "Dev back-end / data", "Ingé systèmes / intégration"]
  }},
  "interlocuteurs_potentiels": {{
    "marketing_digital": ["..."],
    "commerce_technique": ["..."],
    "technique_projet": ["..."],
    "conclusion": "..."
  }}
}}

Réponds UNIQUEMENT avec le JSON, sans texte avant ni après.
"""


def build_fiche_rdv_pdf(prospect: Dict[str, Any], company: Dict[str, Any], ollama_data: Dict[str, Any]) -> BytesIO:
    """Génère un PDF A4 de fiche de préparation RDV avec ReportLab.
    
    Args:
        prospect: Dict avec les infos du prospect
        company: Dict avec les infos de l'entreprise
        ollama_data: Dict JSON parsé depuis la réponse Ollama
    
    Returns:
        BytesIO contenant le PDF généré
    """
    nom_complet = prospect.get("name", "").strip()
    # Extraire prénom et nom depuis name si prenom/nom ne sont pas définis
    if nom_complet:
        parts = nom_complet.split()
        prenom = prospect.get("prenom", "").strip() or (parts[0] if parts else "")
        nom = prospect.get("nom", "").strip() or (" ".join(parts[1:]) if len(parts) > 1 else "")
    else:
        prenom = prospect.get("prenom", "").strip() or ""
        nom = prospect.get("nom", "").strip() or ""
    
    # Fallback si toujours vide
    if not prenom and not nom:
        prenom = "Prospect"
        nom = ""
    
    poste = prospect.get("fonction", "").strip()
    entreprise_str = ""
    ville_str = ""
    if company:
        entreprise_str = f"{company.get('groupe', '')} ({company.get('site', '')})".strip(" ()")
        ville_str = company.get("site", "").strip()
    
    # Extraire les données Ollama
    qui_est_il = ollama_data.get("qui_est_il", {})
    contexte_entreprise = ollama_data.get("contexte_entreprise", {})
    besoins_probables = ollama_data.get("besoins_probables", {})
    interlocuteurs = ollama_data.get("interlocuteurs_potentiels", {})
    
    # Créer le buffer PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=1.8*cm,
        leftMargin=1.8*cm,
        topMargin=1.5*cm,
        bottomMargin=1.5*cm,
    )
    
    W, H = A4
    styles = getSampleStyleSheet()
    
    def S(name, parent='Normal', **kw):
        return ParagraphStyle(name, parent=styles[parent], **kw)
    
    # Couleurs
    GREY_DARK = colors.HexColor('#1A1A2E')
    GREY_MED = colors.HexColor('#2C3E50')
    BLUE_ACC = colors.HexColor('#2980B9')
    GREY_LINE = colors.HexColor('#BDC3C7')
    
    # Styles
    sMainTitle = S('MainTitle', fontName='Helvetica-Bold', fontSize=16, textColor=GREY_DARK,
                   spaceAfter=2, alignment=1, leading=20)
    sSubTitle = S('SubTitle', fontName='Helvetica', fontSize=9.5, textColor=GREY_MED,
                  spaceAfter=10, alignment=1, leading=14)
    sH1 = S('H1', fontName='Helvetica-Bold', fontSize=11.5, textColor=colors.white,
            spaceBefore=10, spaceAfter=4, leading=16)
    sH2 = S('H2', fontName='Helvetica-Bold', fontSize=10, textColor=GREY_DARK,
            spaceBefore=8, spaceAfter=2, leading=14)
    sH3 = S('H3', fontName='Helvetica-BoldOblique', fontSize=9, textColor=BLUE_ACC,
            spaceBefore=5, spaceAfter=2, leading=13)
    sBody = S('Body', fontName='Helvetica', fontSize=8.5, textColor=GREY_MED,
              spaceAfter=3, leading=13, alignment=4)
    sBullet = S('Bullet', fontName='Helvetica', fontSize=8.5, textColor=GREY_MED,
                spaceAfter=4, leading=14, leftIndent=10)
    sCheck = S('Check', fontName='Helvetica', fontSize=8.5, textColor=GREY_MED,
               spaceAfter=10, leading=18, leftIndent=12)
    sLink = S('Link', fontName='Helvetica-Bold', fontSize=8.5, textColor=GREY_DARK,
              spaceAfter=4, leading=14, leftIndent=10)
    
    def h1_block(text):
        tbl = Table([[Paragraph(text, sH1)]], colWidths=[W - 3.6*cm])
        tbl.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), GREY_MED),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
        ]))
        return tbl
    
    def hr():
        return HRFlowable(width='100%', thickness=0.5, color=GREY_LINE, spaceAfter=3, spaceBefore=2)
    
    def b(text):
        return f'<b>{text}</b>'
    
    def bullet(text):
        return Paragraph('• ' + text, sBullet)
    
    def check(text):
        return Paragraph('[ ]  ' + text, sCheck)
    
    story = []
    
    # HEADER
    story.append(Paragraph('FICHE PRÉPARATION RDV PROSPECTION', sMainTitle))
    story.append(Paragraph(
        f'Prospect : {prenom} {nom} – {poste} – {entreprise_str} ({ville_str})',
        sSubTitle
    ))
    story.append(HRFlowable(width='100%', thickness=2, color=BLUE_ACC, spaceAfter=10))
    
    # SECTION 1
    story.append(h1_block('SECTION 1 – SYNTHÈSE PROSPECT'))
    story.append(Spacer(1, 6))
    
    # 1. Qui est [Prénom] et ce qu'il fait
    story.append(Paragraph(f'1. Qui est {prenom} et ce qu\'il fait', sH2))
    story.append(hr())
    resume = qui_est_il.get("resume", "")
    if resume:
        story.append(Paragraph(resume, sBody))
    if qui_est_il.get("titre_actuel"):
        story.append(bullet(b('Titre actuel :') + ' ' + qui_est_il.get("titre_actuel", "")))
    if qui_est_il.get("parcours"):
        story.append(bullet(b('Parcours :') + ' ' + qui_est_il.get("parcours", "")))
    if qui_est_il.get("stack_specialites"):
        specs = qui_est_il.get("stack_specialites", [])
        if isinstance(specs, list):
            story.append(bullet(b('Spécialités :') + ' ' + ', '.join(specs)))
    if qui_est_il.get("activite_complementaire"):
        story.append(bullet(b('Activité complémentaire :') + ' ' + qui_est_il.get("activite_complementaire", "")))
    if resume:
        story.append(Paragraph(
            f'<i>En clair : {resume}</i>',
            sBody
        ))
    story.append(Spacer(1, 5))
    
    # 2. Entreprise : environnement et métiers
    entreprise_nom = company.get('groupe', '') if company else entreprise_str
    story.append(Paragraph(f'2. {entreprise_nom} : environnement et métiers autour de lui', sH2))
    story.append(hr())
    if contexte_entreprise.get("description"):
        story.append(Paragraph(contexte_entreprise.get("description", ""), sBody))
    if contexte_entreprise.get("metiers_autour"):
        story.append(Paragraph(b('Métiers autour de lui :'), sBody))
        metiers = contexte_entreprise.get("metiers_autour", [])
        if isinstance(metiers, list):
            for m in metiers:
                story.append(bullet(m))
    if contexte_entreprise.get("conclusion_matching"):
        story.append(Paragraph(
            contexte_entreprise.get("conclusion_matching", ""),
            sLink
        ))
    story.append(Spacer(1, 5))
    
    # 3. Besoins probables
    story.append(Paragraph('3. Ses besoins probables (angle UpTechnologie)', sH2))
    story.append(hr())
    
    if besoins_probables.get("data_referentiels"):
        story.append(Paragraph('Data produits & référentiels', sH3))
        for item in besoins_probables.get("data_referentiels", []):
            if item:
                story.append(bullet(item))
    
    if besoins_probables.get("digital_bi2b"):
        story.append(Paragraph('E-commerce / Digital B2B', sH3))
        for item in besoins_probables.get("digital_bi2b", []):
            if item:
                story.append(bullet(item))
    
    if besoins_probables.get("automatisation"):
        story.append(Paragraph('Automatisation / outils internes', sH3))
        for item in besoins_probables.get("automatisation", []):
            if item:
                story.append(bullet(item))
    
    if besoins_probables.get("ressources_contraintes"):
        story.append(Paragraph('Ressources et contraintes', sH3))
        for item in besoins_probables.get("ressources_contraintes", []):
            if item:
                story.append(bullet(item))
    
    if besoins_probables.get("candidats_a_positionner"):
        story.append(Paragraph(b('C\'est là que je peux positionner mes candidats :'), sBody))
        for item in besoins_probables.get("candidats_a_positionner", []):
            if item:
                story.append(bullet(item))
    story.append(Spacer(1, 5))
    
    # 4. Métiers avec lesquels il travaille
    story.append(Paragraph('4. Métiers avec lesquels il travaille (interlocuteurs potentiels)', sH2))
    story.append(hr())
    if interlocuteurs.get("marketing_digital"):
        for item in interlocuteurs.get("marketing_digital", []):
            if item:
                story.append(bullet(item))
    if interlocuteurs.get("commerce_technique"):
        for item in interlocuteurs.get("commerce_technique", []):
            if item:
                story.append(bullet(item))
    if interlocuteurs.get("technique_projet"):
        for item in interlocuteurs.get("technique_projet", []):
            if item:
                story.append(bullet(item))
    if interlocuteurs.get("conclusion"):
        story.append(Paragraph(
            '<i>' + interlocuteurs.get("conclusion", "") + '</i>',
            sBody
        ))
    story.append(Spacer(1, 8))
    
    # SECTION 2
    story.append(h1_block('SECTION 2 – CHECKLIST RDV'))
    story.append(Spacer(1, 6))
    
    # Checklist fixe (8 sections)
    checklist_sections = [
        ('1. Contexte prospect', [
            'Vérifier son rôle exact : périmètre des projets et responsabilités.',
            'Confirmer s\'il gère aussi les outils internes (suivi projets, outils service, connecteurs SI).',
            'Identifier ses interlocuteurs principaux : commerce, technique, service, qualité, IT/IS.',
            'Comprendre les liens entre projets industriels, service client et activité business.',
        ]),
        ('2. Enjeux et priorités actuelles', [
            'Projets prioritaires 2025–2026 côté projets internationaux / modernisation / service.',
            'Objectifs business : satisfaction client, disponibilité des installations, marges projets, développement d\'offres.',
            'KPIs suivis : respect planning, coûts, pannes, temps d\'arrêt, taux de satisfaction.',
            'Contraintes majeures : budget, délais, ressources internes techniques / projet.',
        ]),
        ('3. Irritants et points de blocage', [
            'Manque de ressources techniques (ingénieurs automation / soft / data industrielle).',
            'Complexité / rigidité du SI projets / SAV (ERP, outils maison, PLM).',
            'Qualité, structuration, mise à jour de la donnée technique (installations, interventions, pannes).',
            'Difficultés à interfacer le digital (outils projet, service, IIoT) avec les systèmes terrain.',
            'Besoin d\'outils spécifiques pour les équipes internes (checklists, configurateurs, tableaux de bord).',
        ]),
        ('4. Organisation et recours aux ressources externes', [
            'Comment ils gèrent les besoins ponctuels : interne, freelances, intégrateurs, ESN.',
            'S\'ils ont déjà travaillé avec des sociétés de conseil / placement d\'ingénieurs.',
            'Leurs critères de choix d\'un partenaire technique (réactivité, expertise industrielle, proximité, mode d\'intervention).',
            'Le process de décision : qui décide, qui influence, qui utilise les solutions au quotidien.',
        ]),
        ('5. Positionnement UpTechnologie à présenter', [
            'Ton rôle : ingénieur d\'affaires spécialisé en systèmes embarqués, robotique, ingénierie industrielle.',
            'Ce que fait UpTechnologie : placement de consultants / ingénieurs pour renforcer les équipes sur des projets techniques.',
            'Capacité à intervenir à l\'interface terrain (automates, capteurs, lignes) / logiciel (SI, outils internes, supervision).',
            'Proximité géographique et connaissance du tissu industriel AURA.',
        ]),
        ('6. Types de besoins où tu peux aider', [
            'Solutions connectées : remontée de données des équipements vers le SI / outils projets / service.',
            'Automatisation de flux et fiabilisation de la donnée (scripts, ETL, API, connecteurs entre outils).',
            'Outils métiers pour les équipes internes (configurateurs, simulateurs, dashboards, portails clients).',
            'Projets industrie 4.0 nécessitant du logiciel embarqué / temps réel.',
        ]),
        ('7. Profils candidats à évoquer', [
            'Ingénieur systèmes embarqués / industrie 4.0 (automates, capteurs, équipements terrain).',
            'Profil logiciel / data back-end (scripts, API, intégration SI industriel).',
            'Profil passerelle terrain ↔ digital, à l\'aise en environnement industriel lourd.',
        ]),
        ('8. Next steps à sécuriser', [
            'Proposer l\'envoi d\'un court récap des échanges.',
            'Proposer 2–3 exemples de profils types alignés avec son environnement.',
            'Valider un point de suivi (après cadrage projet / avant pic d\'activité).',
            'Noter ses préférences de contact (mail, téléphone, LinkedIn) et disponibilités.',
        ]),
    ]
    
    for title, items in checklist_sections:
        story.append(Paragraph(title, sH2))
        story.append(hr())
        for item in items:
            story.append(check(item))
        story.append(Spacer(1, 3))
    
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width='100%', thickness=1.5, color=BLUE_ACC, spaceAfter=4))
    story.append(Paragraph(b('Notes libres / observations à chaud :'), sH2))
    for _ in range(4):
        story.append(HRFlowable(width='100%', thickness=0.4, color=GREY_LINE, spaceBefore=14, spaceAfter=0))
    
    doc.build(story)
    buffer.seek(0)
    return buffer


@app.get("/api/rdv-checklist/themes")
def rdv_checklist_themes():
    """Return the reference checklist themes (read-only list)."""
    return jsonify(ok=True, themes=RDV_CHECKLIST_THEMES)


@app.get("/api/rdv-checklist")
def rdv_checklist_get():
    """Fetch saved checklist data for a prospect (owner only)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    pid = request.args.get("prospect_id", type=int)
    if not pid:
        return jsonify(ok=False, error="prospect_id requis"), 400
    if not _prospect_owned(pid):
        return jsonify(ok=False, error="Accès refusé"), 403
    with _conn() as conn:
        row = conn.execute(
            "SELECT data, updatedAt FROM rdv_checklists WHERE prospect_id=?", (pid,)
        ).fetchone()
    if row and row["data"]:
        return jsonify(ok=True, data=json.loads(row["data"]), updatedAt=row["updatedAt"])
    # Return blank structure
    blank = {t["key"]: {"reponse": "", "checked": False} for t in RDV_CHECKLIST_THEMES}
    return jsonify(ok=True, data=blank, updatedAt=None)


@app.post("/api/rdv-checklist")
def rdv_checklist_save():
    """Save checklist data for a prospect (upsert, owner only)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    body = request.get_json(force=True)
    pid = body.get("prospect_id")
    data = body.get("data")
    if not pid or data is None:
        return jsonify(ok=False, error="prospect_id et data requis"), 400
    if not _prospect_owned(int(pid)):
        return jsonify(ok=False, error="Accès refusé"), 403
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as conn:
        conn.execute(
            """INSERT INTO rdv_checklists (prospect_id, data, updatedAt)
               VALUES (?, ?, ?)
               ON CONFLICT(prospect_id)
               DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt""",
            (pid, json.dumps(data, ensure_ascii=False), now),
        )
    return jsonify(ok=True, updatedAt=now)


@app.post("/api/rdv-checklist/parse-file")
def rdv_checklist_parse_file():
    """Parse uploaded file (PDF, Word, Excel) and extract text content."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    if 'file' not in request.files:
        return jsonify(ok=False, error="Aucun fichier fourni"), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify(ok=False, error="Fichier vide"), 400

    ok_upload, err_upload = _validate_upload(file, "document_or_excel")
    if not ok_upload:
        return jsonify(ok=False, error=err_upload[0]), err_upload[1]

    filename = file.filename.lower()
    text = None

    try:
        if filename.endswith('.pdf'):
            from pypdf import PdfReader
            raw = file.read()
            reader = PdfReader(BytesIO(raw))
            text_parts = []
            for page in reader.pages:
                text_parts.append(page.extract_text() or '')
            text = '\n'.join(text_parts)
        
        elif filename.endswith(('.doc', '.docx')):
            from docx import Document
            doc = Document(BytesIO(file.read()))
            text_parts = []
            for para in doc.paragraphs:
                if para.text.strip():
                    text_parts.append(para.text)
            text = '\n'.join(text_parts)
        
        elif filename.endswith(('.xls', '.xlsx')):
            from openpyxl import load_workbook
            wb = load_workbook(BytesIO(file.read()), read_only=True)
            text_parts = []
            for sheet in wb.worksheets:
                for row in sheet.iter_rows(values_only=True):
                    row_text = ' | '.join(str(cell) if cell is not None else '' for cell in row)
                    if row_text.strip():
                        text_parts.append(row_text)
            text = '\n'.join(text_parts)
        
        elif filename.endswith('.txt'):
            text = file.read().decode('utf-8', errors='ignore')
        
        else:
            return jsonify(ok=False, error=f"Format de fichier non supporté: {filename}"), 400
        
        if not text or not text.strip():
            return jsonify(ok=False, error="Aucun texte extrait du fichier"), 400
        
        return jsonify(ok=True, text=text.strip())
    
    except Exception as e:
        import traceback
        _log_handler.handle(logging.LogRecord(
            name='prospup', level=logging.ERROR, pathname=__file__, lineno=0,
            msg=f"Erreur parsing fichier: {str(e)}\n{traceback.format_exc()}", args=(), exc_info=None
        ))
        return jsonify(ok=False, error=f"Erreur lors de l'extraction: {str(e)}"), 500

# ────────────────────────────────────────────────────────────────────
# Meetings – historique des réunions avec grille de qualification
# ────────────────────────────────────────────────────────────────────

@app.post("/api/meetings")
def meetings_create():
    """Créer une nouvelle réunion (CR de RDV) avec snapshot grille + IA fields + tâches inline."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    body, err = validate_payload({'prospect_id': (int, str), 'title': str})
    if err:
        return err
    prospect_id = body.get("prospect_id")
    title = body.get("title", "").strip()
    checklist_data = body.get("checklist_data")
    notes = body.get("notes", "").strip()
    raw_transcript = (body.get("raw_transcript") or "").strip()
    summary = (body.get("summary") or "").strip()
    next_action = (body.get("next_action") or "").strip()
    tags = body.get("tags") or []
    documents = (body.get("documents") or "").strip()
    date_override = (body.get("date") or "").strip()
    action_items = body.get("action_items") or []

    if not prospect_id:
        return jsonify(ok=False, error="prospect_id requis"), 400
    if not title:
        return jsonify(ok=False, error="Titre requis"), 400
    if not _prospect_owned(int(prospect_id)):
        return jsonify(ok=False, error="Accès refusé"), 403

    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    elif isinstance(tags, list):
        tags = [str(t).strip() for t in tags if str(t).strip()]
    else:
        tags = []

    now = datetime.datetime.now().isoformat(timespec="seconds")
    today = date_override if date_override else datetime.datetime.now().strftime("%Y-%m-%d")

    with _conn() as conn:
        cursor = conn.execute(
            """INSERT INTO meetings (prospect_id, owner_id, date, title, checklist_data, notes,
                                    summary, raw_transcript, next_action, tags, documents, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                prospect_id, uid, today, title,
                json.dumps(checklist_data, ensure_ascii=False) if checklist_data else None,
                notes, summary, raw_transcript, next_action,
                json.dumps(tags, ensure_ascii=False) if tags else None,
                documents, now,
            )
        )
        meeting_id = cursor.lastrowid

        # Action items inline (créés en même temps que le CR)
        for ai in action_items:
            if not isinstance(ai, dict):
                continue
            task_txt = (ai.get("task") or "").strip()
            if not task_txt:
                continue
            conn.execute(
                """INSERT INTO meeting_action_items (meeting_id, prospect_id, task, assignee, due_date, priority, status, owner_id, createdAt)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    meeting_id, prospect_id, task_txt,
                    (ai.get("assignee") or None),
                    (ai.get("due_date") or None),
                    (ai.get("priority") or None),
                    (ai.get("status") or "pending"),
                    uid, now,
                )
            )

        # Hook: réunion créée (meeting_done)
        try:
            p_row = conn.execute(
                "SELECT id, name, email, telephone, linkedin, statut, pertinence, nextFollowUp, company_id FROM prospects WHERE id=? AND owner_id=?;",
                (prospect_id, uid)
            ).fetchone()
            if p_row:
                context = {
                    "prospect_id": p_row["id"],
                    "name": p_row["name"] or "",
                    "email": p_row["email"],
                    "telephone": p_row["telephone"],
                    "linkedin": p_row["linkedin"],
                    "statut": p_row["statut"],
                    "pertinence": p_row["pertinence"],
                    "nextFollowUp": p_row["nextFollowUp"],
                    "company_id": p_row["company_id"],
                    "meeting_title": title,
                    "meeting_notes": notes,
                }
                if context.get("company_id"):
                    c_row = conn.execute(
                        "SELECT groupe FROM companies WHERE id=? AND owner_id=?;",
                        (context["company_id"], uid)
                    ).fetchone()
                    if c_row:
                        context["company_groupe"] = c_row["groupe"] or ""
                _create_auto_task("meeting_done", context)
        except Exception as e:
            logger.warning("Erreur hook tâche auto pour réunion: %s", e)

        # v32.0 : rattacher des pièces jointes existantes au CR
        attachment_ids = body.get("attachment_ids") or []
        if isinstance(attachment_ids, list):
            for aid in attachment_ids:
                try:
                    aid_i = int(aid)
                    conn.execute(
                        "UPDATE prospect_attachments SET meeting_id = ? WHERE id = ? AND owner_id = ? AND prospect_id = ?",
                        (meeting_id, aid_i, uid, prospect_id)
                    )
                except (TypeError, ValueError):
                    continue

    return jsonify(ok=True, id=meeting_id, date=today)


def _meeting_row_to_dict(row, with_checklist=True):
    checklist = None
    if with_checklist and row["checklist_data"]:
        try:
            checklist = json.loads(row["checklist_data"])
        except Exception:
            pass
    tags = []
    try:
        if "tags" in row.keys() and row["tags"]:
            tags = json.loads(row["tags"]) or []
    except Exception:
        tags = []
    out = {
        "id": row["id"],
        "date": row["date"],
        "title": row["title"],
        "notes": row["notes"] or "",
        "summary": (row["summary"] if "summary" in row.keys() else "") or "",
        "raw_transcript": (row["raw_transcript"] if "raw_transcript" in row.keys() else "") or "",
        "next_action": (row["next_action"] if "next_action" in row.keys() else "") or "",
        "tags": tags,
        "documents": (row["documents"] if "documents" in row.keys() else "") or "",
        "createdAt": row["createdAt"],
    }
    if with_checklist:
        out["checklist_data"] = checklist
    return out


@app.get("/api/meetings")
def meetings_list():
    """Lister les réunions d'un prospect (owner only) — légère, sans grille détaillée."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    prospect_id = request.args.get("prospect_id", type=int)
    if not prospect_id:
        return jsonify(ok=False, error="prospect_id requis"), 400
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403

    with _conn() as conn:
        rows = conn.execute(
            """SELECT m.id, m.date, m.title, m.checklist_data, m.notes,
                      m.summary, m.raw_transcript, m.next_action, m.tags, m.documents, m.createdAt,
                      (SELECT COUNT(*) FROM meeting_action_items ai WHERE ai.meeting_id = m.id) AS action_count,
                      (SELECT COUNT(*) FROM meeting_action_items ai WHERE ai.meeting_id = m.id AND ai.status != 'done') AS action_pending
               FROM meetings m
               WHERE m.prospect_id = ? AND m.owner_id = ?
               ORDER BY m.date DESC, m.createdAt DESC""",
            (prospect_id, uid)
        ).fetchall()

    meetings = []
    for row in rows:
        m = _meeting_row_to_dict(row, with_checklist=False)
        m["action_count"] = row["action_count"] or 0
        m["action_pending"] = row["action_pending"] or 0
        meetings.append(m)

    return jsonify(ok=True, meetings=meetings)


@app.get("/api/meetings/<int:meeting_id>")
def meetings_get(meeting_id):
    """Détail d'une réunion : CR + grille snapshot + action items."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        row = conn.execute(
            """SELECT id, prospect_id, date, title, checklist_data, notes,
                      summary, raw_transcript, next_action, tags, documents, createdAt
               FROM meetings WHERE id = ? AND owner_id = ?""",
            (meeting_id, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Réunion introuvable"), 404
        meeting = _meeting_row_to_dict(row)
        meeting["prospect_id"] = row["prospect_id"]

        ai_rows = conn.execute(
            """SELECT id, task, assignee, due_date, priority, status, createdAt
               FROM meeting_action_items
               WHERE meeting_id = ? AND owner_id = ?
               ORDER BY status ASC, due_date ASC, createdAt ASC""",
            (meeting_id, uid)
        ).fetchall()
        meeting["action_items"] = [{
            "id": r["id"], "task": r["task"], "assignee": r["assignee"],
            "due_date": r["due_date"], "priority": r["priority"],
            "status": r["status"], "createdAt": r["createdAt"],
        } for r in ai_rows]

        # v32.0 : pièces jointes liées au CR
        att_rows = conn.execute(
            """SELECT id, original_name, size, mime_type, thumbnail
               FROM prospect_attachments
               WHERE meeting_id = ? AND owner_id = ?
               ORDER BY createdAt DESC""",
            (meeting_id, uid)
        ).fetchall()
        meeting["attachments"] = [{
            "id": r["id"], "original_name": r["original_name"],
            "size": r["size"] or 0, "mime_type": r["mime_type"] or "",
            "has_thumbnail": bool(r["thumbnail"]),
        } for r in att_rows]

    return jsonify(ok=True, meeting=meeting)


@app.put("/api/meetings/<int:meeting_id>")
def meetings_update(meeting_id):
    """Mettre à jour un CR existant. Le payload remplace les action_items si fourni."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    body = request.get_json(force=True) or {}

    with _conn() as conn:
        existing = conn.execute(
            "SELECT id, prospect_id FROM meetings WHERE id = ? AND owner_id = ?",
            (meeting_id, uid)
        ).fetchone()
        if not existing:
            return jsonify(ok=False, error="Réunion introuvable"), 404

        prospect_id = existing["prospect_id"]
        sets = []
        vals = []

        for key in ("title", "date", "notes", "summary", "raw_transcript", "next_action", "documents"):
            if key in body:
                sets.append(f"{key} = ?")
                vals.append((body.get(key) or "").strip() if isinstance(body.get(key), str) else body.get(key))

        if "checklist_data" in body:
            cd = body.get("checklist_data")
            sets.append("checklist_data = ?")
            vals.append(json.dumps(cd, ensure_ascii=False) if cd else None)

        if "tags" in body:
            tags = body.get("tags") or []
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(",") if t.strip()]
            elif isinstance(tags, list):
                tags = [str(t).strip() for t in tags if str(t).strip()]
            else:
                tags = []
            sets.append("tags = ?")
            vals.append(json.dumps(tags, ensure_ascii=False) if tags else None)

        if not sets and "action_items" not in body:
            return jsonify(ok=False, error="Aucun champ à mettre à jour"), 400

        if sets:
            vals.append(meeting_id)
            conn.execute(f"UPDATE meetings SET {', '.join(sets)} WHERE id = ?", vals)

        if "action_items" in body:
            now = datetime.datetime.now().isoformat(timespec="seconds")
            conn.execute("DELETE FROM meeting_action_items WHERE meeting_id = ? AND owner_id = ?", (meeting_id, uid))
            for ai in (body.get("action_items") or []):
                if not isinstance(ai, dict):
                    continue
                task_txt = (ai.get("task") or "").strip()
                if not task_txt:
                    continue
                conn.execute(
                    """INSERT INTO meeting_action_items (meeting_id, prospect_id, task, assignee, due_date, priority, status, owner_id, createdAt)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        meeting_id, prospect_id, task_txt,
                        (ai.get("assignee") or None),
                        (ai.get("due_date") or None),
                        (ai.get("priority") or None),
                        (ai.get("status") or "pending"),
                        uid, now,
                    )
                )

        # v32.0 : remplacer la liste de pièces jointes liées au CR
        if "attachment_ids" in body:
            attachment_ids = body.get("attachment_ids") or []
            # Détacher tout ce qui était lié
            conn.execute(
                "UPDATE prospect_attachments SET meeting_id = NULL WHERE meeting_id = ? AND owner_id = ?",
                (meeting_id, uid)
            )
            if isinstance(attachment_ids, list):
                for aid in attachment_ids:
                    try:
                        aid_i = int(aid)
                        conn.execute(
                            "UPDATE prospect_attachments SET meeting_id = ? WHERE id = ? AND owner_id = ? AND prospect_id = ?",
                            (meeting_id, aid_i, uid, prospect_id)
                        )
                    except (TypeError, ValueError):
                        continue

    return jsonify(ok=True, id=meeting_id)


@app.delete("/api/meetings/<int:meeting_id>")
def meetings_delete(meeting_id):
    """Supprimer un CR (cascade sur action_items et opportunities via FK)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM meetings WHERE id = ? AND owner_id = ?",
            (meeting_id, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Réunion introuvable"), 404
        conn.execute("DELETE FROM meeting_action_items WHERE meeting_id = ? AND owner_id = ?", (meeting_id, uid))
        conn.execute("DELETE FROM meeting_opportunities WHERE meeting_id = ? AND owner_id = ?", (meeting_id, uid))
        conn.execute("DELETE FROM meetings WHERE id = ? AND owner_id = ?", (meeting_id, uid))

    return jsonify(ok=True)


@app.put("/api/meeting-action-items/<int:item_id>")
def meeting_action_item_update(item_id):
    """Mettre à jour un action item (cocher fait, modifier libellé/date/priorité)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    body = request.get_json(force=True) or {}

    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM meeting_action_items WHERE id = ? AND owner_id = ?",
            (item_id, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Tâche introuvable"), 404

        sets = []
        vals = []
        for key in ("task", "assignee", "due_date", "priority", "status"):
            if key in body:
                sets.append(f"{key} = ?")
                v = body.get(key)
                vals.append(v.strip() if isinstance(v, str) else v)
        if not sets:
            return jsonify(ok=False, error="Aucun champ à mettre à jour"), 400
        vals.append(item_id)
        conn.execute(f"UPDATE meeting_action_items SET {', '.join(sets)} WHERE id = ?", vals)

    return jsonify(ok=True)


@app.delete("/api/meeting-action-items/<int:item_id>")
def meeting_action_item_delete(item_id):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM meeting_action_items WHERE id = ? AND owner_id = ?",
            (item_id, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Tâche introuvable"), 404
        conn.execute("DELETE FROM meeting_action_items WHERE id = ? AND owner_id = ?", (item_id, uid))

    return jsonify(ok=True)


@app.get("/api/meetings/<int:meeting_id>/action-items")
def meetings_action_items_list(meeting_id):
    """Lister les action items d'une réunion."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    with _conn() as conn:
        # Vérifier que la réunion existe et appartient à l'utilisateur
        meeting = conn.execute(
            "SELECT id, prospect_id FROM meetings WHERE id = ? AND owner_id = ?",
            (meeting_id, uid)
        ).fetchone()
        if not meeting:
            return jsonify(ok=False, error="Réunion introuvable"), 404
        
        rows = conn.execute(
            """SELECT id, task, assignee, due_date, priority, status, createdAt
               FROM meeting_action_items
               WHERE meeting_id = ? AND owner_id = ?
               ORDER BY due_date ASC, priority DESC, createdAt ASC""",
            (meeting_id, uid)
        ).fetchall()
    
    action_items = []
    for row in rows:
        action_items.append({
            "id": row["id"],
            "task": row["task"],
            "assignee": row["assignee"],
            "due_date": row["due_date"],
            "priority": row["priority"],
            "status": row["status"],
            "createdAt": row["createdAt"]
        })
    
    return jsonify(ok=True, action_items=action_items)


@app.post("/api/meetings/<int:meeting_id>/action-items")
def meetings_action_items_create(meeting_id):
    """Créer un action item pour une réunion."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    body = request.get_json(force=True)
    task = body.get("task", "").strip()
    assignee = body.get("assignee")
    due_date = body.get("due_date")
    priority = body.get("priority")
    
    if not task:
        return jsonify(ok=False, error="task requis"), 400
    
    with _conn() as conn:
        # Vérifier que la réunion existe et appartient à l'utilisateur
        meeting = conn.execute(
            "SELECT id, prospect_id FROM meetings WHERE id = ? AND owner_id = ?",
            (meeting_id, uid)
        ).fetchone()
        if not meeting:
            return jsonify(ok=False, error="Réunion introuvable"), 404
        
        prospect_id = meeting["prospect_id"]
        now = datetime.datetime.now().isoformat(timespec="seconds")
        
        cursor = conn.execute(
            """INSERT INTO meeting_action_items (meeting_id, prospect_id, task, assignee, due_date, priority, status, owner_id, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (meeting_id, prospect_id, task, assignee, due_date, priority, uid, now)
        )
        action_item_id = cursor.lastrowid
    
    return jsonify(ok=True, id=action_item_id)


@app.get("/api/meetings/<int:meeting_id>/opportunities")
def meetings_opportunities_list(meeting_id):
    """Lister les opportunités d'une réunion."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    with _conn() as conn:
        # Vérifier que la réunion existe et appartient à l'utilisateur
        meeting = conn.execute(
            "SELECT id, prospect_id FROM meetings WHERE id = ? AND owner_id = ?",
            (meeting_id, uid)
        ).fetchone()
        if not meeting:
            return jsonify(ok=False, error="Réunion introuvable"), 404
        
        rows = conn.execute(
            """SELECT id, type, estimated_value, probability, description, createdAt
               FROM meeting_opportunities
               WHERE meeting_id = ? AND owner_id = ?
               ORDER BY estimated_value DESC, probability DESC, createdAt ASC""",
            (meeting_id, uid)
        ).fetchall()
    
    opportunities = []
    for row in rows:
        opportunities.append({
            "id": row["id"],
            "type": row["type"],
            "estimated_value": row["estimated_value"],
            "probability": row["probability"],
            "description": row["description"],
            "createdAt": row["createdAt"]
        })
    
    return jsonify(ok=True, opportunities=opportunities)


@app.post("/api/meetings/<int:meeting_id>/opportunities")
def meetings_opportunities_create(meeting_id):
    """Créer une opportunité pour une réunion."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    body = request.get_json(force=True)
    type_opp = body.get("type", "").strip()
    estimated_value = body.get("estimated_value")
    probability = body.get("probability")
    description = body.get("description")
    
    if not type_opp:
        return jsonify(ok=False, error="type requis"), 400
    
    with _conn() as conn:
        # Vérifier que la réunion existe et appartient à l'utilisateur
        meeting = conn.execute(
            "SELECT id, prospect_id FROM meetings WHERE id = ? AND owner_id = ?",
            (meeting_id, uid)
        ).fetchone()
        if not meeting:
            return jsonify(ok=False, error="Réunion introuvable"), 404
        
        prospect_id = meeting["prospect_id"]
        now = datetime.datetime.now().isoformat(timespec="seconds")
        
        cursor = conn.execute(
            """INSERT INTO meeting_opportunities (meeting_id, prospect_id, type, estimated_value, probability, description, owner_id, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (meeting_id, prospect_id, type_opp, estimated_value, probability, description, uid, now)
        )
        opportunity_id = cursor.lastrowid
    
    return jsonify(ok=True, id=opportunity_id)


@app.get("/api/meetings/<int:meeting_id>/pdf")
def meetings_export_pdf(meeting_id):
    """Exporter une réunion en PDF."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    with _conn() as conn:
        row = conn.execute(
            """SELECT m.id, m.prospect_id, m.date, m.title, m.checklist_data, m.notes, m.createdAt,
                      p.name as prospect_name, p.fonction, c.groupe as company_name, c.site
               FROM meetings m
               JOIN prospects p ON m.prospect_id = p.id
               LEFT JOIN companies c ON p.company_id = c.id
               WHERE m.id = ? AND m.owner_id = ?""",
            (meeting_id, uid)
        ).fetchone()
    
    if not row:
        return jsonify(ok=False, error="Réunion introuvable"), 404
    
    # Parse checklist data
    checklist = None
    if row["checklist_data"]:
        try:
            checklist = json.loads(row["checklist_data"])
        except Exception:
            pass
    
    # Load themes for display
    themes_dict = {t["key"]: t for t in RDV_CHECKLIST_THEMES}
    
    # Generate HTML for PDF
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: Arial, sans-serif; padding: 40px; line-height: 1.6; color: #333; }}
            h1 {{ color: #f59e0b; border-bottom: 3px solid #f59e0b; padding-bottom: 10px; }}
            h2 {{ color: #6366f1; margin-top: 30px; }}
            .header {{ margin-bottom: 30px; }}
            .info-row {{ margin: 8px 0; }}
            .info-label {{ font-weight: bold; display: inline-block; width: 150px; }}
            .section {{ margin: 20px 0; padding: 15px; background: #f9fafb; border-left: 4px solid #6366f1; }}
            .theme-title {{ font-weight: bold; color: #6366f1; margin-top: 15px; }}
            .theme-question {{ color: #666; font-style: italic; margin: 5px 0; }}
            .theme-answer {{ margin: 10px 0 20px 20px; white-space: pre-wrap; }}
            .notes {{ margin-top: 30px; padding: 15px; background: #fff3cd; border-left: 4px solid #f59e0b; }}
        </style>
    </head>
    <body>
        <h1>Compte-rendu de réunion</h1>
        <div class="header">
            <div class="info-row"><span class="info-label">Date :</span> {escape_html(str(row["date"] or ""))}</div>
            <div class="info-row"><span class="info-label">Titre :</span> {escape_html(str(row["title"] or ""))}</div>
            <div class="info-row"><span class="info-label">Prospect :</span> {escape_html(str(row["prospect_name"] or ""))}</div>
            <div class="info-row"><span class="info-label">Fonction :</span> {escape_html(str(row["fonction"] or ""))}</div>
            <div class="info-row"><span class="info-label">Entreprise :</span> {escape_html(str((row["company_name"] or "") + (" (" + (row["site"] or "") + ")" if row["site"] else "")))}</div>
        </div>
    """
    
    if checklist:
        html_content += "<h2>Grille de qualification</h2>"
        for key, data in checklist.items():
            if not data or not isinstance(data, dict):
                continue
            theme = themes_dict.get(key)
            if not theme:
                continue
            reponse = data.get("reponse", "").strip()
            if not reponse:
                continue
            html_content += f"""
            <div class="section">
                <div class="theme-title">{escape_html(str(theme["theme"]))}</div>
                <div class="theme-question">{escape_html(str(theme["question"]))}</div>
                <div class="theme-answer">{escape_html(str(reponse))}</div>
            </div>
            """
    
    if row["notes"]:
        html_content += f'<div class="notes"><strong>Notes complémentaires :</strong><br>{escape_html(str(row["notes"]))}</div>'
    
    html_content += """
    </body>
    </html>
    """
    
    # Convert HTML to PDF using weasyprint (fallback to HTML if not available)
    try:
        from weasyprint import HTML
        pdf_bytes = HTML(string=html_content).write_pdf()
        return send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"reunion_{row['date']}_{meeting_id}.pdf"
        )
    except ImportError:
        # Fallback: return HTML that can be printed to PDF by browser (Ctrl+P > Enregistrer en PDF)
        return Response(
            html_content,
            mimetype="text/html",
            headers={"Content-Disposition": f'inline; filename="reunion_{row["date"]}_{meeting_id}.html"'}
        )


# ═══════════════════════════════════════════════════════════════════
# v31.9: Pièces jointes prospect — upload, liste, téléchargement, suppression
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/prospect/attachments")
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


@app.get("/api/prospect/attachments")
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


@app.get("/api/prospect/attachments/<int:att_id>/thumb")
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


@app.patch("/api/prospect/attachments/<int:att_id>")
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


@app.get("/api/prospect/attachments/<int:att_id>/file")
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


@app.delete("/api/prospect/attachments/<int:att_id>")
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


# ─── Lot 4 : Résumé IA d'une fiche prospect ────────────────────────

def _build_summary_prompt(prospect: dict, events: list, attachments: list) -> str:
    """Construit le prompt pour résumer un prospect à partir de son historique."""
    lines = []
    lines.append("Tu es un assistant CRM qui synthétise des fiches prospect B2B.")
    lines.append("Génère un résumé en 5 lignes maximum, factuel, actionnable, en français.")
    lines.append("Structure : 1) Qui (rôle, entreprise) 2) Statut commercial 3) Derniers échanges clés 4) Points d'accroche 5) Prochaine action recommandée.")
    lines.append("")
    lines.append("=== PROSPECT ===")
    lines.append(f"Nom : {prospect.get('name') or '—'}")
    lines.append(f"Fonction : {prospect.get('fonction') or '—'}")
    lines.append(f"Entreprise : {prospect.get('company_groupe') or '—'}{(' · ' + prospect.get('company_site')) if prospect.get('company_site') else ''}")
    lines.append(f"Statut : {prospect.get('statut') or '—'}")
    lines.append(f"Pertinence : {prospect.get('pertinence') or 0}/5")
    if prospect.get("notes"):
        lines.append(f"Notes : {(prospect.get('notes') or '')[:500]}")
    lines.append("")
    lines.append("=== HISTORIQUE (du plus récent au plus ancien) ===")
    for e in events[:30]:
        date = (e.get("date") or "")[:10]
        title = e.get("title") or e.get("type") or ""
        content = (e.get("content") or "")[:300]
        meta = e.get("meta") or {}
        extras = []
        if meta.get("next_action"):
            extras.append(f"prochaine action: {meta.get('next_action')[:200]}")
        if meta.get("action_pending"):
            extras.append(f"{meta['action_pending']} tâches en attente")
        ex_str = (" | " + " · ".join(extras)) if extras else ""
        lines.append(f"- [{date}] {title}{(': ' + content) if content else ''}{ex_str}")
    if attachments:
        lines.append("")
        lines.append("=== DOCUMENTS ASSOCIÉS ===")
        for a in attachments[:15]:
            tags = a.get("tags") or []
            tag_str = (" [" + ", ".join(tags) + "]") if tags else ""
            lines.append(f"- {a.get('original_name')}{tag_str}")
    lines.append("")
    lines.append("=== RÉSUMÉ (5 lignes max) ===")
    return "\n".join(lines)


@app.post("/api/prospect/<int:prospect_id>/summarize")
def api_prospect_summarize(prospect_id):
    """Génère un résumé IA de la fiche (cache en DB, force=1 pour régénérer)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403

    body = request.get_json(silent=True) or {}
    force = bool(body.get("force"))

    with _conn() as conn:
        if not force:
            cached = conn.execute(
                "SELECT summary, generatedAt FROM prospect_summaries WHERE prospect_id = ? AND owner_id = ?",
                (prospect_id, uid)
            ).fetchone()
            if cached and cached["summary"]:
                return jsonify(ok=True, summary=cached["summary"], generatedAt=cached["generatedAt"], cached=True)

        # Récolter les données nécessaires
        prow = conn.execute(
            "SELECT p.*, c.groupe AS company_groupe, c.site AS company_site "
            "FROM prospects p LEFT JOIN companies c ON c.id = p.company_id "
            "WHERE p.id = ? AND p.owner_id = ?",
            (prospect_id, uid)
        ).fetchone()
        if not prow:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        prospect = dict(prow)

        # Events : on construit une liste similaire à api_prospect_timeline (light)
        events: list = []
        try:
            call_notes = json.loads(prospect.get("callNotes") or "[]")
            for n in call_notes:
                if isinstance(n, dict):
                    events.append({"type": "call_note", "date": n.get("date") or "",
                                   "title": "Note d'appel", "content": n.get("content") or ""})
        except Exception:
            pass
        try:
            for r in conn.execute(
                "SELECT date, type, title, content FROM prospect_events WHERE prospect_id = ? ORDER BY date DESC LIMIT 40",
                (prospect_id,)
            ).fetchall():
                events.append({"type": r["type"], "date": r["date"], "title": r["title"] or "", "content": r["content"] or ""})
        except Exception:
            pass
        try:
            for r in conn.execute(
                "SELECT m.date, m.title, m.summary, m.next_action, "
                "(SELECT COUNT(*) FROM meeting_action_items ai WHERE ai.meeting_id = m.id AND ai.status != 'done') AS pending "
                "FROM meetings m WHERE m.prospect_id = ? AND m.owner_id = ? ORDER BY m.date DESC LIMIT 20",
                (prospect_id, uid)
            ).fetchall():
                events.append({
                    "type": "cr", "date": r["date"], "title": r["title"] or "Compte-rendu",
                    "content": r["summary"] or "",
                    "meta": {"next_action": r["next_action"] or "", "action_pending": r["pending"] or 0}
                })
        except Exception:
            pass
        try:
            for r in conn.execute(
                "SELECT sentAt, channel, subject FROM push_logs WHERE prospect_id = ? ORDER BY id DESC LIMIT 10",
                (prospect_id,)
            ).fetchall():
                events.append({"type": "push", "date": r["sentAt"] or "",
                               "title": f"Push ({r['channel'] or 'email'})",
                               "content": r["subject"] or ""})
        except Exception:
            pass

        events = sorted(events, key=lambda e: str(e.get("date") or ""), reverse=True)

        attachments: list = []
        try:
            for r in conn.execute(
                "SELECT original_name, tags FROM prospect_attachments WHERE prospect_id = ? AND owner_id = ?",
                (prospect_id, uid)
            ).fetchall():
                tags = []
                try:
                    tags = json.loads(r["tags"] or "[]") or []
                except Exception:
                    pass
                attachments.append({"original_name": r["original_name"], "tags": tags})
        except Exception:
            pass

    prompt = _build_summary_prompt(prospect, events, attachments)

    try:
        text = _call_ai(prompt, timeout=120)
    except Exception as e:
        logger.warning("[summarize] IA call failed pid=%s: %s", prospect_id, e)
        return jsonify(ok=False, error=f"IA indisponible : {e}"), 503

    summary = (text or "").strip()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        conn.execute(
            """INSERT INTO prospect_summaries (prospect_id, owner_id, summary, generatedAt)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(prospect_id) DO UPDATE SET summary = excluded.summary, generatedAt = excluded.generatedAt, owner_id = excluded.owner_id""",
            (prospect_id, uid, summary, now)
        )
    return jsonify(ok=True, summary=summary, generatedAt=now, cached=False)


@app.get("/api/prospect/upcoming-rdvs")
def api_prospect_upcoming_rdvs():
    """Liste les prospects dont le prochain RDV est dans les 48h.

    Utilisé par notifications.js côté client pour rappeler les RDV imminents.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    today = datetime.date.today().isoformat()
    plus2 = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()

    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, name, nextFollowUp, statut, fonction
               FROM prospects
               WHERE owner_id = ?
                 AND nextFollowUp IS NOT NULL
                 AND nextFollowUp != ''
                 AND date(substr(nextFollowUp,1,10)) BETWEEN date(?) AND date(?)
                 AND (deleted_at IS NULL OR deleted_at = '')
               ORDER BY nextFollowUp ASC
               LIMIT 30""",
            (uid, today, plus2)
        ).fetchall()
    items = [{
        "id": r["id"], "name": r["name"] or "", "nextFollowUp": r["nextFollowUp"],
        "statut": r["statut"] or "", "fonction": r["fonction"] or ""
    } for r in rows]
    return jsonify(ok=True, prospects=items)


# ═══════════════════════════════════════════════════════════════════
# v26.3: Routes API pour "Avant réunion IA" — streaming SSE et génération PDF
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/prospect/<int:prospect_id>/infos-rdv-stream")
@login_required
def api_prospect_infos_rdv_stream(prospect_id: int):
    """Route SSE pour analyser un prospect via IA (Tavily+Ollama si configuré, sinon Ollama seul).

    Stream les tokens en temps réel, puis stocke la réponse complète dans
    _rdv_analysis_cache (et non en session, car la session n'est pas persistée
    dans les réponses SSE streaming) pour la génération PDF ultérieure.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403

    with _conn() as conn:
        prospect_row = conn.execute(
            "SELECT * FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid)
        ).fetchone()
        if not prospect_row:
            return jsonify(ok=False, error="Prospect introuvable"), 404

        prospect = dict(prospect_row)
        company = None
        if prospect.get("company_id"):
            company_row = conn.execute(
                "SELECT * FROM companies WHERE id=? AND owner_id=?;",
                (prospect["company_id"], uid)
            ).fetchone()
            if company_row:
                company = dict(company_row)

    prompt = build_ollama_prompt_rdv(prospect, company)
    fallback_prompt = build_fallback_prompt_rdv(prospect, company)
    cache_key = f"{uid}_{prospect_id}"

    def generate():
        full_response_parts: list[str] = []
        try:
            for sse_line in _stream_ai_web_sse(prompt, None, OLLAMA_TIMEOUT):
                if not sse_line.startswith("data: "):
                    yield sse_line
                    continue
                raw = sse_line[6:].strip()
                if not raw:
                    continue
                try:
                    evt = json.loads(raw)
                except json.JSONDecodeError:
                    yield sse_line
                    continue

                evt_type = evt.get("type")
                if evt_type == "token":
                    # Normalise la clé 'text' (Ollama/Tavily générique) → 'content' (frontend rdv)
                    token = evt.get("text") or evt.get("content") or ""
                    if token:
                        full_response_parts.append(token)
                    yield f"data: {json.dumps({'type': 'token', 'content': token}, ensure_ascii=False)}\n\n"
                elif evt_type == "end":
                    # Fin du stream : sauvegarder dans le cache et envoyer 'done'
                    full_text = "".join(full_response_parts)
                    if full_text:
                        _rdv_analysis_cache[cache_key] = full_text
                    yield f"data: {json.dumps({'type': 'done', 'pdf_url': f'/api/prospect/{prospect_id}/download-rdv-pdf'}, ensure_ascii=False)}\n\n"
                elif evt_type in ("start", "status"):
                    yield sse_line
                elif evt_type == "error":
                    yield f"data: {json.dumps({'type': 'error', 'fallback_prompt': fallback_prompt}, ensure_ascii=False)}\n\n"
                else:
                    yield sse_line
        except Exception:
            logger.exception("infos-rdv-stream failed")
            yield f"data: {json.dumps({'type': 'error', 'fallback_prompt': fallback_prompt}, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.get("/api/prospect/<int:prospect_id>/download-rdv-pdf")
@login_required
def api_prospect_download_rdv_pdf(prospect_id: int):
    """Route pour télécharger le PDF de fiche de préparation RDV.
    
    Récupère la réponse Ollama stockée en session, parse le JSON, et génère le PDF.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    # Vérifier que le prospect appartient à l'utilisateur
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403
    
    # Récupérer la réponse IA depuis le cache en mémoire (session inutilisable en SSE)
    cache_key = f"{uid}_{prospect_id}"
    ollama_response = _rdv_analysis_cache.pop(cache_key, None)
    if not ollama_response:
        return jsonify(ok=False, error="Aucune analyse disponible. Relancez la génération."), 404
    
    # Récupérer le prospect et l'entreprise
    with _conn() as conn:
        prospect_row = conn.execute(
            "SELECT * FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid)
        ).fetchone()
        if not prospect_row:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        
        prospect = dict(prospect_row)
        company = None
        if prospect.get("company_id"):
            company_row = conn.execute(
                "SELECT * FROM companies WHERE id=? AND owner_id=?;",
                (prospect["company_id"], uid)
            ).fetchone()
            if company_row:
                company = dict(company_row)
    
    # Parser le JSON depuis la réponse Ollama
    # Extraction robuste : équilibrage des accolades pour ignorer le texte
    # autour du JSON (Sources, commentaires…) que Tavily/Ollama peut ajouter.
    def _extract_json_from_text(text):
        """Extrait le premier objet JSON complet depuis un texte potentiellement pollué."""
        import re as _re
        # 1. Tenter un bloc markdown ```json ... ```
        m = _re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, _re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                pass
        # 2. Équilibrage des accolades : premier { ... } fermant correctement
        start = text.find('{')
        if start == -1:
            raise ValueError("Aucun JSON trouvé dans la réponse IA")
        depth = 0
        for i, c in enumerate(text[start:], start):
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return json.loads(text[start:i + 1])
        raise ValueError("JSON incomplet dans la réponse IA")

    try:
        ollama_data = _extract_json_from_text(ollama_response)
    except (ValueError, json.JSONDecodeError) as e:
        logger.warning("Erreur parsing JSON Ollama RDV: %s — réponse brute: %s", e, ollama_response[:300])
        return jsonify(ok=False, error="Format de réponse IA invalide. Réessayez."), 400
    
    # Générer le PDF
    try:
        pdf_buffer = build_fiche_rdv_pdf(prospect, company, ollama_data)

        # Nom du fichier
        nom_complet = prospect.get("name", "").strip() or "prospect"
        nom_safe = "".join(c for c in nom_complet if c.isalnum() or c in (' ', '-', '_')).strip()[:50]
        filename = f"fiche_rdv_{nom_safe}.pdf"

        # Persiste le PDF + journalise l'événement IA "Avant RDV" pour
        # pouvoir le redonner plus tard (badge ✓ dans le picker IA).
        try:
            pdf_bytes = pdf_buffer.getvalue()
        except AttributeError:
            pdf_buffer.seek(0)
            pdf_bytes = pdf_buffer.read()
        try:
            ia_dir = DATA_DIR / "ia_pdfs" / str(uid) / str(prospect_id)
            ia_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            saved_name = f"fiche_rdv_{ts}.pdf"
            saved_path = ia_dir / saved_name
            saved_path.write_bytes(pdf_bytes)
            _log_ia_event(
                uid, prospect_id, "before",
                summary="Fiche prépa générée",
                meta={"pdf_path": str(saved_path), "filename": filename},
            )
        except Exception:
            logger.exception("Échec persistance PDF fiche RDV (non bloquant)")

        return send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        logger.exception("Erreur génération PDF fiche RDV")
        return jsonify(ok=False, error=f"Erreur lors de la génération du PDF: {str(e)}"), 500


# ────────────────────────────────────────────────────────────────────
# IA — journal des analyses lancées sur un prospect
# ────────────────────────────────────────────────────────────────────

_IA_KIND_TITLE = {
    "scrap":  "Scraping IA",
    "before": "Fiche prépa IA",
    "after":  "Compte-rendu IA",
}


def _log_ia_event(uid: int, prospect_id: int, kind: str,
                  summary: str = "", meta: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Journalise une exécution d'IA dans prospect_events.

    type = "ia_<kind>" (ia_scrap, ia_before, ia_after).
    Retourne {ok, id, date, type, title}.
    """
    if kind not in _IA_KIND_TITLE:
        return {"ok": False, "error": "kind invalide"}
    title = _IA_KIND_TITLE[kind]
    etype = f"ia_{kind}"
    # Précision microseconde pour éviter les collisions sur la contrainte
    # UNIQUE (prospect_id, type, date) si plusieurs runs dans la seconde.
    date = datetime.datetime.now().isoformat(timespec="microseconds")
    meta_json = json.dumps(meta, ensure_ascii=False) if meta else None
    with _conn() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO prospect_events "
            "(prospect_id, date, type, title, content, meta, createdAt) "
            "VALUES (?, ?, ?, ?, ?, ?, ?);",
            (prospect_id, date, etype, title, summary or "", meta_json, date),
        )
        new_id = cur.lastrowid
    return {"ok": True, "id": new_id, "date": date, "type": etype, "title": title}


@app.post("/api/prospect/<int:prospect_id>/ia-log")
def api_prospect_ia_log(prospect_id: int):
    """Journalise une exécution d'IA pour le badge "✓ Fait" du picker."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403
    body = request.get_json(force=True, silent=True) or {}
    kind = (body.get("kind") or "").strip().lower()
    if kind not in _IA_KIND_TITLE:
        return jsonify(ok=False, error="kind doit être scrap|before|after"), 400
    summary = (body.get("summary") or "").strip()
    meta = body.get("meta") if isinstance(body.get("meta"), dict) else None
    res = _log_ia_event(uid, prospect_id, kind, summary, meta)
    if not res.get("ok"):
        return jsonify(res), 400
    return jsonify(res)


@app.get("/api/prospect/<int:prospect_id>/ia-pdf")
def api_prospect_ia_pdf(prospect_id: int):
    """Re-télécharge un PDF de fiche prépa déjà généré (via event_id)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403
    try:
        event_id = int(request.args.get("event_id", "0"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="event_id invalide"), 400
    if not event_id:
        return jsonify(ok=False, error="event_id requis"), 400
    with _conn() as conn:
        row = conn.execute(
            "SELECT meta FROM prospect_events "
            "WHERE id=? AND prospect_id=? AND type='ia_before';",
            (event_id, prospect_id),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Fiche introuvable"), 404
    try:
        meta = json.loads(row["meta"] or "null") or {}
    except Exception:
        meta = {}
    pdf_path = meta.get("pdf_path") or ""
    if not pdf_path:
        return jsonify(ok=False, error="PDF non disponible"), 404
    p = Path(pdf_path)
    # Confine l'accès au dossier ia_pdfs de l'utilisateur courant.
    base = (DATA_DIR / "ia_pdfs" / str(uid)).resolve()
    try:
        if base not in p.resolve().parents:
            return jsonify(ok=False, error="Accès refusé"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin PDF invalide"), 400
    if not p.exists():
        return jsonify(ok=False, error="Fichier PDF supprimé"), 404
    return send_file(
        str(p),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=meta.get("filename") or p.name,
    )


# ────────────────────────────────────────────────────────────────────
# EC1 Checklist – entretien de qualification candidat
# ────────────────────────────────────────────────────────────────────

EC1_CHECKLIST_ITEMS = [
    {"key": "mobilite_dispo_souhaits", "label": "Infos mobilité, disponibilité, souhaits"},
    {"key": "impression_generale", "label": "Impression générale du candidat"},
    {"key": "evaluation_technique", "label": "Évaluation technique"},
    {"key": "evaluation_personnalite", "label": "Évaluation personnalité"},
    {"key": "evaluation_communication", "label": "Évaluation communication"},
    {"key": "rappel_valeurs_up", "label": "Rappel des valeurs UpTechnologie"},
    {"key": "fourchette_salaire", "label": "Annonce fourchette salariale"},
    {"key": "reponse_questions_craintes", "label": "Réponse aux questions/craintes du candidat"},
    {"key": "process_prochaines_etapes", "label": "Détail du process et des prochaines étapes"},
]

def _blank_ec1_data() -> Dict[str, Any]:
    d = {t["key"]: {"checked": False, "note": ""} for t in EC1_CHECKLIST_ITEMS}
    d["__note"] = ""
    return d

def _ss(v: Any) -> str:
    return (str(v) if v is not None else "").strip()

@app.get("/api/ec1-checklist/themes")
def ec1_checklist_themes():
    return jsonify(ok=True, themes=EC1_CHECKLIST_ITEMS)

@app.get("/api/ec1-checklist")
def ec1_checklist_get():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    cid = request.args.get("candidate_id", type=int)
    if not cid:
        return jsonify(ok=False, error="candidate_id requis"), 400
    if not _candidate_owned(cid):
        return jsonify(ok=False, error="Accès refusé"), 403
    with _conn() as conn:
        row = conn.execute(
            "SELECT interviewAt, data, updatedAt FROM candidate_ec1_checklists WHERE candidate_id=?;",
            (cid,),
        ).fetchone()
    if row:
        try:
            data = json.loads(row["data"]) if row["data"] else _blank_ec1_data()
        except Exception:
            data = _blank_ec1_data()
        return jsonify(ok=True, interviewAt=row["interviewAt"], data=data, updatedAt=row["updatedAt"])
    return jsonify(ok=True, interviewAt=None, data=_blank_ec1_data(), updatedAt=None)

@app.post("/api/ec1-checklist")
def ec1_checklist_save():
    """Upsert EC1 checklist for a candidate. Supports partial updates:
    - if 'data' is absent, keeps existing data
    - if 'interviewAt' is absent, keeps existing interviewAt
    """
    body = request.get_json(force=True, silent=True) or {}
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    cid = body.get("candidate_id") or body.get("id")
    if not cid:
        return jsonify(ok=False, error="candidate_id requis"), 400
    try:
        cid_i = int(cid)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="candidate_id invalide"), 400
    if not _candidate_owned(cid_i):
        return jsonify(ok=False, error="Accès refusé"), 403

    has_data = "data" in body
    has_interview = ("interviewAt" in body) or ("interview_at" in body)

    interviewAt = body.get("interviewAt", None)
    if interviewAt is None and "interview_at" in body:
        interviewAt = body.get("interview_at", None)
    if interviewAt is not None:
        interviewAt = _ss(interviewAt)
        if interviewAt == "":
            interviewAt = None

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with _conn() as conn:
        row = conn.execute(
            "SELECT interviewAt, data FROM candidate_ec1_checklists WHERE candidate_id=?;",
            (cid_i,),
        ).fetchone()

        current_interview = row["interviewAt"] if row else None
        current_data = None
        if row and row["data"]:
            try:
                current_data = json.loads(row["data"])
            except Exception:
                current_data = None
        if not isinstance(current_data, dict):
            current_data = _blank_ec1_data()

        new_interview = current_interview
        if has_interview:
            new_interview = interviewAt

        new_data = current_data
        if has_data:
            incoming = body.get("data")
            if isinstance(incoming, dict):
                # Keep only expected keys + __note
                blank = _blank_ec1_data()
                merged = {}
                for k in blank.keys():
                    if k == "__note":
                        merged[k] = _ss(incoming.get(k, blank[k]))
                    else:
                        v = incoming.get(k, blank[k])
                        if not isinstance(v, dict):
                            v = blank[k]
                        merged[k] = {
                            "checked": bool(v.get("checked", False)),
                            "note": _ss(v.get("note", "")),
                        }
                new_data = merged
            else:
                new_data = _blank_ec1_data()

        conn.execute(
            """INSERT INTO candidate_ec1_checklists (candidate_id, interviewAt, data, updatedAt)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(candidate_id)
               DO UPDATE SET interviewAt=excluded.interviewAt, data=excluded.data, updatedAt=excluded.updatedAt""",
            (cid_i, new_interview, json.dumps(new_data, ensure_ascii=False), now),
        )

    return jsonify(ok=True, updatedAt=now)


# ────────────────────────────────────────────────────────────────────
# Candidate tabs (onglets fiche candidat: EC1 + note libre, v25)
# ────────────────────────────────────────────────────────────────────

@app.get("/api/candidate-tabs")
def api_candidate_tabs_list():
    """Liste des onglets d'un candidat (triés par sort_order)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    cid = request.args.get("candidate_id", type=int)
    if not cid:
        return jsonify(ok=False, error="candidate_id requis"), 400
    if not _candidate_owned(cid):
        return jsonify(ok=False, error="Accès refusé"), 403
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, candidate_id, sort_order, type, title, payload, updated_at FROM candidate_tabs WHERE candidate_id=? ORDER BY sort_order ASC, id ASC;",
            (cid,),
        ).fetchall()
    tabs = []
    for r in rows:
        payload = None
        if r["payload"]:
            try:
                payload = json.loads(r["payload"])
            except Exception:
                payload = {}
        tabs.append({
            "id": r["id"],
            "candidate_id": r["candidate_id"],
            "sort_order": r["sort_order"],
            "type": r["type"],
            "title": r["title"],
            "payload": payload,
            "updated_at": r["updated_at"],
        })
    return jsonify(ok=True, tabs=tabs)


@app.post("/api/candidate-tabs")
def api_candidate_tabs_create():
    """Crée un nouvel onglet (ec1 ou note_libre)."""
    body = request.get_json(force=True, silent=True) or {}
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    cid = body.get("candidate_id")
    if not cid:
        return jsonify(ok=False, error="candidate_id requis"), 400
    try:
        cid_i = int(cid)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="candidate_id invalide"), 400
    if not _candidate_owned(cid_i):
        return jsonify(ok=False, error="Accès refusé"), 403
    tab_type = (body.get("type") or "").strip().lower()
    if tab_type not in ("ec1", "note_libre"):
        return jsonify(ok=False, error="type doit être 'ec1' ou 'note_libre'"), 400
    title = (body.get("title") or "").strip() or ("EC1" if tab_type == "ec1" else "Note")
    now = datetime.datetime.now().isoformat(timespec="seconds")
    if tab_type == "ec1":
        payload = {"interviewAt": None, "data": _blank_ec1_data()}
    else:
        payload = {"content": ""}
    payload_str = json.dumps(payload, ensure_ascii=False)
    with _conn() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM candidate_tabs WHERE candidate_id=?;",
            (cid_i,),
        ).fetchone()["next_order"]
        cur = conn.execute(
            """INSERT INTO candidate_tabs (candidate_id, sort_order, type, title, payload, updated_at)
               VALUES (?, ?, ?, ?, ?, ?);""",
            (cid_i, max_order, tab_type, title, payload_str, now),
        )
        tab_id = cur.lastrowid
        conn.commit()
    return jsonify(ok=True, tab={"id": tab_id, "candidate_id": cid_i, "sort_order": max_order, "type": tab_type, "title": title, "payload": payload, "updated_at": now})


@app.put("/api/candidate-tabs/<int:tab_id>")
def api_candidate_tabs_update(tab_id: int):
    """Met à jour le titre et/ou le payload d'un onglet."""
    body = request.get_json(force=True, silent=True) or {}
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, candidate_id, sort_order, type, title, payload FROM candidate_tabs WHERE id=?;",
            (tab_id,),
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Onglet introuvable"), 404
        if not _candidate_owned(int(row["candidate_id"])):
            return jsonify(ok=False, error="Accès refusé"), 403
        now = datetime.datetime.now().isoformat(timespec="seconds")
        updates = []
        params = []
        if "title" in body:
            updates.append("title=?")
            params.append((body.get("title") or "").strip() or row["title"])
        if "payload" in body:
            pl = body["payload"]
            if isinstance(pl, dict):
                payload_str = json.dumps(pl, ensure_ascii=False)
            else:
                payload_str = str(pl) if pl is not None else row["payload"] or "{}"
            updates.append("payload=?")
            params.append(payload_str)
        if not updates:
            return jsonify(ok=True, updated_at=row.get("updated_at"))
        updates.append("updated_at=?")
        params.append(now)
        params.append(tab_id)
        conn.execute(
            "UPDATE candidate_tabs SET " + ", ".join(updates) + " WHERE id=?;",
            params,
        )
        conn.commit()
    return jsonify(ok=True, updated_at=now)

# ═══════════════════════════════════════════════════════
# App Settings API (v11)
# ═══════════════════════════════════════════════════════

@app.get("/api/settings")
def api_settings_get():
    """Retrieve all app settings as a key-value dict."""
    with _conn() as conn:
        rows = conn.execute("SELECT key, value FROM app_settings;").fetchall()
    settings = {r["key"]: r["value"] for r in rows}
    return jsonify(ok=True, settings=settings)


@app.post("/api/settings")
def api_settings_save():
    """Save one or more settings (key-value pairs)."""
    payload = request.get_json(force=True, silent=False) or {}
    settings = payload.get("settings", {})
    if not settings:
        return jsonify(ok=False, error="No settings provided"), 400
    with _conn() as conn:
        for key, value in settings.items():
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);",
                (str(key), str(value) if value is not None else ""),
            )
    return jsonify(ok=True)


# ═══════════════════════════════════════════════════════
# User Prefix / Teams Integration (v22.1)
# ═══════════════════════════════════════════════════════

def _compute_initials(display_name):
    """Compute default initials from display_name (e.g. 'Antoine Binet' → 'ABI')."""
    if not display_name:
        return "???"
    parts = display_name.strip().split()
    # Remove parenthetical like "Antoine (Admin)" → ["Antoine", "Binet"]
    parts = [p for p in parts if not p.startswith("(")]
    if len(parts) >= 2:
        # First letter of first name + first two letters of last name → ABI
        return (parts[0][0] + parts[-1][:2]).upper()
    elif len(parts) == 1:
        return parts[0][:3].upper()
    return "???"

def _get_user_prefix(user_id):
    """Teams prefix désactivé (section retirée). Retourne chaîne vide."""
    return ""


def _build_adaptive_card(title: str, facts: list, actions: list = None, accent_color: str = "accent") -> dict:
    """Build an Adaptive Card v1.4 payload for Teams webhook.
    facts = [(label, value), ...], actions = [{title, url}, ...]"""
    body = [
        {"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "color": accent_color},
        {"type": "FactSet", "facts": [{"title": f[0], "value": str(f[1]) if f[1] else "—"} for f in facts]}
    ]
    card = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": body,
    }
    if actions:
        card["actions"] = [{"type": "Action.OpenUrl", "title": a["title"], "url": a["url"]} for a in actions]
    return card


def _send_teams_webhook(card: dict, event_type: str = "notification"):
    """Teams webhook désactivé (section retirée des paramètres). No-op."""
    pass


# ═══════════════════════════════════════════════════════
# Manual KPI API (v16.5)
# ═══════════════════════════════════════════════════════

@app.post("/api/manual-kpi")
def api_manual_kpi_add():
    """Add a manual KPI entry (for actions done outside the app)."""
    payload = request.get_json(force=True, silent=False) or {}
    kpi_type = payload.get("type", "note")
    kpi_date = payload.get("date", datetime.datetime.now().strftime("%Y-%m-%d"))
    kpi_count = int(payload.get("count", 1))
    kpi_desc = payload.get("description", "")
    now = datetime.datetime.now().isoformat(timespec="seconds")

    user_id = None
    sess_user = session.get("user_id")
    if sess_user:
        user_id = sess_user

    with _conn() as conn:
        conn.execute(
            "INSERT INTO manual_kpi (user_id, type, date, count, description, createdAt) VALUES (?, ?, ?, ?, ?, ?);",
            (user_id, kpi_type, kpi_date, kpi_count, kpi_desc, now)
        )
    return jsonify(ok=True, message="KPI enregistré")


@app.get("/api/manual-kpi")
def api_manual_kpi_list():
    """List manual KPI entries (user's only), optionally filtered by date range."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    date_from = request.args.get("from", "")
    date_to = request.args.get("to", "")
    with _conn() as conn:
        query = "SELECT * FROM manual_kpi WHERE user_id=?"
        params = [uid]
        if date_from:
            query += " AND date >= ?"
            params.append(date_from)
        if date_to:
            query += " AND date <= ?"
            params.append(date_to)
        query += " ORDER BY date DESC, createdAt DESC LIMIT 200;"
        rows = conn.execute(query, params).fetchall()
    return jsonify(ok=True, entries=[dict(r) for r in rows])


# ═══════════════════════════════════════════════════════
# LinkedIn InMails (sourcing stats — dashboard objectifs)
# ═══════════════════════════════════════════════════════

@app.get("/api/linkedin-inmails")
def api_linkedin_inmails_list():
    """Liste les InMails LinkedIn de l'utilisateur, triés par date décroissante."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM linkedin_inmails WHERE owner_id=? ORDER BY sent_at DESC, created_at DESC LIMIT 500;",
            (uid,)
        ).fetchall()
    return jsonify(ok=True, entries=[dict(r) for r in rows])


@app.post("/api/linkedin-inmails")
def api_linkedin_inmails_add():
    """Enregistre un InMail LinkedIn envoyé (incrémente le compteur sourcing du jour)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    url = (payload.get("url") or "").strip()
    if not url:
        return jsonify(ok=False, error="URL manquante"), 400
    note = (payload.get("note") or "").strip()
    sent_at = (payload.get("sent_at") or datetime.datetime.now().strftime("%Y-%m-%d")).strip()
    now_ts = time.time()
    name = _parse_linkedin_name(url)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO linkedin_inmails (url, note, name, sent_at, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?);",
            (url, note or None, name or None, sent_at, uid, now_ts)
        )
    return jsonify(ok=True, message="InMail enregistré")


@app.patch("/api/linkedin-inmails/<int:entry_id>")
def api_linkedin_inmails_update(entry_id: int):
    """Met à jour le nom affiché d'un InMail LinkedIn."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip() or None
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM linkedin_inmails WHERE id=? AND owner_id=?;", (entry_id, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Introuvable"), 404
        conn.execute("UPDATE linkedin_inmails SET name=? WHERE id=?;", (name, entry_id))
    return jsonify(ok=True)


@app.delete("/api/linkedin-inmails/<int:entry_id>")
def api_linkedin_inmails_delete(entry_id: int):
    """Supprime un InMail LinkedIn (seul le propriétaire peut le faire)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM linkedin_inmails WHERE id=? AND owner_id=?;", (entry_id, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Introuvable"), 404
        conn.execute("DELETE FROM linkedin_inmails WHERE id=?;", (entry_id,))
    return jsonify(ok=True)


# ═══════════════════════════════════════════════════════
# Candidate Folder API (v11)
# ═══════════════════════════════════════════════════════

def _get_setting(conn, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM app_settings WHERE key=?;", (key,)).fetchone()
    return row["value"] if row else default


def _build_candidate_folder_path(candidate_name: str, conn) -> Path | None:
    """Build the full path to a candidate's Windows folder."""
    base_path = _get_setting(conn, "candidate_folder_base", "")
    if not base_path:
        return None
    folder_format = _get_setting(conn, "candidate_folder_format", "{NOM} {Prenom}")

    # Parse name
    parts = candidate_name.strip().split()
    if len(parts) >= 2:
        prenom = parts[0]
        nom = " ".join(parts[1:])
    elif len(parts) == 1:
        prenom = parts[0]
        nom = parts[0]
    else:
        return None

    folder_name = folder_format.replace("{NOM}", nom.upper()).replace("{Prenom}", prenom.capitalize()).replace("{nom}", nom.lower()).replace("{prenom}", prenom.lower()).replace("{PRENOM}", prenom.upper()).replace("{Nom}", nom.capitalize())

    return Path(base_path) / folder_name


@app.get("/api/candidate-folder/<int:candidate_id>/files")
@login_required
@role_required('admin')
def api_candidate_folder_files(candidate_id: int):
    """List files in the candidate's Windows folder."""
    with _conn() as conn:
        row = conn.execute("SELECT name FROM candidates WHERE id=?;", (candidate_id,)).fetchone()
        if not row:
            return jsonify(ok=False, error="Candidate not found"), 404

        folder = _build_candidate_folder_path(row["name"], conn)

    if not folder:
        return jsonify(ok=False, error="Chemin de base non configuré. Allez dans Paramètres > Dossier candidats.", no_config=True)

    if not folder.exists():
        return jsonify(ok=True, folder=str(folder), files=[], exists=False)

    files = []
    try:
        for f in sorted(folder.iterdir()):
            if f.name.startswith(".") or f.name.startswith("~"):
                continue
            stat = f.stat()
            files.append({
                "name": f.name,
                "path": str(f),
                "is_dir": f.is_dir(),
                "size": stat.st_size,
                "ext": f.suffix.lower(),
                "modified": datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            })
    except PermissionError:
        return jsonify(ok=False, error="Accès refusé au dossier")

    return jsonify(ok=True, folder=str(folder), files=files, exists=True)


@app.get("/api/candidates/source-from-folder")
@login_required
def api_candidates_source_from_folder():
    """List subfolders of the candidate base path that do not yet have a candidate. For sourcing new names."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        base_path = _get_setting(conn, "candidate_folder_base", "").strip()
        if not base_path:
            return jsonify(ok=False, error="Configurez le chemin de base (Dossier candidats) sur la page Candidats.", no_config=True)
        existing = conn.execute("SELECT name FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at = '');", (uid,)).fetchall()
    existing_names = {(r["name"] or "").strip().lower() for r in existing}
    base = Path(base_path)
    if not base.exists() or not base.is_dir():
        return jsonify(ok=True, new=[], error="Dossier introuvable.")
    new_folders = []
    try:
        for name in sorted(base.iterdir()):
            if not name.is_dir() or name.name.startswith(".") or name.name.startswith("~"):
                continue
            fn = name.name.strip()
            if not fn:
                continue
            if fn.lower() in existing_names:
                continue
            files = []
            for f in sorted(name.iterdir()):
                if f.name.startswith(".") or f.name.startswith("~"):
                    continue
                try:
                    if f.is_file():
                        files.append({"name": f.name, "path": str(f)})
                except OSError:
                    pass
            new_folders.append({"folderName": fn, "path": str(name), "files": files[:50]})
    except OSError as e:
        return jsonify(ok=False, error=str(e)), 500
    return jsonify(ok=True, new=new_folders)


@app.post("/api/candidate-folder/<int:candidate_id>/open")
@login_required
@role_required('admin')
def api_candidate_folder_open(candidate_id: int):
    """Open the candidate's folder in Windows Explorer."""
    import subprocess
    chk = _require_same_origin()
    if chk:
        return chk
    with _conn() as conn:
        row = conn.execute("SELECT name FROM candidates WHERE id=?;", (candidate_id,)).fetchone()
        if not row:
            return jsonify(ok=False, error="Candidate not found"), 404
        folder = _build_candidate_folder_path(row["name"], conn)

    if not folder or not folder.exists():
        return jsonify(ok=False, error="Dossier introuvable")

    try:
        subprocess.Popen(["explorer", str(folder)])
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, error=str(e))


@app.post("/api/candidate-folder/open-file")
@login_required
@role_required('admin')
def api_candidate_folder_open_file():
    """Open a specific file from a candidate's folder."""
    import subprocess
    chk = _require_same_origin()
    if chk:
        return chk
    payload = request.get_json(force=True, silent=False) or {}
    filepath = payload.get("path", "")
    candidate_id = payload.get("candidate_id")
    if not filepath:
        return jsonify(ok=False, error="path required"), 400

    p = Path(filepath)
    if not p.exists():
        return jsonify(ok=False, error="Fichier introuvable")

    # Safety: the path must be inside the configured candidate folder base (and ideally inside the candidate folder)
    try:
        with _conn() as conn:
            base_path = _get_setting(conn, "candidate_folder_base", "") or ""
            allowed_root = Path(base_path).resolve() if base_path else None

            cand_root = None
            if candidate_id:
                row = conn.execute("SELECT name FROM candidates WHERE id=?;", (int(candidate_id),)).fetchone()
                if row:
                    cand_root = _build_candidate_folder_path(row["name"], conn)
                    cand_root = cand_root.resolve() if cand_root else None

        rp = p.resolve()
        if cand_root and cand_root != rp and cand_root not in rp.parents:
            return jsonify(ok=False, error="Chemin non autorisé"), 403
        if allowed_root and allowed_root != rp and allowed_root not in rp.parents:
            return jsonify(ok=False, error="Chemin non autorisé"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin non autorisé"), 403

    try:
        import os as _os
        _os.startfile(str(p))
        return jsonify(ok=True)
    except Exception as e:
        try:
            subprocess.Popen(["explorer", str(p)])
            return jsonify(ok=True)
        except Exception as e2:
            return jsonify(ok=False, error=str(e2))


# ═══════════════════════════════════════════════════════════════════
# Collaboration API (v25.5)
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/collab/collaborators")
@login_required
def api_collab_collaborators():
    """Liste des utilisateurs disponibles comme collaborateurs (exclut l'utilisateur connecté)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _auth_conn() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, role, is_active FROM users WHERE id != ? AND is_active = 1 ORDER BY display_name, username;",
            (uid,)
        ).fetchall()
    return jsonify(ok=True, collaborators=[dict(r) for r in rows])


@app.get("/api/collab/shared-companies")
@login_required
def api_collab_shared_companies():
    """Liste des entreprises partagées (reçues et envoyées)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _auth_conn() as aconn:
        sent_rows = aconn.execute(
            """
            SELECT sc.id, sc.company_id, sc.to_user_id, sc.shared_at,
                   u.username, u.display_name
            FROM shared_companies sc
            JOIN users u ON u.id = sc.to_user_id
            WHERE sc.from_user_id = ?
            ORDER BY sc.shared_at DESC;
            """,
            (uid,)
        ).fetchall()

        received_rows = aconn.execute(
            """
            SELECT sc.id, sc.company_id, sc.from_user_id, sc.shared_at,
                   u.username, u.display_name
            FROM shared_companies sc
            JOIN users u ON u.id = sc.from_user_id
            WHERE sc.to_user_id = ?
            ORDER BY sc.shared_at DESC;
            """,
            (uid,)
        ).fetchall()

    def _company_info(company_id: int, owner_id: int) -> dict:
        """Récupère groupe/site d'une entreprise depuis la DB de son propriétaire."""
        try:
            with _conn_for_user(owner_id) as conn:
                c = conn.execute(
                    "SELECT groupe, site FROM companies WHERE id = ? AND owner_id = ? AND deleted_at IS NULL;",
                    (company_id, owner_id)
                ).fetchone()
                if c:
                    return {"groupe": c["groupe"], "site": c["site"]}
        except Exception:
            pass
        return {"groupe": None, "site": None}

    sent = []
    for r in sent_rows:
        d = dict(r)
        d.update(_company_info(r["company_id"], uid))
        sent.append(d)

    received = []
    for r in received_rows:
        d = dict(r)
        d.update(_company_info(r["company_id"], r["from_user_id"]))
        received.append(d)

    return jsonify(ok=True, sent=sent, received=received)


@app.post("/api/collab/share-company")
@login_required
def api_collab_share_company():
    """Partager une entreprise avec un collaborateur."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    payload = request.get_json(force=True, silent=False) or {}
    company_id = payload.get("company_id")
    to_user_id = payload.get("to_user_id")
    
    if not company_id or not to_user_id:
        return jsonify(ok=False, error="company_id et to_user_id requis"), 400
    
    try:
        company_id = int(company_id)
        to_user_id = int(to_user_id)
    except (ValueError, TypeError):
        return jsonify(ok=False, error="IDs invalides"), 400
    
    if to_user_id == uid:
        return jsonify(ok=False, error="Impossible de partager avec soi-même"), 400
    
    # Vérifier que l'entreprise appartient à l'utilisateur
    with _conn() as conn:
        company = conn.execute(
            "SELECT * FROM companies WHERE id = ? AND owner_id = ? AND deleted_at IS NULL;",
            (company_id, uid)
        ).fetchone()
        if not company:
            return jsonify(ok=False, error="Entreprise non trouvée"), 404
    
    # Vérifier que le collaborateur existe
    with _auth_conn() as aconn:
        collaborator = aconn.execute(
            "SELECT id, username, display_name FROM users WHERE id = ? AND is_active = 1;",
            (to_user_id,)
        ).fetchone()
        if not collaborator:
            return jsonify(ok=False, error="Collaborateur non trouvé"), 404
        
        # Vérifier si déjà partagé
        existing = aconn.execute(
            "SELECT id FROM shared_companies WHERE company_id = ? AND from_user_id = ? AND to_user_id = ?;",
            (company_id, uid, to_user_id)
        ).fetchone()
        if existing:
            return jsonify(ok=False, error="Cette entreprise est déjà partagée avec ce collaborateur"), 409
        
        # Créer le partage
        now = _now_iso()
        aconn.execute(
            "INSERT INTO shared_companies (company_id, from_user_id, to_user_id, shared_at) VALUES (?, ?, ?, ?);",
            (company_id, uid, to_user_id, now)
        )
    
    # Copier l'entreprise et ses prospects dans la DB du collaborateur
    _sync_shared_company_to_collaborator(company_id, uid, to_user_id)
    
    return jsonify(ok=True, message="Entreprise partagée avec succès")


def _sync_shared_company_to_collaborator(company_id: int, from_user_id: int, to_user_id: int) -> None:
    """Copie une entreprise partagée et ses prospects dans la DB du collaborateur."""
    # Lire l'entreprise et ses prospects depuis la DB de l'utilisateur source
    with _conn_for_user(from_user_id) as from_conn:
        company = from_conn.execute(
            "SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL;",
            (company_id,)
        ).fetchone()
        if not company:
            return
        
        prospects = from_conn.execute(
            "SELECT * FROM prospects WHERE company_id = ? AND deleted_at IS NULL;",
            (company_id,)
        ).fetchall()
    
    # Écrire dans la DB du collaborateur
    with _conn_for_user(to_user_id) as to_conn:
        to_conn.execute("PRAGMA foreign_keys = OFF;")
        try:
            # Vérifier si l'entreprise existe déjà (par groupe+site)
            existing = to_conn.execute(
                "SELECT id FROM companies WHERE groupe = ? AND site = ? AND owner_id = ?;",
                (company["groupe"], company["site"], to_user_id)
            ).fetchone()
            
            if existing:
                target_company_id = existing["id"]
            else:
                # Insérer l'entreprise
                to_conn.execute(
                    """
                    INSERT OR REPLACE INTO companies 
                    (id, groupe, site, phone, notes, tags, website, linkedin, industry, size, 
                     address, city, country, stack, pain_points, budget, urgency, owner_id, deleted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);
                    """,
                    (
                        company["id"], company["groupe"], company["site"], company.get("phone"),
                        company.get("notes"), company.get("tags"), company.get("website"),
                        company.get("linkedin"), company.get("industry"), company.get("size"),
                        company.get("address"), company.get("city"), company.get("country"),
                        company.get("stack"), company.get("pain_points"), company.get("budget"),
                        company.get("urgency"), to_user_id
                    )
                )
                target_company_id = company["id"]
            
            # Insérer/mettre à jour les prospects
            for p_row in prospects:
                p = dict(p_row)
                to_conn.execute(
                    """
                    INSERT OR REPLACE INTO prospects
                    (id, name, company_id, fonction, telephone, email, linkedin, pertinence, statut,
                     lastContact, nextFollowUp, priority, notes, callNotes, pushEmailSentAt, tags,
                     template_id, nextAction, pushLinkedInSentAt, photo_url, push_category_id,
                     fixedMetier, rdvDate, is_archived, owner_id, deleted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);
                    """,
                    (
                        p["id"], p["name"], target_company_id, p.get("fonction"), p.get("telephone"),
                        p.get("email"), p.get("linkedin"), p.get("pertinence"), p.get("statut"),
                        p.get("lastContact"), p.get("nextFollowUp"), p.get("priority"),
                        p.get("notes"), p.get("callNotes"), p.get("pushEmailSentAt"), p.get("tags"),
                        p.get("template_id"), p.get("nextAction"), p.get("pushLinkedInSentAt"),
                        p.get("photo_url"), p.get("push_category_id"), p.get("fixedMetier"),
                        p.get("rdvDate"), p.get("is_archived"), to_user_id
                    )
                )
        finally:
            to_conn.execute("PRAGMA foreign_keys = ON;")


@app.get("/api/collab/shared-company/<int:company_id>/prospects")
@login_required
def api_collab_shared_company_prospects(company_id: int):
    """Liste des prospects d'une entreprise partagée (lus depuis la DB du partageur)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    # Vérifier que l'entreprise est bien partagée avec l'utilisateur
    with _auth_conn() as aconn:
        share = aconn.execute(
            """SELECT sc.from_user_id, u.display_name, u.username
               FROM shared_companies sc
               JOIN users u ON u.id = sc.from_user_id
               WHERE sc.company_id = ? AND sc.to_user_id = ?;""",
            (company_id, uid)
        ).fetchone()
        if not share:
            return jsonify(ok=False, error="Entreprise non partagée"), 404

    from_user_id = share["from_user_id"]
    sharer_name = share["display_name"] or share["username"] or "?"

    # Lire les prospects directement depuis la DB du partageur
    with _conn_for_user(from_user_id) as conn:
        prospects = conn.execute(
            "SELECT * FROM prospects WHERE company_id = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY id;",
            (company_id, from_user_id)
        ).fetchall()

    def _parse_tags(v):
        if not v:
            return []
        try:
            return json.loads(v) if isinstance(v, str) else v
        except Exception:
            return [t.strip() for t in str(v).split(",") if t.strip()]

    result = []
    for p in prospects:
        d = dict(p)
        try:
            d["callNotes"] = json.loads(d.get("callNotes") or "[]")
        except Exception:
            d["callNotes"] = []
        d["tags"] = _parse_tags(d.get("tags"))
        d["is_archived"] = int(d.get("is_archived") or 0)
        result.append(d)

    return jsonify(ok=True, prospects=result, sharer_name=sharer_name, from_user_id=from_user_id)


@app.route("/api/collab/shared-company/<int:company_id>/prospect/<int:prospect_id>", methods=["PUT", "PATCH"])
@login_required
def api_collab_shared_company_prospect_update(company_id: int, prospect_id: int):
    """Met à jour un prospect d'une entreprise partagée (dans la DB du partageur)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    # Vérifier le partage
    with _auth_conn() as aconn:
        share = aconn.execute(
            "SELECT from_user_id FROM shared_companies WHERE company_id = ? AND to_user_id = ?;",
            (company_id, uid)
        ).fetchone()
        if not share:
            return jsonify(ok=False, error="Accès refusé"), 403

    from_user_id = share["from_user_id"]
    payload = request.get_json(force=True, silent=True) or {}

    # Champs autorisés (pas de suppression, pas de changement d'owner/identity)
    allowed = ['statut', 'notes', 'lastContact', 'nextFollowUp', 'pertinence',
               'callNotes', 'tags', 'nextAction', 'rdvDate', 'priority', 'is_archived']
    updates = {k: v for k, v in payload.items() if k in allowed}

    if not updates:
        return jsonify(ok=False, error="Aucun champ à mettre à jour"), 400

    # Sérialiser callNotes et tags si nécessaire
    if 'callNotes' in updates and isinstance(updates['callNotes'], (list, dict)):
        updates['callNotes'] = json.dumps(updates['callNotes'], ensure_ascii=False)
    if 'tags' in updates and isinstance(updates['tags'], list):
        updates['tags'] = json.dumps(updates['tags'], ensure_ascii=False)

    with _conn_for_user(from_user_id) as conn:
        prospect = conn.execute(
            "SELECT id FROM prospects WHERE id = ? AND company_id = ? AND owner_id = ? AND deleted_at IS NULL;",
            (prospect_id, company_id, from_user_id)
        ).fetchone()
        if not prospect:
            return jsonify(ok=False, error="Prospect non trouvé"), 404

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [prospect_id]
        conn.execute(f"UPDATE prospects SET {set_clause} WHERE id = ?;", values)

    return jsonify(ok=True)


@app.get("/api/collab/shared-prospects")
@login_required
def api_collab_shared_prospects():
    """Retourne tous les prospects des entreprises partagées avec l'utilisateur courant."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _auth_conn() as aconn:
        shares = aconn.execute(
            """SELECT sc.company_id, sc.from_user_id, u.display_name, u.username
               FROM shared_companies sc
               JOIN users u ON u.id = sc.from_user_id
               WHERE sc.to_user_id = ?
               ORDER BY sc.shared_at DESC;""",
            (uid,)
        ).fetchall()

    def _parse_tags(v):
        if not v:
            return []
        try:
            return json.loads(v) if isinstance(v, str) else v
        except Exception:
            return [t.strip() for t in str(v).split(",") if t.strip()]

    all_prospects = []
    for share in shares:
        from_user_id = share["from_user_id"]
        company_id = share["company_id"]
        sharer_name = share["display_name"] or share["username"] or "?"
        try:
            with _conn_for_user(from_user_id) as conn:
                company = conn.execute(
                    "SELECT id, groupe, site FROM companies WHERE id = ? AND owner_id = ? AND deleted_at IS NULL;",
                    (company_id, from_user_id)
                ).fetchone()
                prospects = conn.execute(
                    "SELECT * FROM prospects WHERE company_id = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY id;",
                    (company_id, from_user_id)
                ).fetchall()
            company_name = (company["groupe"] or company["site"] or f"Entreprise #{company_id}") if company else f"Entreprise #{company_id}"
            for p in prospects:
                d = dict(p)
                try:
                    d["callNotes"] = json.loads(d.get("callNotes") or "[]")
                except Exception:
                    d["callNotes"] = []
                d["tags"] = _parse_tags(d.get("tags"))
                d["is_archived"] = int(d.get("is_archived") or 0)
                d["shared_from"] = sharer_name
                d["shared_from_user_id"] = from_user_id
                d["shared_company_id"] = company_id
                d["shared_company_name"] = company_name
                all_prospects.append(d)
        except Exception:
            continue

    return jsonify(ok=True, prospects=all_prospects)


@app.post("/api/collab/unshare-company")
@login_required
def api_collab_unshare_company():
    """Retirer le partage d'une entreprise."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    payload = request.get_json(force=True, silent=False) or {}
    share_id = payload.get("share_id")
    
    if not share_id:
        return jsonify(ok=False, error="share_id requis"), 400
    
    with _auth_conn() as aconn:
        share = aconn.execute(
            "SELECT * FROM shared_companies WHERE id = ? AND from_user_id = ?;",
            (share_id, uid)
        ).fetchone()
        if not share:
            return jsonify(ok=False, error="Partage non trouvé"), 404
        
        aconn.execute("DELETE FROM shared_companies WHERE id = ?;", (share_id,))
    
    return jsonify(ok=True, message="Partage retiré")


# ═══════════════════════════════════════════════════════════════════
# Dashboard adaptatif et Assistant virtuel (v26.6)
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/dashboard/adaptive")
def api_dashboard_adaptive():
    """Retourne les recommandations adaptatives basées sur l'activité récente (widgets, priorités)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    today = _today_iso()
    d_today = datetime.date.fromisoformat(today)
    monday = (d_today - datetime.timedelta(days=d_today.weekday())).isoformat()
    
    with _conn() as conn:
        # BUG 27 : exclure les archivés pour cohérence total prospects
        prospects = conn.execute(
            "SELECT * FROM prospects WHERE owner_id=? AND deleted_at IS NULL "
            "AND (is_archived IS NULL OR is_archived=0);",
            (uid,),
        ).fetchall()
        push_logs = conn.execute(
            "SELECT l.* FROM push_logs l JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=? WHERE l.sentAt >= ?;",
            (uid, monday),
        ).fetchall()
        notes = []
        for p in prospects:
            try:
                call_notes = json.loads(p.get("callNotes") or "[]")
                if isinstance(call_notes, list):
                    for n in call_notes:
                        if (n.get("date") or "")[:10] >= monday:
                            notes.append(n)
            except Exception:
                pass
    
    prospects_list = [dict(r) for r in prospects]
    push_list = [dict(r) for r in push_logs]
    
    # Calculer les métriques d'activité
    overdue = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < today]
    due_today = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() == today]
    rdv_this_week = [p for p in prospects_list if (p.get("rdvDate") or "").strip() >= monday and (p.get("rdvDate") or "").strip() <= today]
    recent_activity = len([n for n in notes if (n.get("date") or "")[:10] >= monday]) + len([p for p in push_list if (p.get("sentAt") or "")[:10] >= monday])
    
    # Préparer le contexte pour l'IA
    context = {
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
        "rdv_this_week_count": len(rdv_this_week),
        "recent_activity_count": recent_activity,
        "total_prospects": len(prospects_list),
        "pipeline_status": {s: sum(1 for p in prospects_list if p.get("statut") == s) for s in ["Rendez-vous", "À rappeler", "Messagerie", "Appelé"]},
    }
    
    # Construire le prompt pour l'analyse adaptative
    prompt = f"""Tu es un assistant pour un CRM de prospection B2B. Analyse l'activité récente et génère des recommandations.

Contexte actuel:
- {context['overdue_count']} relances en retard
- {context['due_today_count']} relances à faire aujourd'hui
- {context['rdv_this_week_count']} RDV cette semaine
- {context['recent_activity_count']} actions récentes (notes + push)
- Pipeline: {context['pipeline_status']}

Génère un JSON avec:
1. "priorities": liste de 3 priorités du jour (max 60 caractères chacune)
2. "widgets_to_show": liste des widgets recommandés parmi ["overdue", "rdv", "pipeline", "activity", "goals"]
3. "widgets_to_hide": liste des widgets à masquer
4. "insight": un message d'analyse court (max 100 caractères)

Réponds UNIQUEMENT avec le JSON, sans texte avant/après."""
    
    try:
        ai_response = _call_ai(prompt, timeout=60)
        # Nettoyer la réponse (enlever markdown si présent)
        ai_response = ai_response.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:]
        if ai_response.startswith("```"):
            ai_response = ai_response[3:]
        if ai_response.endswith("```"):
            ai_response = ai_response[:-3]
        ai_response = ai_response.strip()
        
        adaptive_data = json.loads(ai_response)
    except Exception as e:
        logger.warning("Erreur analyse adaptative IA, fallback par défaut: %s", e)
        # Fallback par défaut
        adaptive_data = {
            "priorities": [
                f"Relancer {len(overdue)} prospects en retard" if overdue else "Aucune relance en retard",
                f"{len(due_today)} relances à faire aujourd'hui" if due_today else "Aucune relance prévue",
                f"{len(rdv_this_week)} RDV cette semaine" if rdv_this_week else "Aucun RDV cette semaine",
            ],
            "widgets_to_show": ["overdue", "rdv", "pipeline"] if overdue or rdv_this_week else ["activity", "goals"],
            "widgets_to_hide": [],
            "insight": "Analyse en cours..." if recent_activity < 5 else "Activité soutenue cette semaine",
        }
    
    return jsonify(ok=True, data=adaptive_data)


@app.post("/api/dashboard/assistant")
def api_dashboard_assistant():
    """Assistant virtuel : répond à des questions en langage naturel et peut exécuter des actions (disponible sur toutes les pages)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    body = request.get_json(force=True) or {}
    question = body.get("question", "").strip()
    if not question:
        return jsonify(ok=False, error="question requise"), 400
    
    # Session ID pour grouper les messages (optionnel, généré si absent)
    session_id = body.get("session_id") or f"session_{uid}_{int(time.time())}"
    
    # Contexte de la page (optionnel)
    page_context = body.get("page_context", "")
    page_description = body.get("page_description", "")
    
    # Récupérer l'historique de conversation (derniers 10 messages)
    with _conn() as conn:
        history_rows = conn.execute(
            "SELECT role, content FROM assistant_history WHERE user_id=? AND session_id=? ORDER BY createdAt DESC LIMIT 10;",
            (uid, session_id)
        ).fetchall()
        conversation_history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]
    
    # Sauvegarder la question de l'utilisateur
    with _conn() as conn:
        conn.execute(
            "INSERT INTO assistant_history (user_id, session_id, role, content, createdAt) VALUES (?, ?, 'user', ?, datetime('now'));",
            (uid, session_id, question)
        )
    
    today = _today_iso()
    d_today = datetime.date.fromisoformat(today)
    monday = (d_today - datetime.timedelta(days=d_today.weekday())).isoformat()
    
    # Récupérer le contexte disponible selon la page
    with _conn() as conn:
        prospects = conn.execute("SELECT id, name, statut, nextFollowUp, rdvDate, company_id, tags, pertinence FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchall()
        companies = conn.execute("SELECT id, groupe, site, tags FROM companies WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchall()
        candidates = conn.execute("SELECT id, name, status, skills, role FROM candidates WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchall()
        tasks = conn.execute("SELECT id, title, status, due_date FROM tasks WHERE owner_id=? AND status='pending' ORDER BY due_date ASC LIMIT 10;", (uid,)).fetchall()
    
    prospects_list = [dict(r) for r in prospects]
    companies_list = [dict(r) for r in companies]
    candidates_list = [dict(r) for r in candidates]
    tasks_list = [dict(r) for r in tasks]
    
    # Construire le contexte pour l'IA selon la page
    overdue_prospects = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < today]
    due_today_prospects = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() == today]
    rdv_prospects = [p for p in prospects_list if p.get("statut") == "Rendez-vous"]
    
    # Contexte de base
    context_summary = f"""Contexte disponible:
- {len(prospects_list)} prospects au total
- {len(overdue_prospects)} relances en retard
- {len(due_today_prospects)} relances à faire aujourd'hui
- {len(rdv_prospects)} prospects en RDV
- {len(companies_list)} entreprises
- {len(candidates_list)} candidats
- {len(tasks_list)} tâches en cours

Statuts prospects: {', '.join(set(p.get('statut') or 'Inconnu' for p in prospects_list))}
"""
    
    # Enrichir selon le contexte de la page
    if page_context:
        context_summary += f"\nContexte de la page: {page_description}\n"
        
        if "prospects" in page_context.lower() or "Gestion des prospects" in page_context:
            context_summary += f"\nExemples de prospects (max 5):\n"
            for p in prospects_list[:5]:
                tags_str = ', '.join(json.loads(p.get('tags') or '[]')[:3]) if p.get('tags') else 'Aucun'
                context_summary += f"- {p['name']} (ID: {p['id']}, statut: {p.get('statut', 'N/A')}, pertinence: {p.get('pertinence', 'N/A')}, tags: {tags_str})\n"
        
        elif "candidat" in page_context.lower() or "Sourcing" in page_context:
            context_summary += f"\nExemples de candidats (max 5):\n"
            for c in candidates_list[:5]:
                skills_str = ', '.join(json.loads(c.get('skills') or '[]')[:3]) if c.get('skills') else 'Aucune'
                context_summary += f"- {c['name']} (ID: {c['id']}, rôle: {c.get('role', 'N/A')}, compétences: {skills_str})\n"
        
        elif "entreprise" in page_context.lower():
            context_summary += f"\nExemples d'entreprises (max 5):\n"
            for c in companies_list[:5]:
                context_summary += f"- {c.get('groupe', 'N/A')} (ID: {c['id']}, site: {c.get('site', 'N/A')})\n"
        
        elif "Focus" in page_context or "focus" in page_context.lower():
            context_summary += f"\nRelances en retard (max 5):\n"
            for p in overdue_prospects[:5]:
                context_summary += f"- {p['name']} (ID: {p['id']}, relance: {p.get('nextFollowUp', 'N/A')})\n"
            context_summary += f"\nTâches en cours (max 5):\n"
            for t in tasks_list[:5]:
                context_summary += f"- {t.get('title', 'N/A')} (échéance: {t.get('due_date', 'N/A')})\n"
    
    context_summary += f"\nExemples de prospects en retard (max 3):\n"
    for p in overdue_prospects[:3]:
        context_summary += f"- {p['name']} (ID: {p['id']}, statut: {p.get('statut', 'N/A')}, relance: {p.get('nextFollowUp', 'N/A')})\n"
    
    # Construire l'historique de conversation pour le prompt
    history_text = ""
    if conversation_history:
        history_text = "\n\nHistorique de la conversation (référence-toi si nécessaire):\n"
        for msg in conversation_history[-5:]:  # Derniers 5 messages
            role_label = "Utilisateur" if msg["role"] == "user" else "Assistant"
            history_text += f"{role_label}: {msg['content']}\n"
    
    prompt = f"""Tu es un assistant virtuel intelligent pour un CRM de prospection B2B. L'utilisateur pose une question en langage naturel.

{context_summary}{history_text}

Question actuelle de l'utilisateur: "{question}"

Analyse la question et génère une réponse JSON avec:
1. "answer": réponse textuelle claire, concise et utile (max 300 caractères). Sois proactif et propose des actions concrètes.
2. "intent": intention détectée parmi ["filter", "create", "modify", "display", "action", "info", "ia_function"]
3. "actions": liste d'actions possibles (chaque action = {{"type": "...", "label": "...", "params": {{...}}}})
   
Types d'actions disponibles:
- "filter": filtrer des prospects (params: {{"field": "statut|nextFollowUp|sector|...", "value": "..."}})
- "open": ouvrir une fiche (params: {{"id": prospect_id|candidate_id|company_id, "type": "prospect|candidate|company"}})
- "navigate": naviguer vers une page (params: {{"url": "/focus|/sourcing|/stats|/dashboard|..."}})
- "create_prospect": créer un prospect (params: {{"name": "...", "company": "...", "fonction": "...", ...}})
- "create_company": créer une entreprise (params: {{"groupe": "...", "site": "...", ...}})
- "create_candidate": créer un candidat (params: {{"name": "...", "role": "...", "skills": [...], ...}})
- "modify_prospect": modifier un prospect (params: {{"id": ..., "field": "...", "value": "..."}})
- "ia_scrap": enrichir avec l'IA (params: {{"type": "prospect|candidate|company", "id": ...}})
- "ia_avant_reunion": générer fiche préparation RDV (params: {{"prospect_id": ...}})
- "ia_apres_reunion": générer compte-rendu après réunion (params: {{"prospect_id": ...}})

Exemples d'actions intelligentes:
- Pour "prospects à relancer": {{"type": "navigate", "label": "Voir les relances en retard", "params": {{"url": "/focus"}}}}
- Pour "créer un prospect Jean Dupont": {{"type": "create_prospect", "label": "Créer le prospect", "params": {{"name": "Jean Dupont", "company": "..."}}}}
- Pour "enrichis ce prospect avec l'IA": {{"type": "ia_scrap", "label": "Enrichir avec l'IA", "params": {{"type": "prospect", "id": ...}}}}
- Pour "génère la fiche avant réunion": {{"type": "ia_avant_reunion", "label": "Générer fiche préparation", "params": {{"prospect_id": ...}}}}

Réponds UNIQUEMENT avec le JSON, sans texte avant/après."""
    
    try:
        ai_response = _call_ai(prompt, timeout=90)
        # Nettoyer la réponse
        ai_response = ai_response.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:]
        if ai_response.startswith("```"):
            ai_response = ai_response[3:]
        if ai_response.endswith("```"):
            ai_response = ai_response[:-3]
        ai_response = ai_response.strip()
        
        assistant_data = json.loads(ai_response)
        
        # Enrichir les actions avec les IDs réels si possible
        if assistant_data.get("intent") == "filter" and "prospects" in question.lower():
            # Détecter les filtres courants
            if "relancer" in question.lower() or "retard" in question.lower():
                assistant_data["actions"] = [{
                    "type": "navigate",
                    "label": "Voir les relances en retard",
                    "params": {"url": "/focus"}
                }]
            elif "rdv" in question.lower() or "rendez-vous" in question.lower():
                assistant_data["actions"] = [{
                    "type": "filter",
                    "label": "Voir les prospects en RDV",
                    "params": {"field": "statut", "value": "Rendez-vous"}
                }]
        
        # Sauvegarder la réponse de l'assistant
        answer_text = assistant_data.get("answer", "")
        with _conn() as conn:
            conn.execute(
                "INSERT INTO assistant_history (user_id, session_id, role, content, metadata, createdAt) VALUES (?, ?, 'assistant', ?, ?, datetime('now'));",
                (uid, session_id, answer_text, json.dumps({"intent": assistant_data.get("intent"), "actions_count": len(assistant_data.get("actions", []))}))
            )
        
        assistant_data["session_id"] = session_id
        
    except Exception as e:
        logger.warning("Erreur assistant IA: %s", e)
        assistant_data = {
            "answer": "Désolé, je n'ai pas pu traiter votre question. Pouvez-vous reformuler ?",
            "intent": "info",
            "actions": [],
            "session_id": session_id
        }
    
    return jsonify(ok=True, data=assistant_data)


@app.post("/api/dashboard/assistant-stream")
def api_dashboard_assistant_stream():
    """Assistant virtuel avec streaming SSE pour affichage progressif."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    body = request.get_json(force=True) or {}
    question = body.get("question", "").strip()
    if not question:
        return jsonify(ok=False, error="question requise"), 400
    
    session_id = body.get("session_id") or f"session_{uid}_{int(time.time())}"
    page_context = body.get("page_context", "")
    page_description = body.get("page_description", "")
    
    # Récupérer l'historique
    with _conn() as conn:
        history_rows = conn.execute(
            "SELECT role, content FROM assistant_history WHERE user_id=? AND session_id=? ORDER BY createdAt DESC LIMIT 10;",
            (uid, session_id)
        ).fetchall()
        conversation_history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]
    
    # Sauvegarder la question
    with _conn() as conn:
        conn.execute(
            "INSERT INTO assistant_history (user_id, session_id, role, content, createdAt) VALUES (?, ?, 'user', ?, datetime('now'));",
            (uid, session_id, question)
        )
    
    # Construire le prompt (simplifié pour streaming)
    today = _today_iso()
    with _conn() as conn:
        prospects_count = conn.execute("SELECT COUNT(*) as c FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchone()["c"]
        overdue_count = conn.execute("SELECT COUNT(*) as c FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND nextFollowUp < ?;", (uid, today)).fetchone()["c"]
    
    history_text = ""
    if conversation_history:
        history_text = "\n\nHistorique:\n" + "\n".join([f"{'User' if m['role']=='user' else 'Assistant'}: {m['content']}" for m in conversation_history[-5:]])
    
    prompt = f"""Tu es un assistant virtuel pour un CRM B2B. Contexte: {prospects_count} prospects, {overdue_count} relances en retard. Page: {page_description}.{history_text}\n\nQuestion: "{question}"\n\nRéponds de manière concise et utile."""
    
    def generate():
        full_response = ""
        try:
            yield f"data: {json.dumps({'type': 'start', 'session_id': session_id}, ensure_ascii=False)}\n\n"
            try:
                for event in _stream_ai_sse(prompt, None, 90):
                    if event.startswith("data: "):
                        data_str = event[6:].strip()
                        try:
                            data = json.loads(data_str)
                            if data.get("type") == "token":
                                token = data.get("text", "")
                                full_response += token
                                yield f"data: {json.dumps({'type': 'token', 'text': token}, ensure_ascii=False)}\n\n"
                            elif data.get("type") == "end":
                                # Sauvegarder la réponse complète
                                try:
                                    with _conn() as conn:
                                        conn.execute(
                                            "INSERT INTO assistant_history (user_id, session_id, role, content, createdAt) VALUES (?, ?, 'assistant', ?, datetime('now'));",
                                            (uid, session_id, full_response)
                                        )
                                except Exception as save_err:
                                    logger.warning("Erreur sauvegarde historique: %s", save_err)
                                yield f"data: {json.dumps({'type': 'end', 'session_id': session_id}, ensure_ascii=False)}\n\n"
                                return
                            elif data.get("type") == "error":
                                raise Exception(data.get("message", "Erreur streaming"))
                        except json.JSONDecodeError:
                            continue
                    else:
                        yield event
            except Exception as stream_err:
                logger.error("Erreur dans le stream: %s", stream_err)
                raise
        except Exception as e:
            logger.error("Erreur streaming assistant: %s", e)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
    
    return Response(stream_with_context(generate()), mimetype='text/event-stream')


@app.get("/api/dashboard/assistant/history")
def api_assistant_history():
    """Récupère l'historique de conversation de l'assistant."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    session_id = request.args.get("session_id")
    limit = int(request.args.get("limit", 50))
    
    with _conn() as conn:
        if session_id:
            rows = conn.execute(
                "SELECT role, content, createdAt FROM assistant_history WHERE user_id=? AND session_id=? ORDER BY createdAt ASC LIMIT ?;",
                (uid, session_id, limit)
            ).fetchall()
        else:
            # Dernière session
            last_session = conn.execute(
                "SELECT session_id FROM assistant_history WHERE user_id=? ORDER BY createdAt DESC LIMIT 1;",
                (uid,)
            ).fetchone()
            if not last_session:
                return jsonify(ok=True, history=[], session_id=None)
            session_id = last_session["session_id"]
            rows = conn.execute(
                "SELECT role, content, createdAt FROM assistant_history WHERE user_id=? AND session_id=? ORDER BY createdAt ASC LIMIT ?;",
                (uid, session_id, limit)
            ).fetchall()
        
        history = [{"role": r["role"], "content": r["content"], "createdAt": r["createdAt"]} for r in rows]
    
    return jsonify(ok=True, history=history, session_id=session_id)


@app.get("/api/dashboard/assistant/suggestions")
def api_assistant_suggestions():
    """Génère des suggestions de questions intelligentes selon le contexte."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    page_context = request.args.get("page_context", "")
    page_description = request.args.get("page_description", "")
    
    today = _today_iso()
    with _conn() as conn:
        overdue_count = conn.execute("SELECT COUNT(*) as c FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND nextFollowUp < ?;", (uid, today)).fetchone()["c"]
        rdv_count = conn.execute("SELECT COUNT(*) as c FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND statut='Rendez-vous';", (uid,)).fetchone()["c"]
    
    prompt = f"""Génère 5 suggestions de questions pertinentes pour un assistant CRM B2B.
Contexte: {page_description}. {overdue_count} relances en retard, {rdv_count} RDV.
Retourne UNIQUEMENT un JSON array de strings: ["question 1", "question 2", ...]"""
    
    try:
        ai_response = _call_ai(prompt, timeout=30)
        ai_response = ai_response.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:]
        if ai_response.startswith("```"):
            ai_response = ai_response[3:]
        if ai_response.endswith("```"):
            ai_response = ai_response[:-3]
        suggestions = json.loads(ai_response)
        if not isinstance(suggestions, list):
            suggestions = []
    except Exception as e:
        logger.warning("Erreur suggestions IA: %s", e)
        # Suggestions par défaut
        suggestions = [
            "Quels sont mes prospects à relancer ?",
            "Combien de RDV cette semaine ?",
            "Quelles sont mes priorités du jour ?",
            "Montre-moi les prospects du secteur automobile",
            "Quels candidats ont des compétences en C++ ?"
        ]
    
    return jsonify(ok=True, suggestions=suggestions[:5])


@app.post("/api/dashboard/assistant/action")
def api_assistant_action():
    """Exécute une action demandée par l'assistant (création, modification, fonctions IA, etc.)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    body = request.get_json(force=True) or {}
    action_type = body.get("type")
    params = body.get("params", {})
    
    if not action_type:
        return jsonify(ok=False, error="type d'action requis"), 400
    
    try:
        if action_type == "create_prospect":
            # Créer un prospect
            name = params.get("name", "").strip()
            company_name = params.get("company", "").strip()
            if not name:
                return jsonify(ok=False, error="Nom du prospect requis"), 400
            
            # Trouver ou créer l'entreprise
            with _conn() as conn:
                if company_name:
                    company = conn.execute("SELECT id FROM companies WHERE owner_id=? AND groupe=? AND deleted_at IS NULL LIMIT 1;", (uid, company_name)).fetchone()
                    if not company:
                        # Créer l'entreprise
                        cursor = conn.execute(
                            "INSERT INTO companies (groupe, site, owner_id) VALUES (?, ?, ?);",
                            (company_name, params.get("site", ""), uid)
                        )
                        company_id = cursor.lastrowid
                    else:
                        company_id = company["id"]
                else:
                    company_id = params.get("company_id")
                    if not company_id:
                        return jsonify(ok=False, error="Entreprise requise"), 400
                
                # Créer le prospect
                cursor = conn.execute(
                    "INSERT INTO prospects (name, company_id, fonction, telephone, email, linkedin, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (name, company_id, params.get("fonction"), params.get("telephone"), params.get("email"), params.get("linkedin"), uid)
                )
                prospect_id = cursor.lastrowid
            
            return jsonify(ok=True, message=f"Prospect '{name}' créé avec succès", data={"prospect_id": prospect_id})
        
        elif action_type == "create_company":
            groupe = params.get("groupe", "").strip()
            if not groupe:
                return jsonify(ok=False, error="Nom de l'entreprise requis"), 400
            
            with _conn() as conn:
                cursor = conn.execute(
                    "INSERT INTO companies (groupe, site, website, industry, owner_id) VALUES (?, ?, ?, ?, ?);",
                    (groupe, params.get("site"), params.get("website"), params.get("industry"), uid)
                )
                company_id = cursor.lastrowid
            
            return jsonify(ok=True, message=f"Entreprise '{groupe}' créée avec succès", data={"company_id": company_id})
        
        elif action_type == "create_candidate":
            name = params.get("name", "").strip()
            if not name:
                return jsonify(ok=False, error="Nom du candidat requis"), 400
            
            skills_json = json.dumps(params.get("skills", []))
            with _conn() as conn:
                cursor = conn.execute(
                    "INSERT INTO candidates (name, role, skills, phone, email, linkedin, owner_id, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'));",
                    (name, params.get("role"), skills_json, params.get("phone"), params.get("email"), params.get("linkedin"), uid)
                )
                candidate_id = cursor.lastrowid
            
            return jsonify(ok=True, message=f"Candidat '{name}' créé avec succès", data={"candidate_id": candidate_id})
        
        elif action_type == "modify_prospect":
            prospect_id = params.get("id")
            field = params.get("field")
            value = params.get("value")
            
            if not prospect_id or not field:
                return jsonify(ok=False, error="ID et champ requis"), 400
            
            if not _prospect_owned(prospect_id):
                return jsonify(ok=False, error="Prospect non trouvé ou accès refusé"), 404
            
            with _conn() as conn:
                conn.execute(f"UPDATE prospects SET {field}=? WHERE id=? AND owner_id=?;", (value, prospect_id, uid))
            
            return jsonify(ok=True, message="Prospect modifié avec succès")
        
        elif action_type == "ia_scrap":
            entity_type = params.get("type")
            entity_id = params.get("id")
            
            if not entity_type or not entity_id:
                return jsonify(ok=False, error="Type et ID requis"), 400
            
            # Retourner une instruction pour le frontend d'appeler la fonction IA appropriée
            return jsonify(ok=True, message="Fonction IA déclenchée", data={"ia_function": "scrap", "type": entity_type, "id": entity_id})
        
        elif action_type == "ia_avant_reunion":
            prospect_id = params.get("prospect_id")
            if not prospect_id or not _prospect_owned(prospect_id):
                return jsonify(ok=False, error="Prospect non trouvé"), 404
            return jsonify(ok=True, message="Génération fiche préparation", data={"ia_function": "avant_reunion", "prospect_id": prospect_id})
        
        elif action_type == "ia_apres_reunion":
            prospect_id = params.get("prospect_id")
            if not prospect_id or not _prospect_owned(prospect_id):
                return jsonify(ok=False, error="Prospect non trouvé"), 404
            return jsonify(ok=True, message="Génération compte-rendu", data={"ia_function": "apres_reunion", "prospect_id": prospect_id})
        
        else:
            return jsonify(ok=False, error=f"Type d'action non supporté: {action_type}"), 400
    
    except Exception as e:
        logger.error("Erreur exécution action assistant: %s", e)
        return jsonify(ok=False, error=str(e)), 500


# ═══════════════════════════════════════════════════════════════════
# v29.0: DC Generator — Dossier de Compétences format Up Technologies
# ═══════════════════════════════════════════════════════════════════

@app.route('/dc-generator')
@login_required
def dc_generator():
    """Redirige vers l'UI v30. ?candidate=X conservé via segment /v30/dc/<X>."""
    cid = (request.args.get("candidate") or "").strip()
    if cid.isdigit():
        return redirect(f"/v30/dc/{cid}", code=302)
    return redirect("/v30/dc", code=302)


@app.route('/candidates/<int:candidate_id>/dc-generator')
@login_required
def dc_generator_candidate(candidate_id):
    return redirect(f"/v30/dc/{candidate_id}", code=302)


@app.route('/dc-generator/template')
@login_required
def dc_generator_template():
    """Téléchargement du template vide template_dc.docx"""
    template_path = os.path.join(APP_DIR, 'sample', 'template_dc.docx')
    if not os.path.exists(template_path):
        abort(404)
    return send_file(
        template_path,
        as_attachment=True,
        download_name='template_dc.docx',
        mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )


@app.route('/dc-generator/upload-template', methods=['POST'])
@login_required
@role_required('admin')
def dc_generator_upload_template():
    """Remplace le template template_dc.docx (admin uniquement)"""
    import shutil as _shutil
    if 'template_file' not in request.files:
        return jsonify({'success': False, 'error': 'Aucun fichier fourni'}), 400
    f = request.files['template_file']
    if not f.filename.lower().endswith('.docx'):
        return jsonify({'success': False, 'error': 'Fichier .docx requis'}), 400

    template_dir  = os.path.join(APP_DIR, 'sample')
    template_path = os.path.join(template_dir, 'template_dc.docx')
    os.makedirs(template_dir, exist_ok=True)

    # Sauvegarde de l'ancien template
    if os.path.exists(template_path):
        _shutil.copy2(template_path, template_path + '.bak')
    try:
        f.save(template_path)
        # Vérifier que c'est un docx valide
        from docx import Document as _Docx
        _Docx(template_path)
        return jsonify({'success': True})
    except Exception as e:
        # Restaurer le backup si le fichier est invalide
        bak = template_path + '.bak'
        if os.path.exists(bak):
            _shutil.copy2(bak, template_path)
        return jsonify({'success': False, 'error': f'Fichier invalide : {e}'}), 400


@app.route('/dc-generator/generate', methods=['POST'])
@login_required
def dc_generator_generate():
    """Génère le dossier de compétences Word (.docx)"""
    uid = _uid()
    tmp_cv = None
    try:
        from utils.cv_parser import CVParser
        from utils.dossier_generator import DossierGenerator

        candidate_id = request.form.get('candidate_id')
        use_ollama   = request.form.get('use_ollama', 'auto')  # 'auto'|'yes'|'no'
        ollama_available = False

        # Données de base depuis la DB si candidat fourni
        base_data = {}
        if candidate_id:
            with _conn() as conn:
                row = conn.execute(
                    "SELECT * FROM candidates WHERE id=? AND owner_id=?", (candidate_id, uid)
                ).fetchone()
            if row:
                base_data = _safe_row_to_dict(row) or {}

        # ── Extraction du CV ──────────────────────────────────────────────────
        cv_data = {}
        cv_text = ''
        ollama_ok = False

        if 'cv_file' in request.files and request.files['cv_file'].filename:
            cv_file = request.files['cv_file']
            ext = os.path.splitext(cv_file.filename)[1].lower()
            import tempfile as _tempfile
            fd, tmp_cv = _tempfile.mkstemp(suffix=ext, prefix='cv_upload_')
            os.close(fd)
            cv_file.save(tmp_cv)

            # Extraire le texte brut pour Ollama
            if ext == '.pdf':
                # Tentative 1 : PyMuPDF (fitz) — meilleure extraction, préserve la structure
                try:
                    import fitz as _fitz
                    _doc = _fitz.open(tmp_cv)
                    cv_text = '\n'.join(page.get_text() for page in _doc)
                    _doc.close()
                    logger.info("DC Generator: PDF extrait via PyMuPDF (%d chars)", len(cv_text))
                except Exception as _e1:
                    logger.warning("DC Generator: PyMuPDF échoué (%s), essai pypdf", _e1)
                # Tentative 2 : pypdf — fallback fiable
                if not cv_text.strip():
                    try:
                        from pypdf import PdfReader as _PdfReader
                        _reader = _PdfReader(tmp_cv)
                        cv_text = '\n'.join(
                            page.extract_text() or ''
                            for page in _reader.pages
                        )
                        logger.info("DC Generator: PDF extrait via pypdf (%d chars)", len(cv_text))
                    except Exception as _e2:
                        logger.warning("DC Generator: pypdf échoué aussi (%s)", _e2)
                if not cv_text.strip():
                    logger.error("DC Generator: impossible d'extraire le texte du PDF — aucune lib disponible")
            elif ext in ('.docx', '.doc'):
                try:
                    from docx import Document as _Docx
                    _doc = _Docx(tmp_cv)
                    cv_text = '\n'.join(p.text for p in _doc.paragraphs if p.text.strip())
                except Exception:
                    pass

            # ── Essayer l'IA locale si texte disponible ───────────────────────
            # Utilise _load_ai_config() — source unique de config (UI Paramètres > IA).
            # Pas de ping préalable : qwen2.5:7b peut mettre 15-30s à charger à froid,
            # un ping avec timeout court déclarerait l'IA indisponible à tort.
            # On tente l'extraction directement avec le timeout configuré (≥120s).
            ollama_ok = False
            ollama_available = True  # optimiste — on ne sait pas avant d'essayer
            if cv_text.strip() and use_ollama != 'no':
                try:
                    ai_cfg = _load_ai_config()
                    ollama_url     = ai_cfg.get('ollama_url', OLLAMA_URL)
                    ollama_model   = ai_cfg.get('ollama_model', OLLAMA_MODEL)
                    ollama_timeout = max(300, int(ai_cfg.get('ollama_timeout') or OLLAMA_TIMEOUT))

                    from utils.ollama_extractor import extract as _ollama_extract
                    extracted = _ollama_extract(cv_text, ollama_url, ollama_model, ollama_timeout)
                    if extracted and (extracted.get('competences') or extracted.get('nom') or extracted.get('experiences')):
                        cv_data = extracted
                        ollama_ok = True
                        logger.info("DC Generator: extraction IA OK (missing=%s)",
                                    extracted.get('_missing', []))
                    else:
                        logger.warning("DC Generator: extraction IA retournée vide (modèle=%s)", ollama_model)
                except Exception as _oe:
                    logger.warning("DC Generator: extraction IA échouée: %s", _oe)
                    ollama_available = False

            # ── Fallback : extraction basique si Ollama indisponible ──────────
            # N'utilise PAS CVParser (calibré pour tableaux Up Tech uniquement).
            # Extrait uniquement nom/titre depuis les premières lignes du texte.
            if not ollama_ok and cv_text.strip():
                import re as _re2
                _lines = [l.strip() for l in cv_text.split('\n') if l.strip()][:20]
                _nom = _prenom = _titre = _annees = ''
                _caps = _re2.compile(r'^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ\s\-/–]{7,}$')
                for _l in _lines[:8]:
                    if _caps.match(_l) and len(_l.split()) >= 2:
                        _titre = _l; break
                _name_re = _re2.compile(
                    r'^([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][a-zàâäéèêëîïôùûüç]+(?:-[A-Za-zÀ-ÿ]+)*)'
                    r'\s+([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][A-Za-zÀ-ÿ\-]+)$')
                for _l in _lines[:12]:
                    _m = _name_re.match(_l)
                    if _m:
                        _prenom, _nom = _m.group(1), _m.group(2).upper(); break
                _ym = _re2.search(r"(\d+)\s*ans?\s+d['’]expérience", cv_text[:2000], _re2.IGNORECASE)
                if _ym:
                    _annees = _ym.group(1) + " ans d'expérience"
                cv_data = {
                    'nom': _nom, 'prenom': _prenom,
                    'titre_poste': _titre, 'annees_experience': _annees,
                    'competences': [], 'experiences': [], 'formations': [],
                    'langues': [], 'certifications': [],
                }

            # Merge identité depuis la DB (nom/prenom/titre prioritaires si renseignés)
            if base_data:
                for _k in ('nom', 'prenom', 'titre_poste', 'email', 'telephone'):
                    _v = base_data.get(_k, '')
                    if _v and str(_v).strip() and not cv_data.get(_k):
                        cv_data[_k] = str(_v).strip()
                if not cv_data.get('annees_experience'):
                    _yrs = base_data.get('annees_experience') or base_data.get('years_experience')
                    if _yrs:
                        cv_data['annees_experience'] = f"{_yrs} ans d'expérience"
        else:
            # Pas de CV — utiliser les données DB uniquement
            cv_data = {
                'nom':               base_data.get('nom', base_data.get('name', '')),
                'prenom':            base_data.get('prenom', ''),
                'titre_poste':       base_data.get('titre', base_data.get('role', '')),
                'annees_experience': '',
                'competences': [], 'experiences': [],
                'formations':  [], 'langues': [], 'certifications': []
            }

        # ── Générer le fichier Word ───────────────────────────────────────────
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        cid_str   = str(candidate_id) if candidate_id else 'standalone'
        nom_raw   = f"{cv_data.get('nom','candidat')} {cv_data.get('prenom','')}".strip()
        nom_clean = re.sub(r'[^\w\-]', '_', nom_raw)
        output_path = os.path.join(
            str(APP_DIR), 'outputs', 'dossiers',
            f'{cid_str}_{nom_clean}_{timestamp}.docx'
        )
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        gen = DossierGenerator()
        gen.generate(cv_data, output_path)

        # ── Sauvegarder en DB ─────────────────────────────────────────────────
        nom_dl = f"Dossier_Up_{cv_data.get('nom','')}_{cv_data.get('prenom','')}.docx"
        gen_iso = datetime.datetime.now().isoformat()
        gen_id = None
        with _conn() as conn:
            if candidate_id:
                conn.execute(
                    "UPDATE candidates SET dossier_path=?, dossier_generated_at=? WHERE id=? AND owner_id=?",
                    (output_path, gen_iso, candidate_id, uid)
                )
            try:
                cur = conn.execute(
                    "INSERT INTO dc_generations (candidate_id, filename, file_path, used_ollama, generated_at, owner_id) "
                    "VALUES (?, ?, ?, ?, ?, ?);",
                    (
                        int(candidate_id) if candidate_id else None,
                        nom_dl,
                        output_path,
                        1 if ollama_ok else 0,
                        gen_iso,
                        uid,
                    )
                )
                gen_id = cur.lastrowid
            except Exception as _e:
                logger.warning("DC Generator: insert dc_generations failed: %s", _e)
            conn.commit()

        import urllib.parse as _urlparse
        missing_fields = cv_data.pop('_missing', []) if isinstance(cv_data, dict) else []
        return jsonify({
            'success':         True,
            'id':              gen_id,
            'download_url':    '/dc-generator/download?path=' + _urlparse.quote(output_path, safe=''),
            'filename':        nom_dl,
            'generated_at':    datetime.datetime.now().strftime('%d/%m/%Y à %H:%M'),
            'used_ollama':     bool(ollama_ok),
            'ollama_available': bool(ollama_available),
            'missing_fields':  missing_fields,
        })
    except Exception as e:
        logger.error("DC Generator error: %s", e, exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if tmp_cv:
            try:
                os.remove(tmp_cv)
            except Exception:
                pass


@app.route('/dc-generator/generate-stream', methods=['POST'])
@login_required
def dc_generator_generate_stream():
    """Génère le DC en streamant les étapes via SSE pour un retour en direct."""
    import queue as _queue
    import threading as _threading
    import json as _json

    uid = _uid()

    # Lire le fichier AVANT de déléguer au thread (le contexte request ne sera plus dispo)
    candidate_id = request.form.get('candidate_id')
    use_ollama   = request.form.get('use_ollama', 'auto')

    tmp_cv = None
    cv_filename = ''
    cv_ext = ''
    cv_size = 0
    if 'cv_file' in request.files and request.files['cv_file'].filename:
        cv_file = request.files['cv_file']
        cv_filename = cv_file.filename
        cv_ext = os.path.splitext(cv_filename)[1].lower()
        import tempfile as _tempfile
        fd, tmp_cv = _tempfile.mkstemp(suffix=cv_ext, prefix='cv_upload_')
        os.close(fd)
        cv_file.save(tmp_cv)
        cv_size = os.path.getsize(tmp_cv)

    q = _queue.Queue()
    _app_ctx = app.app_context()

    def do_work():
        _app_ctx.push()
        try:
            from utils.dossier_generator import DossierGenerator

            def log(msg, level='info'):
                q.put({'type': 'log', 'msg': msg, 'level': level})

            base_data = {}
            if candidate_id:
                with _conn() as conn:
                    row = conn.execute(
                        "SELECT * FROM candidates WHERE id=? AND owner_id=?", (candidate_id, uid)
                    ).fetchone()
                if row:
                    base_data = _safe_row_to_dict(row) or {}
                    _cname = base_data.get('name') or (
                        (base_data.get('prenom','') + ' ' + base_data.get('nom','')).strip()
                    ) or f'#{candidate_id}'
                    log(f"Candidat chargé : {_cname}")

            cv_data = {}
            cv_text = ''
            ollama_ok = False
            ollama_available = True

            if tmp_cv:
                size_ko = max(1, cv_size // 1024)
                log(f"Fichier reçu : {cv_filename} ({size_ko} ko)")

                if cv_ext == '.pdf':
                    log("Extraction texte PDF (PyMuPDF)…")
                    try:
                        import fitz as _fitz
                        _doc = _fitz.open(tmp_cv)
                        cv_text = '\n'.join(page.get_text() for page in _doc)
                        _doc.close()
                        log(f"✓ PDF extrait via PyMuPDF : {len(cv_text)} caractères")
                    except Exception as _e1:
                        log(f"⚠ PyMuPDF échoué : {_e1}", 'warn')

                    if not cv_text.strip():
                        log("Tentative extraction via pypdf…")
                        try:
                            from pypdf import PdfReader as _PdfReader
                            _reader = _PdfReader(tmp_cv)
                            cv_text = '\n'.join(page.extract_text() or '' for page in _reader.pages)
                            log(f"✓ PDF extrait via pypdf : {len(cv_text)} caractères")
                        except Exception as _e2:
                            log(f"✗ pypdf échoué : {_e2}", 'error')

                    if not cv_text.strip():
                        log("✗ Impossible d'extraire le texte du PDF", 'error')
                        q.put({'type': 'error', 'msg': "Impossible de lire le contenu du PDF. Essayez de convertir en DOCX."})
                        return

                elif cv_ext in ('.docx', '.doc'):
                    log("Extraction texte DOCX…")
                    try:
                        from docx import Document as _Docx
                        _doc = _Docx(tmp_cv)
                        cv_text = '\n'.join(p.text for p in _doc.paragraphs if p.text.strip())
                        log(f"✓ DOCX extrait : {len(cv_text)} caractères")
                    except Exception as _e:
                        log(f"✗ Extraction DOCX échouée : {_e}", 'error')

                if cv_text.strip() and use_ollama != 'no':
                    ai_cfg   = _load_ai_config()
                    ol_url   = ai_cfg.get('ollama_url', OLLAMA_URL)
                    ol_model = ai_cfg.get('ollama_model', OLLAMA_MODEL)
                    ol_timeout = max(300, int(ai_cfg.get('ollama_timeout') or OLLAMA_TIMEOUT))
                    log(f"Envoi à l'IA locale ({ol_model}, timeout={ol_timeout}s)… peut prendre 1-3 min")

                    try:
                        from utils.ollama_extractor import extract as _ollama_extract
                        extracted = _ollama_extract(cv_text, ol_url, ol_model, ol_timeout)
                        if extracted and (extracted.get('competences') or extracted.get('nom') or extracted.get('experiences')):
                            cv_data  = extracted
                            ollama_ok = True
                            missing  = extracted.get('_missing', [])
                            nc = len(extracted.get('competences') or [])
                            ne = len(extracted.get('experiences') or [])
                            log(f"✓ Extraction IA OK : {nc} compétences, {ne} expériences" +
                                (f" — champs manquants : {', '.join(missing)}" if missing else ""))
                        else:
                            log("⚠ L'IA a retourné une réponse vide ou illisible", 'warn')
                    except Exception as _oe:
                        log(f"✗ IA échouée : {_oe}", 'error')
                        ollama_available = False
                elif not cv_text.strip():
                    log("⚠ Pas de texte extrait — génération sans IA", 'warn')

                if not ollama_ok and cv_text.strip():
                    log("Extraction basique (nom/titre depuis premières lignes)…", 'warn')
                    import re as _re2
                    _lines = [l.strip() for l in cv_text.split('\n') if l.strip()][:20]
                    _nom = _prenom = _titre = _annees = ''
                    _caps = _re2.compile(r'^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ\s\-/–]{7,}$')
                    for _l in _lines[:8]:
                        if _caps.match(_l) and len(_l.split()) >= 2:
                            _titre = _l; break
                    _name_re = _re2.compile(
                        r'^([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][a-zàâäéèêëîïôùûüç]+(?:-[A-Za-zÀ-ÿ]+)*)'
                        r'\s+([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜ][A-Za-zÀ-ÿ\-]+)$')
                    for _l in _lines[:12]:
                        _m = _name_re.match(_l)
                        if _m:
                            _prenom, _nom = _m.group(1), _m.group(2).upper(); break
                    _ym = _re2.search(r"(\d+)\s*ans?\s+d['']expérience", cv_text[:2000], _re2.IGNORECASE)
                    if _ym:
                        _annees = _ym.group(1) + " ans d'expérience"
                    cv_data = {
                        'nom': _nom, 'prenom': _prenom,
                        'titre_poste': _titre, 'annees_experience': _annees,
                        'competences': [], 'experiences': [], 'formations': [],
                        'langues': [], 'certifications': [],
                    }
            else:
                log("Pas de CV fourni — données candidat uniquement")
                cv_data = {
                    'nom':               base_data.get('nom', base_data.get('name', '')),
                    'prenom':            base_data.get('prenom', ''),
                    'titre_poste':       base_data.get('titre', base_data.get('role', '')),
                    'annees_experience': '',
                    'competences': [], 'experiences': [],
                    'formations': [], 'langues': [], 'certifications': []
                }

            if base_data:
                for _k in ('nom', 'prenom', 'titre_poste', 'email', 'telephone'):
                    _v = base_data.get(_k, '')
                    if _v and str(_v).strip() and not cv_data.get(_k):
                        cv_data[_k] = str(_v).strip()
                if not cv_data.get('annees_experience'):
                    _yrs = base_data.get('annees_experience') or base_data.get('years_experience')
                    if _yrs:
                        cv_data['annees_experience'] = f"{_yrs} ans d'expérience"

            log("Génération du fichier DOCX…")
            timestamp   = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            cid_str     = str(candidate_id) if candidate_id else 'standalone'
            nom_raw     = f"{cv_data.get('nom','candidat')} {cv_data.get('prenom','')}".strip()
            nom_clean   = re.sub(r'[^\w\-]', '_', nom_raw)
            output_path = os.path.join(
                str(APP_DIR), 'outputs', 'dossiers',
                f'{cid_str}_{nom_clean}_{timestamp}.docx'
            )
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            gen = DossierGenerator()
            gen.generate(cv_data, output_path)
            log("✓ DOCX généré")

            nom_dl  = f"Dossier_Up_{cv_data.get('nom','')}_{cv_data.get('prenom','')}.docx"
            gen_iso = datetime.datetime.now().isoformat()
            gen_id  = None
            with _conn() as conn:
                if candidate_id:
                    conn.execute(
                        "UPDATE candidates SET dossier_path=?, dossier_generated_at=? WHERE id=? AND owner_id=?",
                        (output_path, gen_iso, candidate_id, uid)
                    )
                try:
                    cur = conn.execute(
                        "INSERT INTO dc_generations (candidate_id, filename, file_path, used_ollama, generated_at, owner_id) "
                        "VALUES (?, ?, ?, ?, ?, ?);",
                        (int(candidate_id) if candidate_id else None,
                         nom_dl, output_path, 1 if ollama_ok else 0, gen_iso, uid)
                    )
                    gen_id = cur.lastrowid
                except Exception as _e:
                    logger.warning("DC stream: insert dc_generations failed: %s", _e)
                conn.commit()

            import urllib.parse as _urlparse
            missing_fields = cv_data.pop('_missing', []) if isinstance(cv_data, dict) else []
            q.put({
                'type':             'result',
                'success':          True,
                'id':               gen_id,
                'download_url':     '/dc-generator/download?path=' + _urlparse.quote(output_path, safe=''),
                'filename':         nom_dl,
                'generated_at':     datetime.datetime.now().strftime('%d/%m/%Y à %H:%M'),
                'used_ollama':      bool(ollama_ok),
                'ollama_available': bool(ollama_available),
                'missing_fields':   missing_fields,
            })

        except Exception as _ex:
            logger.error("DC stream error: %s", _ex, exc_info=True)
            q.put({'type': 'error', 'msg': str(_ex)})
        finally:
            if tmp_cv:
                try: os.remove(tmp_cv)
                except Exception: pass
            _app_ctx.pop()
            q.put(None)  # sentinelle fin de stream

    _threading.Thread(target=do_work, daemon=True).start()

    def _sse_generator():
        while True:
            item = q.get()
            if item is None:
                break
            yield f"data: {_json.dumps(item, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(_sse_generator()),
        content_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


@app.route('/api/dc/history', methods=['GET'])
@login_required
def api_dc_history():
    """Liste des DC générés par l'utilisateur (filtre optionnel par candidate_id)."""
    uid = _uid()
    cid_arg = request.args.get('candidate_id')
    limit = max(1, min(int(request.args.get('limit') or 50), 200))
    sql = (
        "SELECT g.id, g.candidate_id, g.filename, g.file_path, g.used_ollama, g.generated_at, "
        "       c.name AS candidate_name, c.role AS candidate_role "
        "FROM dc_generations g "
        "LEFT JOIN candidates c ON c.id = g.candidate_id AND c.owner_id = g.owner_id "
        "WHERE g.owner_id=? AND g.deleted_at IS NULL"
    )
    params = [uid]
    if cid_arg:
        try:
            sql += " AND g.candidate_id=?"
            params.append(int(cid_arg))
        except ValueError:
            pass
    sql += " ORDER BY g.generated_at DESC LIMIT ?"
    params.append(limit)
    items = []
    with _conn() as conn:
        for row in conn.execute(sql, tuple(params)).fetchall():
            d = dict(row)
            # File missing on disk → flag it but keep entry
            try:
                d['exists'] = bool(d.get('file_path')) and os.path.exists(d['file_path'])
            except Exception:
                d['exists'] = False
            d['used_ollama'] = bool(d.get('used_ollama'))
            # Format human date
            iso = d.get('generated_at') or ''
            try:
                _dt = datetime.datetime.fromisoformat(iso)
                d['generated_at_human'] = _dt.strftime('%d/%m/%Y à %H:%M')
            except Exception:
                d['generated_at_human'] = iso
            d['download_url'] = f"/api/dc/{d['id']}/download"
            items.append(d)
    return jsonify({'data': items, 'error': None})


@app.route('/api/dc/<int:gen_id>/download', methods=['GET'])
@login_required
def api_dc_download(gen_id):
    """Télécharge un DC généré par son id (sécurise via owner_id)."""
    uid = _uid()
    with _conn() as conn:
        row = conn.execute(
            "SELECT file_path, filename FROM dc_generations "
            "WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (gen_id, uid)
        ).fetchone()
    if not row:
        abort(404)
    file_path = row['file_path']
    if not file_path or '..' in file_path:
        abort(404)
    abs_path = os.path.abspath(file_path)
    allowed_dir = os.path.abspath(os.path.join(APP_DIR, 'outputs', 'dossiers'))
    if not abs_path.startswith(allowed_dir):
        abort(403)
    if not os.path.exists(abs_path):
        abort(404)
    nom = row['filename'] or os.path.basename(abs_path).replace('_', ' ')
    mime = ('application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            if abs_path.endswith('.docx') else 'application/pdf')
    return send_file(abs_path, as_attachment=True, download_name=nom, mimetype=mime)


@app.route('/api/dc/<int:gen_id>', methods=['DELETE'])
@login_required
def api_dc_delete(gen_id):
    """Soft-delete d'un DC généré + suppression du fichier physique si présent."""
    uid = _uid()
    now = datetime.datetime.now().isoformat()
    file_to_remove = None
    with _conn() as conn:
        row = conn.execute(
            "SELECT file_path FROM dc_generations WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (gen_id, uid)
        ).fetchone()
        if not row:
            return jsonify({'data': None, 'error': 'not_found'}), 404
        file_to_remove = row['file_path']
        conn.execute(
            "UPDATE dc_generations SET deleted_at=? WHERE id=? AND owner_id=?;",
            (now, gen_id, uid)
        )
        conn.commit()
    if file_to_remove:
        try:
            abs_path = os.path.abspath(file_to_remove)
            allowed_dir = os.path.abspath(os.path.join(APP_DIR, 'outputs', 'dossiers'))
            if abs_path.startswith(allowed_dir) and os.path.exists(abs_path):
                os.remove(abs_path)
        except Exception as _e:
            logger.warning("DC delete: physical remove failed: %s", _e)
    return jsonify({'data': {'id': gen_id, 'deleted': True}, 'error': None})


@app.route('/dc-generator/download')
@login_required
def dc_generator_download():
    import urllib.parse as _urlparse
    path = _urlparse.unquote(request.args.get('path', ''))
    if not path or '..' in path:
        abort(404)
    # Sécurité : le fichier doit être dans outputs/dossiers/
    abs_path = os.path.abspath(path)
    allowed_dir = os.path.abspath(os.path.join(APP_DIR, 'outputs', 'dossiers'))
    if not abs_path.startswith(allowed_dir):
        abort(403)
    if not os.path.exists(abs_path):
        abort(404)
    nom = os.path.basename(abs_path).replace('_', ' ')
    mime = ('application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            if abs_path.endswith('.docx') else 'application/pdf')
    return send_file(abs_path, as_attachment=True, download_name=nom, mimetype=mime)


@app.route('/candidates/<int:candidate_id>/dossier/download')
@login_required
def candidate_dossier_download(candidate_id):
    uid = _uid()
    with _conn() as conn:
        row = conn.execute(
            "SELECT dossier_path, nom, prenom, name FROM candidates WHERE id=? AND owner_id=?",
            (candidate_id, uid)
        ).fetchone()
    if not row or not row['dossier_path']:
        abort(404)
    abs_path = os.path.abspath(row['dossier_path'])
    if not os.path.exists(abs_path):
        abort(404)
    nom = row['nom'] or row['name'] or 'Candidat'
    prenom = row['prenom'] or ''
    ext = '.docx' if abs_path.endswith('.docx') else '.pdf'
    nom_dl = f"Dossier_Compétences_Up_{nom}_{prenom}{ext}"
    mime = ('application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            if ext == '.docx' else 'application/pdf')
    return send_file(abs_path, as_attachment=True, download_name=nom_dl, mimetype=mime)


# ── Blueprints ────────────────────────────────────────────────────
# Importés en bas de fichier pour que tous les helpers soient déjà
# définis. Quand app.py est lancé comme script (__name__ == '__main__'),
# Python l'enregistre sous '__main__' et non 'app'. Les blueprints qui
# font `from app import ...` déclencheraient alors un import circulaire.
# Solution : on enregistre ce module sous le nom 'app' dans sys.modules
# avant les imports, ce qui évite un second chargement.
import sys as _sys  # noqa: E402
_sys.modules.setdefault('app', _sys.modules[__name__])

from routes.auth import auth_bp    # noqa: E402
from routes.deploy import deploy_bp  # noqa: E402
from routes.ai import ai_bp          # noqa: E402
from routes.transcription import transcription_bp, init_resume as _transcription_init_resume  # noqa: E402
app.register_blueprint(auth_bp)
app.register_blueprint(deploy_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(transcription_bp)


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    init_db()
    _migrate_users_schema()
    _migrate_candidate_statuses(DB_PATH)
    _migrate_all_user_dbs()
    _migrate_v30_all()
    load_initial_data_if_needed()
    # v32.1 — marque les transcriptions interrompues (crash/redémarrage) en erreur
    try:
        _transcription_init_resume()
    except Exception as _exc:
        logger.warning("init_resume transcription : %s", _exc)

    # Vérifier si une validation post-update est en attente (app redémarrée après un pull)
    if (APP_DIR / ".pending_validation").exists():
        _start_validation_timer()
        logger.info("Validation post-mise à jour en attente — rollback automatique dans %ds si non confirmée",
                    _VALIDATION_TIMEOUT_SECONDS)

    # Production mode with waitress (HTTPS via Cloudflare Tunnel)
    use_waitress = '--production' in sys.argv or '--prod' in sys.argv
    host = "0.0.0.0"  # Bind all interfaces for tunnel access
    port = int(os.environ.get("PORT", 8000))

    logger.info("Prosp'Up v%s starting (mode=%s, host=%s, port=%d)",
                APP_VERSION, "production" if use_waitress else "dev", host, port)

    # Scheduler backup journalier (3h00 chaque nuit) + purge soft-deleted (dimanche 4h00)
    # Ignoré dans le processus watcher de Werkzeug pour éviter le double démarrage
    if use_waitress or os.environ.get('WERKZEUG_RUN_MAIN'):
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from backup import create_backup as _backup_create
            import atexit

            def _purge_old_soft_deletes():
                """v27.10: Supprime définitivement les enregistrements soft-deleted depuis plus de 30 jours."""
                cutoff = (datetime.datetime.now() - datetime.timedelta(days=30)).isoformat(timespec="seconds")
                try:
                    with _conn() as conn:
                        purged = {}
                        for tbl in ("prospects", "companies", "candidates"):
                            cur = conn.execute(f"DELETE FROM {tbl} WHERE deleted_at IS NOT NULL AND deleted_at < ?;", (cutoff,))
                            purged[tbl] = cur.rowcount
                    total = sum(purged.values())
                    if total:
                        logger.info("Purge soft-deleted: %s enregistrements supprimés (%s)", total, purged)
                    _audit_log("purge", "system", new_value=json.dumps(purged))
                except Exception as exc:
                    logger.error("Erreur purge soft-deleted: %s", exc)

            _scheduler = BackgroundScheduler()
            _scheduler.add_job(
                func=_backup_create,
                trigger='cron',
                hour=3, minute=0,
                id='daily_backup',
                replace_existing=True,
            )
            _scheduler.add_job(
                func=_purge_old_soft_deletes,
                trigger='cron',
                day_of_week='sun', hour=4, minute=0,
                id='weekly_purge_soft_deleted',
                replace_existing=True,
            )
            _scheduler.start()
            atexit.register(lambda: _scheduler.shutdown())
            logger.info("Scheduler démarré — backup 3h00, purge soft-deleted dim. 4h00")
        except ImportError:
            logger.warning("apscheduler non installé — backup/purge automatique désactivés. Installer : pip install apscheduler")

    if use_waitress:
        try:
            from waitress import serve
            print(f"Prosp'Up v{APP_VERSION} en production (waitress) sur http://{host}:{port}")
            logger.info("Waitress server started with 4 threads")
            serve(app, host=host, port=port, threads=4)
        except ImportError:
            print("ATTENTION: waitress non installe, fallback sur Flask dev server")
            logger.warning("waitress not installed, falling back to Flask dev server")
            print(f"Prosp'Up demarre sur http://{host}:{port}")
            app.run(host=host, port=port, debug=False)
    else:
        print("ATTENTION: Mode developpement — NE PAS utiliser en production 24/7")
        print(f"    Lancer avec: python app.py --prod")
        print(f"Prosp'Up v{APP_VERSION} en dev sur http://127.0.0.1:{port}")
        logger.info("Dev server started (debug=True) — not for 24/7 use")
        app.run(host="127.0.0.1", port=port, debug=True)
