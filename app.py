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
APP_VERSION = "27.10"
import os
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

# Multi-provider IA — Perplexity Sonar (cloud + recherche web)
SONAR_API_KEY = os.environ.get("PERPLEXITY_API_KEY") or ""
SONAR_MODEL = os.environ.get("SONAR_MODEL") or "sonar"
SONAR_URL = "https://api.perplexity.ai/chat/completions"

# ═══════════════════════════════════════════════════════════════════
# v26.5: IA simplifiée — Ollama (local) + Sonar (cloud + web)
# ═══════════════════════════════════════════════════════════════════
_AI_CONFIG_FILE = DATA_DIR / "ai_config.json"
_ai_config_cache: dict | None = None

def _load_ai_config() -> dict:
    """Charge la config IA depuis le fichier ou les variables d'environnement."""
    global _ai_config_cache
    if _ai_config_cache is not None:
        return _ai_config_cache
    defaults = {
        "provider": os.environ.get("AI_PROVIDER") or "ollama",
        "fallback_enabled": True,
        "ollama_url": OLLAMA_URL,
        "ollama_model": OLLAMA_MODEL,
        "sonar_api_key": SONAR_API_KEY,
        "sonar_model": SONAR_MODEL,
    }
    if _AI_CONFIG_FILE.exists():
        try:
            with open(_AI_CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            for k, v in saved.items():
                if v is not None and v != "":
                    defaults[k] = v
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
    """Appel IA non-streaming unifié. Retourne le texte généré. Gère le fallback Ollama ↔ Sonar."""
    config = _load_ai_config()
    provider = config.get("provider", "ollama")
    fallback = config.get("fallback_enabled", True)
    try:
        return _call_ai_provider(provider, prompt, config, timeout)
    except Exception as primary_err:
        if not fallback:
            raise
        alt = "ollama" if provider == "sonar" else "sonar"
        if alt == "sonar" and not config.get("sonar_api_key"):
            raise primary_err
        try:
            logger.info("IA fallback %s → %s", provider, alt)
            return _call_ai_provider(alt, prompt, config, timeout)
        except Exception:
            raise primary_err

def _call_ai_web(prompt: str, timeout: int = 120) -> str:
    """Appel IA avec recherche web. Sonar si configuré (avec citations + fallback), sinon provider principal."""
    config = _load_ai_config()
    if config.get("sonar_api_key"):
        try:
            logger.info("IA web: utilisation de Sonar pour recherche web")
            result = _call_sonar(prompt, config, timeout, include_citations=True)
            logger.info("IA web: Sonar a réussi (%d caractères)", len(result))
            return result
        except Exception as e:
            logger.warning("Sonar failed, falling back to main provider: %s", str(e))
            logger.warning("Détails erreur Sonar: %s", repr(e))
    else:
        logger.info("IA web: Sonar non configuré, utilisation du provider principal")
    return _call_ai(prompt, timeout)

# ═══════════════════════════════════════════════════════════════════
# Phase 1: Système d'embeddings pour matching sémantique
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
    config = config or _load_ai_config()
    
    # Vérifier le cache
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
    """Appelle un provider spécifique (non-streaming)."""
    if provider == "sonar":
        return _call_sonar(prompt, config, timeout)
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

def _call_sonar(prompt: str, config: dict, timeout: int, include_citations: bool = False) -> str:
    """Appel à Perplexity Sonar (non-streaming, recherche web intégrée)."""
    api_key = config.get("sonar_api_key", "")
    if not api_key:
        raise ValueError("Clé API Perplexity non configurée. Ajoutez-la dans Paramètres > Configuration IA.")
    model = config.get("sonar_model", SONAR_MODEL)
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.3,
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        SONAR_URL, data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["choices"][0]["message"]["content"].strip()
        if include_citations:
            citations = data.get("citations", [])
            if citations:
                logger.info("Sonar: %d citations trouvées", len(citations))
                text += "\n\n📎 Sources :\n" + "\n".join(f"- {c}" for c in citations[:5])
        logger.info("Sonar: réponse reçue (%d caractères)", len(text))
        return text
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            if e.fp:
                error_body = e.read().decode("utf-8")
        except Exception:
            pass
        logger.error("Sonar HTTP error %d: %s", e.code, error_body[:500] if error_body else e.reason)
        raise ValueError(f"Erreur Sonar {e.code}: {error_body[:200] if error_body else e.reason}")
    except Exception as e:
        logger.error("Sonar error: %s", str(e))
        raise

def _stream_ai_web_sse(prompt: str, model_override: str | None, timeout: int):
    """Stream SSE pour recherche web (Sonar si configuré, sinon provider principal)."""
    config = _load_ai_config()
    if config.get("sonar_api_key"):
        try:
            yield from _stream_sonar_sse(prompt, model_override, config, timeout)
            return
        except Exception as e:
            logger.warning("Sonar stream failed, falling back: %s", e)
    yield from _stream_ai_sse(prompt, model_override, timeout)

def _stream_ai_sse(prompt: str, model_override: str | None, timeout: int):
    """Générateur SSE unifié. Yield des lignes SSE. Fallback Ollama ↔ Sonar."""
    config = _load_ai_config()
    provider = config.get("provider", "ollama")
    fallback = config.get("fallback_enabled", True)
    try:
        yield from _stream_provider_sse(provider, prompt, model_override, config, timeout)
        return
    except Exception as primary_err:
        if not fallback:
            yield f"data: {json.dumps({'type': 'error', 'message': str(primary_err)}, ensure_ascii=False)}\n\n"
            return
        alt = "ollama" if provider == "sonar" else "sonar"
        if alt == "sonar" and not config.get("sonar_api_key"):
            yield f"data: {json.dumps({'type': 'error', 'message': str(primary_err)}, ensure_ascii=False)}\n\n"
            return
        try:
            logger.info("IA stream fallback %s → %s", provider, alt)
            yield f"data: {json.dumps({'type': 'start', 'message': f'Basculement vers {alt}…'}, ensure_ascii=False)}\n\n"
            yield from _stream_provider_sse(alt, prompt, model_override, config, timeout)
        except Exception:
            yield f"data: {json.dumps({'type': 'error', 'message': str(primary_err)}, ensure_ascii=False)}\n\n"

def _stream_provider_sse(provider: str, prompt: str, model_override: str | None, config: dict, timeout: int):
    """Stream SSE pour un provider spécifique."""
    if provider == "sonar":
        yield from _stream_sonar_sse(prompt, model_override, config, timeout)
    else:
        yield from _stream_ollama_sse(prompt, model_override, config, timeout)

def _stream_ollama_sse(prompt: str, model_override: str | None, config: dict, timeout: int):
    """Stream SSE via Ollama."""
    url = config.get("ollama_url", OLLAMA_URL)
    model = model_override or config.get("ollama_model", OLLAMA_MODEL)
    body = json.dumps({"model": model, "prompt": prompt, "stream": True}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/api/generate", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        yield f"data: {json.dumps({'type': 'start', 'message': 'Connexion à Ollama établie'}, ensure_ascii=False)}\n\n"
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

def _stream_sonar_sse(prompt: str, model_override: str | None, config: dict, timeout: int):
    """Stream SSE via Perplexity Sonar (OpenAI-compatible streaming + web search)."""
    api_key = config.get("sonar_api_key", "")
    if not api_key:
        raise ValueError("Clé API Perplexity non configurée")
    model = model_override or config.get("sonar_model", SONAR_MODEL)
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "temperature": 0.3,
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        SONAR_URL, data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        yield f"data: {json.dumps({'type': 'start', 'message': 'Recherche web Sonar en cours…'}, ensure_ascii=False)}\n\n"
        buffer = b""
        for chunk in resp:
            buffer += chunk
            while b"\n" in buffer:
                line_bytes, buffer = buffer.split(b"\n", 1)
                line_str = line_bytes.decode("utf-8", errors="ignore").strip()
                if not line_str:
                    continue
                if not line_str.startswith("data: "):
                    continue
                data_str = line_str[6:]
                if data_str == "[DONE]":
                    yield f"data: {json.dumps({'type': 'end', 'message': 'Recherche terminée'}, ensure_ascii=False)}\n\n"
                    return
                try:
                    data = json.loads(data_str)
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield f"data: {json.dumps({'type': 'token', 'text': content, 'done': False}, ensure_ascii=False)}\n\n"
                except json.JSONDecodeError:
                    continue
    yield f"data: {json.dumps({'type': 'end', 'message': 'Recherche terminée'}, ensure_ascii=False)}\n\n"

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
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "connect-src 'self' https://api.perplexity.ai https://r2cdn.perplexity.ai; "
        "font-src 'self' https://r2cdn.perplexity.ai; "
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

    allowed = ('/login', '/static/', '/favicon.ico', '/api/auth/', '/api/app-version', '/api/system/check-deployment', '/api/system/logs',
               '/api/deploy/health', '/api/deploy/pull-from-404', '/api/deploy/rollback')
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

@app.post("/api/deploy/pull-from-404")
def api_deploy_pull_from_404():
    """Pull Git simple depuis la page 404 (sans auth pour permettre réparation)."""
    chk = _require_same_origin()
    if chk:
        return chk
    
    try:
        # Vérifier que c'est un dépôt git
        cp = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp.returncode != 0:
            return jsonify(ok=False, error="Pas un dépôt git"), 400
        
        # SAFETY: Sauvegarder le commit actuel pour rollback
        cp2 = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        local_hash_full = (cp2.stdout or "").strip() if cp2.returncode == 0 else None
        if local_hash_full:
            try:
                last_commit_file = APP_DIR / ".last_commit_hash"
                last_commit_file.write_text(local_hash_full, encoding="utf-8")
            except Exception:
                pass
        
        # SAFETY: Créer snapshot DB avant mise à jour
        try:
            create_snapshot(label="before_update_404", is_auto=False)
        except Exception:
            pass
        
        # S'assurer d'être sur main
        branch_cp = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=str(APP_DIR), capture_output=True, text=True, timeout=2,
        )
        cur_branch = (branch_cp.stdout or "").strip() if branch_cp.returncode == 0 else ""
        if cur_branch and cur_branch != "main":
            co = subprocess.run(["git", "checkout", "main"],
                                cwd=str(APP_DIR), capture_output=True, text=True, timeout=5)
            if co.returncode != 0:
                subprocess.run(["git", "checkout", "-B", "main", "origin/main"],
                               cwd=str(APP_DIR), capture_output=True, text=True, timeout=5)

        # Fetch
        fetch = subprocess.run(
            ["git", "fetch", "--prune", "origin", "main"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=15,
        )
        if fetch.returncode != 0:
            return jsonify(ok=False, error=f"git fetch échoué: {fetch.stderr or fetch.stdout}"), 500
        
        # Pull (ff-only d'abord, puis reset --hard en fallback)
        pull = subprocess.run(
            ["git", "pull", "--ff-only", "origin", "main"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=30,
        )
        if pull.returncode != 0:
            logger.warning("Deploy pull-from-404: ff-only failed, falling back to git reset --hard origin/main")
            reset = subprocess.run(
                ["git", "reset", "--hard", "origin/main"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=10,
            )
            if reset.returncode != 0:
                return jsonify(ok=False, error=f"git reset --hard échoué: {reset.stderr or reset.stdout}"), 500
        
        logger.info("Deploy pull from 404: mise à jour appliquée, redémarrage dans 5s")
        _schedule_restart(delay=5.0)
        return jsonify(ok=True, message="Mise à jour appliquée. Redémarrage automatique dans 5 s…")
    
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="Timeout lors du pull"), 500
    except Exception as e:
        logger.exception("Deploy pull from 404 error")
        return jsonify(ok=False, error=str(e)), 500


@app.post("/api/deploy/rollback")
def api_deploy_rollback():
    """Rollback vers le commit précédent (sans auth pour permettre réparation depuis 404)."""
    chk = _require_same_origin()
    if chk:
        return chk
    
    try:
        # Vérifier que c'est un dépôt git
        cp = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp.returncode != 0:
            return jsonify(ok=False, error="Pas un dépôt git"), 400
        
        # Lire le hash du commit précédent sauvegardé
        last_commit_file = APP_DIR / ".last_commit_hash"
        if not last_commit_file.exists():
            # Essayer de récupérer le commit précédent via git
            cp2 = subprocess.run(
                ["git", "rev-parse", "HEAD~1"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            if cp2.returncode != 0:
                return jsonify(ok=False, error="Aucun commit précédent trouvé pour rollback"), 400
            rollback_hash = cp2.stdout.strip()
        else:
            rollback_hash = last_commit_file.read_text(encoding="utf-8").strip()
        
        if not rollback_hash:
            return jsonify(ok=False, error="Hash de commit invalide pour rollback"), 400
        
        # Vérifier que le commit existe
        cp3 = subprocess.run(
            ["git", "cat-file", "-e", rollback_hash],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp3.returncode != 0:
            return jsonify(ok=False, error=f"Commit {rollback_hash[:7]} introuvable"), 400
        
        # SAFETY: Créer snapshot DB avant rollback
        try:
            create_snapshot(label="before_rollback", is_auto=False)
        except Exception:
            pass
        
        # Reset hard vers le commit précédent
        reset = subprocess.run(
            ["git", "reset", "--hard", rollback_hash],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if reset.returncode != 0:
            err = (reset.stderr or reset.stdout or "Erreur reset").strip()
            return jsonify(ok=False, error=f"Rollback échoué: {err}"), 500
        
        logger.info("Deploy rollback: retour au commit %s, redémarrage dans 5s", rollback_hash[:7])
        _schedule_restart(delay=5.0)
        return jsonify(ok=True, message=f"Rollback effectué vers {rollback_hash[:7]}. Redémarrage automatique dans 5 s…", commit_hash=rollback_hash[:7])
    
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="Timeout lors du rollback"), 500
    except Exception as e:
        logger.exception("Deploy rollback error")
        return jsonify(ok=False, error=str(e)), 500


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
        return redirect('/dashboard')
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


@app.post("/api/auth/login")
def api_auth_login():
    # Rate limiting (v23.4)
    if _check_login_rate_limit():
        return jsonify(ok=False, error="Trop de tentatives. Réessayez dans quelques minutes."), 429

    payload, err = validate_payload({'username': str, 'password': str})
    if err:
        return err
    username = (payload.get("username") or "").strip().lower()
    password = payload.get("password") or ""
    if not username or not password:
        return jsonify(ok=False, error="Identifiants requis"), 400
    with _auth_conn() as conn:
        user = conn.execute("SELECT * FROM users WHERE LOWER(username)=? AND is_active=1;", (username,)).fetchone()
        # v23.4: constant-time check to prevent timing-based user enumeration
        if user:
            pw_ok = check_password_hash(user["password_hash"], password)
        else:
            # Dummy hash check to keep timing consistent
            check_password_hash("pbkdf2:sha256:600000$dummy$0" * 2, password)
            pw_ok = False
        if not pw_ok:
            _record_login_attempt()
            return jsonify(ok=False, error="Identifiants incorrects"), 401
        session.permanent = True
        session['user_id'] = user['id']
        session['user_role'] = user['role']
        session['user_name'] = user['display_name'] or user['username']
        conn.execute("UPDATE users SET lastLoginAt=? WHERE id=?;",
                     (datetime.datetime.now().isoformat(timespec="seconds"), user['id']))
        must_change = bool(user['must_change_password']) if 'must_change_password' in user.keys() else False
    log_activity('login')
    return jsonify(ok=True, role=user['role'], name=user['display_name'] or user['username'],
                   must_change_password=must_change)

# Utilisateurs créés avant cette date = existants, ne jamais afficher le popup bienvenue
ONBOARDING_CUTOFF_DATE = "2025-03-01"

@app.get("/api/auth/me")
def api_auth_me():
    user = _get_current_user()
    if not user:
        return jsonify(ok=False), 401
    payload = {
        "id": user["id"], "username": user["username"],
        "display_name": user["display_name"], "role": user["role"]
    }
    # Teams prefix (v22.1)
    payload["prefix"] = _get_user_prefix(user["id"])
    seen = user.get("onboarding_seen")
    created = (user.get("createdAt") or "")[:10]
    if seen == 1:
        payload["onboarding_seen"] = 1
    elif seen is None or (seen == 0 and created and created < ONBOARDING_CUTOFF_DATE):
        # Utilisateur existant (créé avant la feature, avec date connue) : forcer à 1 et corriger en base
        try:
            with _auth_conn() as conn:
                conn.execute("UPDATE users SET onboarding_seen=1 WHERE id=?;", (user["id"],))
        except Exception:
            pass
        payload["onboarding_seen"] = 1
    else:
        payload["onboarding_seen"] = 0
    payload["email"] = user.get("email") or ""
    payload["phone"] = user.get("phone") or ""
    avatar = user.get("avatar") or ""
    payload["avatar_url"] = f"/api/auth/avatar/{user['id']}" if avatar else ""
    return jsonify(ok=True, user=payload, version=APP_VERSION)


@app.patch("/api/auth/profile")
@login_required
def api_auth_profile_update():
    """Mise à jour du profil utilisateur : display_name, email, phone (v27.7)."""
    uid = session.get("user_id")
    data = request.get_json(force=True, silent=True) or {}
    display_name = (data.get("display_name") or "").strip()
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()
    if not display_name:
        return jsonify(ok=False, error="Le nom affiché ne peut pas être vide"), 400
    with _auth_conn() as conn:
        conn.execute(
            "UPDATE users SET display_name=?, email=?, phone=? WHERE id=?",
            (display_name, email, phone, uid),
        )
    return jsonify(ok=True, display_name=display_name, email=email, phone=phone)


@app.post("/api/auth/avatar")
@login_required
def api_auth_avatar_upload():
    """Upload de la photo de profil utilisateur (v27.7)."""
    uid = session.get("user_id")
    f = request.files.get("avatar")
    if not f or not f.filename:
        return jsonify(ok=False, error="Aucun fichier fourni"), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return jsonify(ok=False, error="Format non supporté (jpg, png, webp, gif)"), 400
    # Supprimer l'ancien avatar si présent
    for old_ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        old_path = AVATARS_DIR / f"avatar_{uid}{old_ext}"
        if old_path.exists():
            try:
                old_path.unlink()
            except Exception:
                pass
    fname = f"avatar_{uid}{ext}"
    fpath = AVATARS_DIR / fname
    f.save(str(fpath))
    with _auth_conn() as conn:
        conn.execute("UPDATE users SET avatar=? WHERE id=?", (fname, uid))
    return jsonify(ok=True, avatar_url=f"/api/auth/avatar/{uid}")


@app.get("/api/auth/avatar/<int:user_id>")
@login_required
def api_auth_avatar_serve(user_id):
    """Sert la photo de profil d'un utilisateur (v27.7)."""
    from flask import send_file as _send_file
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        fpath = AVATARS_DIR / f"avatar_{user_id}{ext}"
        if fpath.exists():
            return _send_file(str(fpath))
    return jsonify(ok=False, error="Aucun avatar"), 404


@app.post("/api/auth/onboarding-seen")
@login_required
def api_auth_onboarding_seen():
    """Marque la visite guidée / popup bienvenue comme vue pour l'utilisateur connecté."""
    uid = session.get("user_id")
    if not uid:
        return jsonify(ok=False), 401
    with _auth_conn() as conn:
        conn.execute("UPDATE users SET onboarding_seen=1 WHERE id=?;", (uid,))
    return jsonify(ok=True)

@app.post("/api/auth/logout")
def api_auth_logout():
    log_activity('logout')
    session.clear()
    return jsonify(ok=True)

# ── JWT endpoints (v24.0 — mobile app) ─────────────────────────────

@app.post("/api/auth/token")
def api_auth_token():
    """Mobile login: returns JWT access + refresh tokens."""
    if _check_login_rate_limit():
        return jsonify(ok=False, error="Trop de tentatives. Réessayez dans quelques minutes."), 429
    payload = request.get_json(force=True, silent=True) or {}
    username = (payload.get("username") or "").strip().lower()
    password = payload.get("password") or ""
    device = payload.get("device")
    if not username or not password:
        return jsonify(ok=False, error="Identifiants requis"), 400
    with _auth_conn() as conn:
        user = conn.execute("SELECT * FROM users WHERE LOWER(username)=? AND is_active=1;", (username,)).fetchone()
        if user:
            pw_ok = check_password_hash(user["password_hash"], password)
        else:
            check_password_hash("pbkdf2:sha256:600000$dummy$0" * 2, password)
            pw_ok = False
        if not pw_ok:
            _record_login_attempt()
            return jsonify(ok=False, error="Identifiants incorrects"), 401
        user = dict(user)
        conn.execute("UPDATE users SET lastLoginAt=? WHERE id=?;",
                     (datetime.datetime.now().isoformat(timespec="seconds"), user["id"]))
    access = _generate_access_token(user)
    refresh = _generate_refresh_token(user, device)
    return jsonify(ok=True, access_token=access, refresh_token=refresh,
                   expires_in=_JWT_ACCESS_EXPIRY,
                   user={"id": user["id"], "role": user["role"],
                         "name": user.get("display_name") or user["username"]})


@app.post("/api/auth/refresh")
def api_auth_refresh():
    """Renew access token using a valid refresh token."""
    payload = request.get_json(force=True, silent=True) or {}
    raw = payload.get("refresh_token")
    if not raw:
        return jsonify(ok=False, error="refresh_token requis"), 400
    user_id = _verify_refresh_token(raw)
    if not user_id:
        return jsonify(ok=False, error="Token invalide ou expiré"), 401
    with _auth_conn() as conn:
        user = conn.execute("SELECT * FROM users WHERE id=? AND is_active=1;", (user_id,)).fetchone()
    if not user:
        return jsonify(ok=False, error="Utilisateur inactif"), 401
    user = dict(user)
    access = _generate_access_token(user)
    return jsonify(ok=True, access_token=access, expires_in=_JWT_ACCESS_EXPIRY)


@app.post("/api/auth/revoke")
def api_auth_revoke():
    """Revoke a refresh token (mobile logout)."""
    payload = request.get_json(force=True, silent=True) or {}
    raw = payload.get("refresh_token")
    if not raw:
        return jsonify(ok=False, error="refresh_token requis"), 400
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    with _auth_conn() as conn:
        conn.execute("UPDATE refresh_tokens SET revoked=1 WHERE token_hash=?;", (token_hash,))
    return jsonify(ok=True)


@app.post("/api/auth/change-password")
def api_auth_change_password():
    uid = session.get('user_id')
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    old_pw = payload.get("old_password", "")
    new_pw = payload.get("new_password", "")
    if not old_pw or not new_pw:
        return jsonify(ok=False, error="Champs requis"), 400
    if len(new_pw) < 8:
        return jsonify(ok=False, error="Mot de passe trop court (min 8 caractères)"), 400
    if not any(c.isdigit() for c in new_pw):
        return jsonify(ok=False, error="Le mot de passe doit contenir au moins un chiffre"), 400
    if not any(c.isalpha() for c in new_pw):
        return jsonify(ok=False, error="Le mot de passe doit contenir au moins une lettre"), 400
    with _auth_conn() as conn:
        user = conn.execute("SELECT * FROM users WHERE id=?;", (uid,)).fetchone()
        if not user or not check_password_hash(user["password_hash"], old_pw):
            return jsonify(ok=False, error="Ancien mot de passe incorrect"), 401
        conn.execute("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?;",
                     (generate_password_hash(new_pw), uid))
    return jsonify(ok=True)

# ═══════════════════════════════════════════════════════════════════
# User management (admin only)
# ═══════════════════════════════════════════════════════════════════

@app.get("/users")
@login_required
@role_required('admin')
def page_users():
    return render_template("users.html", static_hashes=_static_hashes)

@app.get("/api/users")
@login_required
@role_required('admin')
def api_users_list():
    user = getattr(g, 'user', None) or _get_current_user()
    with _auth_conn() as conn:
        rows = conn.execute("SELECT id, username, display_name, role, is_active, createdAt, lastLoginAt FROM users ORDER BY id;").fetchall()
    is_admin = user and user.get('role') == 'admin'
    current_user_id = int(user["id"]) if user and user.get("id") is not None else None
    return jsonify(ok=True, users=[dict(r) for r in rows], is_admin=is_admin, current_user_id=current_user_id)

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
        
        username = user.get("username") or user.get("display_name") or f"user_{uid}"
        
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
    """Chemin de la DB d'un utilisateur. Retourne la per-user DB si elle existe et n'est pas vide, sinon DB_PATH."""
    user_db = DATA_DIR / f"user_{user_id}" / "prospects.db"
    if user_db.exists():
        try:
            if user_db.stat().st_size > 0:
                return user_db
        except OSError:
            pass
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
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    keywords      TEXT,
    auto_detected INTEGER DEFAULT 0,
    owner_id      INTEGER,
    createdAt     TEXT,
    updatedAt     TEXT,
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
        if "is_contact" not in cols:
            _add_col("prospects", "is_contact", "INTEGER")
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
    v25: candidate_tabs + migration depuis candidate_ec1_checklists."""
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
            if "deleted_at" not in cols:
                conn.execute(f"ALTER TABLE {tbl} ADD COLUMN deleted_at TEXT;")
                conn.commit()
        # Migration: ajouter dossier_competence_pdf à candidates
        try:
            cand_cols = [r["name"] for r in conn.execute("PRAGMA table_info(candidates);").fetchall()]
            if "dossier_competence_pdf" not in cand_cols:
                conn.execute("ALTER TABLE candidates ADD COLUMN dossier_competence_pdf TEXT;")
                conn.commit()
        except Exception:
            pass
        _migrate_candidate_tabs(conn)
    finally:
        conn.close()


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
                is_contact    INTEGER,
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
        d["is_contact"] = int(d.get("is_contact") or 0)
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
                    owner_id=excluded.owner_id
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

            # Quand un statut change via /api/save sans lastContact explicite, forcer la date du jour.
            # Cela permet une reprise mobile plus robuste basée sur le "dernier contact".
            today_iso = _today_iso()
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
                    p["lastContact"] = today_iso
                    continue
                if old_statut and new_statut and old_statut != new_statut and incoming_last == old_last:
                    p["lastContact"] = today_iso

            # Upsert prospects (owner_id forcé à l'utilisateur connecté)
            cur.executemany(
                '''
                INSERT INTO prospects
                (id, name, company_id, fonction, telephone, email, linkedin, pertinence, statut, lastContact, nextFollowUp, priority, notes, callNotes, pushEmailSentAt, tags, template_id, nextAction, pushLinkedInSentAt, photo_url, push_category_id, fixedMetier, rdvDate, is_contact, owner_id)
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
                    is_contact=excluded.is_contact,
                    owner_id=excluded.owner_id
                ;
                ''',
                [
                    (
                        int(p["id"]),
                        str(p.get("name", "")),
                        int(p.get("company_id")),
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
                        p.get("is_contact", 0),
                        int(p.get("owner_id", uid)),
                    )
                    for p in prospects
                ],
            )

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
                                    "📅 RDV pris",
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
                (id, name, company_id, fonction, telephone, email, linkedin, pertinence, statut, lastContact, nextFollowUp, priority, notes, callNotes, pushEmailSentAt, tags, template_id, nextAction, pushLinkedInSentAt, photo_url, push_category_id, fixedMetier, rdvDate, is_contact, owner_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                ''',
                [
                    (
                        int(p["id"]),
                        str(p.get("name", "")),
                        int(p.get("company_id")),
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
                        p.get("is_contact", 0),
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


@app.get("/")
def home():
    return render_template("index.html", static_hashes=_static_hashes)


@app.get("/entreprises")
def page_entreprises():
    return render_template("entreprises.html", static_hashes=_static_hashes)

@app.get("/company")
def page_company():
    return redirect("/entreprises")



@app.get("/parametres")
def page_parametres():
    return render_template("parametres.html", static_hashes=_static_hashes)




@app.get("/sourcing")
def page_sourcing():
    return render_template("sourcing.html", static_hashes=_static_hashes)


@app.get("/candidat")
def page_candidat():
    """Fiche candidat (détail). Utilise le query param ?id=..."""
    return render_template("candidate.html", static_hashes=_static_hashes)


@app.get("/push")
def page_push():
    return render_template("push.html", static_hashes=_static_hashes)

@app.get("/templates")
def page_templates():
    return render_template("templates.html", static_hashes=_static_hashes)



@app.get("/stats")
def page_stats():
    return render_template("stats.html", static_hashes=_static_hashes)


@app.get("/duplicates")
def page_duplicates():
    return render_template("duplicates.html", static_hashes=_static_hashes)


@app.get("/focus")
def page_focus():
    return render_template("focus.html", static_hashes=_static_hashes)


@app.get("/snapshots")
def page_snapshots():
    return render_template("snapshots.html", static_hashes=_static_hashes)


@app.get("/activity")
@login_required
@role_required('admin')
def page_activity():
    """Journal d'activité multi-utilisateurs — admin only (v27.10)."""
    return render_template("activity.html", static_hashes=_static_hashes)


@app.get("/help")
def page_help():
    return render_template("help.html", static_hashes=_static_hashes)


@app.get("/aide")
def page_aide():
    return render_template("help.html", static_hashes=_static_hashes)


@app.get("/metiers")
def page_metiers():
    return render_template("metiers.html", static_hashes=_static_hashes)


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
    "a_sourcer": 0,
    "a_contacter": 1,
    "a_contacter_relance": 2,
    "en_cours": 3,
    "ec1": 4,
    "ec2": 5,
    "ed": 6,
    "interesse": 7,
    "mission": 8,
    "embauche": 9,
    "refuse": -1,
    "archive": -2,
}

_CANDIDATE_CONTACTED_RANK = 3  # en_cours
_CANDIDATE_SOLID_RANK = 4      # ec1


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
        conn.execute(
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
        exp_id = conn.lastrowid
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
        conn.execute(
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
        edu_id = conn.lastrowid
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
        conn.execute(
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
        cert_id = conn.lastrowid
    return jsonify({"ok": True, "id": cert_id})


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
        if cid:
            try:
                r0 = conn.execute("SELECT status FROM candidates WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
                old_status = r0["status"] if r0 else None
            except Exception:
                old_status = None
        if cid:
            cur.execute(
                '''
                UPDATE candidates
                SET name=?, role=?, location=?, seniority=?, tech=?, linkedin=?, source=?, status=?, notes=?,
                    onenote_url=?, vsa_url=?, skills=?, company_ids=?, is_archived=?,
                    years_experience=?, sector=?, phone=?, email=?, dossier_competence_pdf=?,
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
                    _t("dossier_competence_pdf"),
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
                    createdAt, updatedAt, owner_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
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
    is_archived = None
    if st == "archive":
        is_archived = 1
    elif st in ("a_sourcer", "a_contacter", "en_cours", "ec1", "ec2", "ed", "interesse", "mission", "refuse", "embauche"):
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
            "📤 Push candidat",
            [("Candidat", candidate_name), ("Prospect", prospect_name), ("Entreprise", company_name), ("Consultant", prefix), ("Date", event_date)],
            [{"title": "Voir dans Prosp'Up", "url": f"https://prospup.work/candidate?id={cid_i}"}]
        )
        _send_teams_webhook(card, "candidate_push")
    except Exception:
        pass

    return jsonify(ok=True, createdAt=now)


@app.get("/api/candidate-push")
def api_candidate_push_list():
    """Return history of candidate → prospect pushes for a given candidate."""
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
            """
            SELECT date, title, meta, createdAt
            FROM candidate_events
            WHERE candidate_id=? AND type='candidate_push'
            ORDER BY COALESCE(createdAt, date) DESC, id DESC;
            """,
            (int(cid),),
        ).fetchall()

    pushes: list[dict[str, Any]] = []
    for r in rows:
        try:
            meta = json.loads(r["meta"] or "{}")
        except Exception:
            meta = {}
        pushes.append(
            {
                "candidate_id": cid,
                "prospect_id": meta.get("prospect_id"),
                "prospect_name": meta.get("prospect_name"),
                "company_name": meta.get("company_name"),
                "createdAt": r["createdAt"] or r["date"],
                "title": r["title"],
            }
        )

    return jsonify(ok=True, pushes=pushes)


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
        rows = conn.execute("SELECT * FROM push_categories WHERE owner_id=? ORDER BY name;", (uid,)).fetchall()
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

        cid = payload.get("id")
        now = _now_iso()

        with _conn() as conn:
            # S'assurer que la table existe (migration pour DBs existantes)
            try:
                conn.execute("SELECT 1 FROM push_categories LIMIT 1;").fetchone()
            except sqlite3.OperationalError:
                # Table n'existe pas, l'initialiser
                _init_user_db(uid)
            
            if cid:
                # Vérifier que la catégorie appartient à l'utilisateur
                try:
                    existing = conn.execute("SELECT id FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
                    if not existing:
                        return jsonify({"ok": False, "error": "Catégorie non trouvée ou accès refusé"}), 404
                    conn.execute(
                        "UPDATE push_categories SET name=?, keywords=?, updatedAt=? WHERE id=? AND owner_id=?;",
                        (name, keywords_json, now, int(cid), uid)
                    )
                except sqlite3.IntegrityError as e:
                    if "UNIQUE constraint" in str(e):
                        return jsonify({"ok": False, "error": "Une catégorie avec ce nom existe déjà"}), 400
                    raise
            else:
                try:
                    conn.execute(
                        "INSERT INTO push_categories (name, keywords, auto_detected, owner_id, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?, ?);",
                        (name, keywords_json, uid, now, now)
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
    
    # Vérifier l'extension
    allowed_extensions = {'.msg', '.eml', '.oft', '.htm', '.html'}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        return jsonify(ok=False, error=f"Extension non autorisée. Autorisées: {', '.join(allowed_extensions)}"), 400
    
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


@app.post("/api/push/generate")
def api_push_generate():
    """Génère un template rempli ou un ZIP avec template + dossiers de compétences.
    
    Reçoit: {
        "prospect_id": int,
        "category_id": int,
        "template_filename": str,
        "candidate_id1": int (optionnel),
        "candidate_id2": int (optionnel),
        "format": "filled" | "zip" (défaut: "filled")
    }
    
    Retourne: fichier téléchargeable (template rempli ou ZIP)
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    payload = request.get_json(force=True, silent=True) or {}
    template_filename = payload.get("template_filename")
    format_type = payload.get("format", "filled")  # "filled" ou "zip"
    
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
    
    # Récupérer les données du prospect
    with _conn() as conn:
        prospect = conn.execute(
            "SELECT name, email, fonction, company_id FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid)
        ).fetchone()
        if not prospect:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        
        # Récupérer la catégorie
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (category_id, uid)).fetchone()
        if not cat_row:
            return jsonify(ok=False, error="Catégorie introuvable"), 404
        
        # Récupérer les candidats et leurs DC
        candidates_data = []
        for cand_id in [candidate_id1, candidate_id2]:
            if not cand_id:
                continue
            try:
                cand = conn.execute(
                    "SELECT id, name, dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=?;",
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
    
    try:
        if format_type == "filled":
            # Essayer de remplir le template (pour .msg, .eml, .oft)
            # Pour l'instant, on retourne le template tel quel
            # TODO: Implémenter le remplissage avec python-docx, extract_msg, etc.
            return send_file(
                str(template_path),
                mimetype='application/octet-stream',
                as_attachment=True,
                download_name=f"push_{prospect_dict['name']}_{template_filename}"
            )
        else:  # format == "zip"
            # Créer un ZIP avec template + DC
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp_zip:
                zip_path = Path(tmp_zip.name)
            
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                # Ajouter le template
                zipf.write(template_path, template_filename)
                
                # Ajouter les dossiers de compétences
                for i, cand in enumerate(candidates_data, 1):
                    if cand.get("dossier_competence_pdf"):
                        dc_path_str = cand["dossier_competence_pdf"]
                        # Gérer les chemins relatifs et absolus
                        if not os.path.isabs(dc_path_str):
                            # Chemin relatif : chercher dans dossiers_competence
                            dc_path = APP_DIR / "dossiers_competence" / dc_path_str
                        else:
                            dc_path = Path(dc_path_str)
                        
                        if dc_path.is_file():
                            # Vérifier que le fichier est dans un répertoire autorisé
                            try:
                                dc_resolved = dc_path.resolve()
                                allowed_dirs = [
                                    str((APP_DIR / "dossiers_competence").resolve()),
                                    str(DATA_DIR.resolve())
                                ]
                                if any(str(dc_resolved).startswith(d.rstrip(os.sep) + os.sep) for d in allowed_dirs):
                                    # Nettoyer le nom du fichier pour le ZIP
                                    safe_name = "".join(c for c in cand['name'] if c.isalnum() or c in "._- ")
                                    zipf.write(dc_path, f"DC_{safe_name}_{dc_path.name}")
                            except Exception as e:
                                logger.warning("Erreur ajout DC %s: %s", dc_path, e)
            
            # Envoyer le ZIP
            response = send_file(
                str(zip_path),
                mimetype='application/zip',
                as_attachment=True,
                download_name=f"push_{prospect_dict['name']}.zip"
            )
            # Nettoyer le fichier temporaire après envoi (en arrière-plan)
            import threading
            def cleanup():
                time.sleep(5)  # Attendre que le fichier soit envoyé
                try:
                    if zip_path.exists():
                        zip_path.unlink()
                except Exception:
                    pass
            threading.Thread(target=cleanup, daemon=True).start()
            return response
    except Exception as e:
        logger.exception("Erreur génération push")
        return jsonify(ok=False, error=str(e)), 500


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
                WHERE p.owner_id=? AND p.deleted_at IS NULL AND (p.name LIKE ? OR p.email LIKE ? OR p.telephone LIKE ? OR p.linkedin LIKE ? OR p.fonction LIKE ? OR p.notes LIKE ? OR p.callNotes LIKE ?)
                ORDER BY p.id DESC
                LIMIT ? OFFSET ?;
                ''',
                (uid, like, like, like, like, like, like, like, limit, offset),
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

    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    with _conn() as conn:
        p = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (int(pid), uid)).fetchone()
        if not p:
            return jsonify({"ok": False, "error": "prospect not found"}), 404

        # push logs
        logs = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM push_logs WHERE prospect_id=? ORDER BY id DESC LIMIT 80;",
                (int(pid),),
            ).fetchall()
        ]

        # v6: additional events
        try:
            extra = [
                dict(r)
                for r in conn.execute(
                    "SELECT date, type, title, content, meta, createdAt FROM prospect_events WHERE prospect_id=? ORDER BY date DESC, id DESC LIMIT 80;",
                    (int(pid),),
                ).fetchall()
            ]
        except sqlite3.OperationalError as e:
            logger.warning("prospect_events query failed: %s", e)
            extra = []

    events = []

    # callNotes from prospect row
    try:
        call_notes = json.loads((p["callNotes"] or "[]"))
        if isinstance(call_notes, list):
            for n in call_notes:
                d = (n.get("date") if isinstance(n, dict) else "") or ""
                events.append(
                    {
                        "type": "call_note",
                        "date": d,
                        "title": "Note d'appel",
                        "content": (n.get("content") if isinstance(n, dict) else "") or "",
                    }
                )
    except Exception:
        pass

    # extra events
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
            }
        )

    for l in logs:
        events.append(
            {
                "type": "push",
                "date": l.get("sentAt") or l.get("createdAt") or "",
                "title": f"Push ({l.get('channel') or 'email'})",
                "content": l.get("subject") or "",
                "meta": {
                    "to": l.get("to_email"),
                    "template": l.get("template_name"),
                },
            }
        )

    # sort date desc (string ISO)
    def _key(e):
        s = str(e.get("date") or "")
        return s

    events = sorted(events, key=_key, reverse=True)[:120]
    return jsonify({"ok": True, "events": events})


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
        total_prospects = conn.execute("SELECT COUNT(*) AS n FROM prospects WHERE owner_id=?;", (uid,)).fetchone()["n"]
        total_companies = conn.execute("SELECT COUNT(*) AS n FROM companies WHERE owner_id=?;", (uid,)).fetchone()["n"]

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
            "SELECT callNotes FROM prospects WHERE owner_id=? AND callNotes IS NOT NULL AND callNotes != '';",
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
            LEFT JOIN prospects p ON p.company_id=c.id AND p.owner_id=?
            WHERE c.owner_id=?
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
        "activity": {"pushes": pushes, "callNotes": call_notes},
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
        
        # Call notes (période actuelle)
        call_rows = conn.execute(
            "SELECT callNotes FROM prospects WHERE owner_id=? AND callNotes IS NOT NULL AND callNotes != '';",
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
    
    # Récupérer les totaux actuels
    with _conn() as conn:
        total_prospects = conn.execute("SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchone()["n"]
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

    # Validate extension
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return jsonify({"ok": False, "error": "Invalid file type"}), 400

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
        # 1) Status distribution — prospects de l'utilisateur uniquement
        status_rows = conn.execute(
            "SELECT statut, COUNT(*) AS n FROM prospects WHERE owner_id=? GROUP BY statut ORDER BY n DESC;",
            (uid,),
        ).fetchall()
        status_dist = {r["statut"]: r["n"] for r in status_rows}

        # 2) Push activity per week (last 12 weeks)
        weeks = []
        for i in range(11, -1, -1):
            d = today - datetime.timedelta(weeks=i)
            mon = d - datetime.timedelta(days=d.weekday())
            sun = mon + datetime.timedelta(days=6)
            count = conn.execute(
                "SELECT COUNT(*) AS n FROM push_logs l JOIN prospects p ON p.id = l.prospect_id AND p.owner_id=? WHERE substr(l.sentAt,1,10) >= ? AND substr(l.sentAt,1,10) <= ?;",
                (uid, mon.isoformat(), sun.isoformat()),
            ).fetchone()["n"]
            label = f"S{mon.isocalendar()[1]}"
            weeks.append({"label": label, "count": count})

        # 3) RDV won per month (last 6 months) - based on lastContact of RDV prospects
        months_rdv = []
        for i in range(5, -1, -1):
            first = (today.replace(day=1) - datetime.timedelta(days=i * 28)).replace(day=1)
            if first.month == 12:
                last = first.replace(year=first.year + 1, month=1, day=1) - datetime.timedelta(days=1)
            else:
                last = first.replace(month=first.month + 1, day=1) - datetime.timedelta(days=1)
            count = conn.execute(
                "SELECT COUNT(*) AS n FROM prospects WHERE owner_id=? AND statut='Rendez-vous' AND lastContact >= ? AND lastContact <= ?;",
                (uid, first.isoformat(), last.isoformat()),
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

    return jsonify({
        "ok": True,
        "statusDistribution": status_dist,
        "pushPerWeek": weeks,
        "rdvPerMonth": months_rdv,
        "topCompanies": top_comp,
        "pertinenceDistribution": pert_dist,
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
    Format: 17 columns (A-Q) with merged cells for week, thick border on column G, goals in first row.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter
    import io
    import urllib.request
    import urllib.error

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
        # ── 1) Candidats EC1 (entretiens de la semaine) — v25: candidate_tabs type=ec1 ──
        ec1_rows = conn.execute(
            """SELECT ca.id, ca.name, ca.role, ca.sector, ca.seniority, ca.years_experience, ca.status,
                      json_extract(t.payload, '$.interviewAt') AS interviewAt,
                      json_extract(t.payload, '$.data') AS ec1_data
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

        # ── 2) Candidats EC2 (passage à EC2 dans la semaine) ──
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

        # ── 3) Prospections (RDV pris) : prospects avec statut changé vers 'Rendez-vous' dans la semaine ──
        # Détecte via prospect_events rdv_taken OU via changement de statut (lastContact dans la semaine + statut='Rendez-vous')
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

        # ── 4) Clients vus (RDV effectué) : prospects avec réunion dans la semaine ──
        # Détecte via prospect_events type 'meeting' ou 'reunion', ou via lastContact avec statut='Rendez-vous'
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

        # ── 5) Pushs (groupés par candidat) : candidats envoyés et nombre de fois ──
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
        # Grouper par candidat (compter les pushs pour chaque candidat)
        push_by_candidate = {}
        for pl in push_list:
            # Candidat 1
            if pl.get("candidate_id1"):
                cid = pl["candidate_id1"]
                cname = pl.get("candidate1_name") or f"Candidat {cid}"
                push_by_candidate[cid] = push_by_candidate.get(cid, {"name": cname, "count": 0})
                push_by_candidate[cid]["count"] += 1
            # Candidat 2
            if pl.get("candidate_id2"):
                cid = pl["candidate_id2"]
                cname = pl.get("candidate2_name") or f"Candidat {cid}"
                push_by_candidate[cid] = push_by_candidate.get(cid, {"name": cname, "count": 0})
                push_by_candidate[cid]["count"] += 1
        push_consultants = [{"name": v["name"], "count": v["count"]} for v in push_by_candidate.values()]

        # ── 6) Objectifs (Gamification) ──
        goals_cfg = _get_goals_config(conn)
        weekly_goals = goals_cfg.get("weekly", {})
        attendus_prosp = weekly_goals.get("rdv", {}).get("target", 5)
        attendus_entretiens = weekly_goals.get("sourcing_solid", {}).get("target", 3)
        attendus_pushs = weekly_goals.get("push", {}).get("target", 15)

    # ── Enrichissement Ollama (optionnel) ──
    if use_ollama:
        # Normaliser les métiers pour EC1/EC2
        for item in ec1_list + ec2_list:
            metier = item.get("role") or item.get("sector") or ""
            if not metier or len(metier) < 3:
                prompt = f"Normalise ce métier en un nom court et standard (ex: 'Développeur Python', 'Chef de projet IT'): '{metier}'. Réponds uniquement avec le métier normalisé, sans explication."
                normalized = _call_ollama(prompt)
                if normalized:
                    item["_normalized_metier"] = normalized[:50]
                else:
                    item["_normalized_metier"] = metier
            else:
                item["_normalized_metier"] = metier

        # Extraire les besoins depuis les notes des clients vus
        for client in clients_vus_list:
            notes = (client.get("notes") or "") + " " + (client.get("callNotes") or "")
            if notes.strip():
                prompt = f"Extrais les besoins exprimés par ce client depuis ces notes (une ligne par besoin, format court):\n{notes[:500]}\n\nRéponds uniquement avec les besoins, un par ligne, sans explication."
                besoins = _call_ollama(prompt)
                client["_besoins"] = besoins[:200] if besoins else ""
            else:
                client["_besoins"] = ""

        # Générer les codes notes pour EC1
        for ec1 in ec1_list:
            ec1_data_str = ec1.get("ec1_data") or "{}"
            try:
                ec1_data = json.loads(ec1_data_str) if ec1_data_str else {}
            except Exception:
                ec1_data = {}
            # Construire un prompt basé sur les données EC1
            prompt_parts = []
            if ec1.get("role"):
                prompt_parts.append(f"Métier: {ec1['role']}")
            if ec1.get("years_experience"):
                prompt_parts.append(f"Expérience: {ec1['years_experience']} ans")
            if ec1_data:
                prompt_parts.append(f"Données EC1: {json.dumps(ec1_data, ensure_ascii=False)[:200]}")
            if prompt_parts:
                prompt = f"Génère un code note court (ex: 'B OKS', 'A OKS', 'C OKS') pour ce candidat:\n" + "\n".join(prompt_parts) + "\n\nRéponds uniquement avec le code (ex: 'B OKS'), sans explication."
                code = _call_ollama(prompt)
                ec1["_code_note"] = code[:20] if code else ""
            else:
                ec1["_code_note"] = ""

    # ══════════════════════════════════════════════════════
    # Build the XLSX workbook
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

    # ── Headers (17 colonnes A-Q) ──
    headers = [
        "Semaine",           # A
        "Entretiens",        # B
        "Métier",            # C
        "Exp",               # D
        "Dispo",             # E
        "Notes",             # F
        "Commenta",          # G (séparateur visuel avec bordure épaisse)
        "Prospections",      # H
        "Clients vus",       # I
        "Besoins",           # J
        "RT",                # K (vide, réservé)
        "Suivi Mission",     # L (vide, réservé)
        "Pushs consultant",  # M
        "Nb pushs",          # N
        "Attendus Prosp",    # O
        "Attendus Entretiens", # P
        "Attendus Pushs",    # Q
    ]
    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font_white
        cell.fill = header_fill
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center", wrap_text=True)

    # Largeurs de colonnes
    col_widths = [10, 20, 30, 6, 10, 15, 15, 25, 20, 30, 8, 15, 25, 10, 15, 18, 15]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # ── Calculer le nombre total de lignes ──
    total_candidates = len(ec1_list) + len(ec2_list)
    total_prospections = len(prosp_rdv_list)
    total_clients_vus = len(clients_vus_list)
    total_pushs = len(push_consultants)
    # Une ligne par type + une ligne d'objectifs en première ligne de la semaine
    total_rows = max(1, total_candidates + total_prospections + total_clients_vus + total_pushs) + 1

    # ── Ligne d'objectifs (première ligne de données, row 2) ──
    row = 2
    week_start_row = row  # Pour fusionner la colonne A (inclut la ligne d'objectifs)
    ws.cell(row=row, column=1, value=week_label)  # A: Semaine
    ws.cell(row=row, column=15, value=attendus_prosp)  # O: Attendus Prosp
    ws.cell(row=row, column=16, value=attendus_entretiens)  # P: Attendus Entretiens
    ws.cell(row=row, column=17, value=attendus_pushs)  # Q: Attendus Pushs
    # Bordures pour la ligne d'objectifs
    for col in range(1, 18):
        cell = ws.cell(row=row, column=col)
        cell.border = thin_border
    # Bordure épaisse colonne G
    ws.cell(row=row, column=7).border = thick_border

    # ── Lignes candidats EC1/EC2 ──
    current_row = row + 1

    for ec in ec1_list + ec2_list:
        ws.cell(row=current_row, column=1, value=week_label)  # A: Semaine (sera fusionné)
        ws.cell(row=current_row, column=2, value=ec.get("name") or "")  # B: Entretiens (nom candidat)
        # C: Métier
        metier = ec.get("_normalized_metier") if use_ollama else (ec.get("role") or ec.get("sector") or "")
        ws.cell(row=current_row, column=3, value=metier)
        # D: Exp (années d'expérience)
        exp = ec.get("years_experience") or ec.get("seniority") or ""
        try:
            if isinstance(exp, str) and exp.strip():
                # Essayer d'extraire un nombre
                exp_num = re.search(r'\d+', exp)
                if exp_num:
                    exp = int(exp_num.group())
                else:
                    exp = ""
        except Exception:
            pass
        ws.cell(row=current_row, column=4, value=exp)
        # E: Dispo (disponibilité - par défaut "asap" ou depuis les données)
        dispo = "asap"  # Par défaut, peut être enrichi depuis les données EC1
        ws.cell(row=current_row, column=5, value=dispo)
        # F: Notes (codes courts)
        code_note = ec.get("_code_note") if use_ollama else ""
        ws.cell(row=current_row, column=6, value=code_note)
        # G: Commenta (commentaires détaillés) + bordure épaisse
        # Pour EC1, utiliser les données de la checklist ; pour EC2, utiliser les notes du candidat
        if "ec1_data" in ec:
            ec1_data_str = ec.get("ec1_data") or "{}"
            try:
                ec1_data = json.loads(ec1_data_str) if ec1_data_str else {}
                commenta = json.dumps(ec1_data, ensure_ascii=False)[:500] if ec1_data else ""
            except Exception:
                commenta = ""
        else:
            # EC2 : utiliser les notes du candidat
            commenta = ec.get("notes", "")[:500] if ec.get("notes") else ""
        ws.cell(row=current_row, column=7, value=commenta)
        cell_g = ws.cell(row=current_row, column=7)
        cell_g.border = thick_border  # Bordure épaisse pour séparateur visuel
        # Bordures pour les autres colonnes
        for col in [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]:
            ws.cell(row=current_row, column=col).border = thin_border
        current_row += 1

    # ── Lignes prospections (RDV pris) ──
    for prosp in prosp_rdv_list:
        ws.cell(row=current_row, column=1, value=week_label)  # A: Semaine
        # H: Prospections (nom prospect - RDV pris)
        prosp_text = f"{prosp.get('prospect_name', '')} - {prosp.get('company_name', '')}"
        ws.cell(row=current_row, column=8, value=prosp_text)
        # Bordures
        for col in range(1, 18):
            ws.cell(row=current_row, column=col).border = thin_border
        # Bordure épaisse colonne G
        ws.cell(row=current_row, column=7).border = thick_border
        current_row += 1

    # ── Lignes clients vus (RDV effectué) ──
    for client in clients_vus_list:
        ws.cell(row=current_row, column=1, value=week_label)  # A: Semaine
        # I: Clients vus (nom prospect - RDV effectué)
        client_text = f"{client.get('prospect_name', '')} - {client.get('company_name', '')}"
        ws.cell(row=current_row, column=9, value=client_text)
        # J: Besoins (extraits depuis notes)
        besoins = client.get("_besoins") if use_ollama else ""
        if not besoins:
            # Fallback: extraire manuellement depuis notes
            notes = (client.get("notes") or "") + " " + (client.get("callNotes") or "")
            besoins = notes[:200] if notes.strip() else ""
        ws.cell(row=current_row, column=10, value=besoins)
        # Bordures
        for col in range(1, 18):
            ws.cell(row=current_row, column=col).border = thin_border
        # Bordure épaisse colonne G
        ws.cell(row=current_row, column=7).border = thick_border
        current_row += 1

    # ── Lignes pushs (par candidat) ──
    for push_candidate in push_consultants:
        ws.cell(row=current_row, column=1, value=week_label)  # A: Semaine
        # M: Pushs consultant (nom candidat + nombre de fois)
        candidate_name = push_candidate.get("name", "")
        candidate_count = push_candidate.get("count", 0)
        ws.cell(row=current_row, column=13, value=f"{candidate_name} ({candidate_count}x)")
        # N: Nb pushs (nombre)
        ws.cell(row=current_row, column=14, value=candidate_count)
        # Bordures
        for col in range(1, 18):
            ws.cell(row=current_row, column=col).border = thin_border
        # Bordure épaisse colonne G
        ws.cell(row=current_row, column=7).border = thick_border
        current_row += 1

    # ── Fusionner les cellules "Semaine" (colonne A) pour chaque groupe de lignes de la même semaine ──
    week_end_row = current_row - 1
    if week_end_row > week_start_row:
        ws.merge_cells(f'A{week_start_row}:A{week_end_row}')

    # ── Alignement et wrap text ──
    for r in range(2, current_row):
        ws.cell(row=r, column=3).alignment = Alignment(wrap_text=True, vertical="top")  # Métier
        ws.cell(row=r, column=7).alignment = Alignment(wrap_text=True, vertical="top")  # Commenta
        ws.cell(row=r, column=10).alignment = Alignment(wrap_text=True, vertical="top")  # Besoins
        ws.cell(row=r, column=13).alignment = Alignment(wrap_text=True, vertical="top")  # Pushs consultant

    # ── Stream the file ──
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


@app.get("/api/duplicates")
def api_duplicates():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    min_score = request.args.get("min_score", type=float)
    if min_score is None or min_score < 0 or min_score > 1:
        min_score = 0.7
    with _conn() as conn:
        pros = [dict(r) for r in conn.execute(
            "SELECT id, name, email, telephone, linkedin, company_id, COALESCE(is_contact,0) AS is_contact FROM prospects WHERE owner_id=?;", (uid,)
        ).fetchall()]
        comps = {r["id"]: dict(r) for r in conn.execute("SELECT id, groupe, site FROM companies WHERE owner_id=?;", (uid,)).fetchall()}

    pros_for_dup = [p for p in pros if not p.get("is_contact")]
    groups = []

    def add_group(kind: str, key: str, ids: List[int], score: float | None = None):
        if len(ids) < 2:
            return
        items = []
        for pid in ids:
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
            n1 = _name_key_for_duplicate(p1.get("name") or "")
            if not n1:
                continue
            for p2 in company_pros[i + 1 :]:
                n2 = _name_key_for_duplicate(p2.get("name") or "")
                if not n2:
                    continue
                ratio = difflib.SequenceMatcher(None, n1, n2).ratio()
                if ratio >= min_score:
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
                min_score = 0.7
        except (TypeError, ValueError):
            min_score = 0.7
    else:
        min_score = 0.7

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
                n1 = _name_key_for_duplicate(inc.get("name") or "")
                if n1:
                    for p in by_company[cid]:
                        n2 = _name_key_for_duplicate(p.get("name") or "")
                        if n2 and difflib.SequenceMatcher(None, n1, n2).ratio() >= min_score:
                            existing_id = p["id"]
                            reason = "name_company"
                            break
        if existing_id is not None and reason:
            duplicate_indexes.append({"index": idx, "existing_id": existing_id, "reason": reason})

    return jsonify({"ok": True, "duplicate_indexes": duplicate_indexes})


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


@app.post("/api/candidates/import_linkedin_csv")
def api_import_linkedin_csv():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "file is required"}), 400
    f = request.files["file"]
    content = f.read()
    try:
        text = content.decode("utf-8-sig")
    except Exception:
        text = content.decode("latin-1", errors="ignore")

    import io
    reader = csv.DictReader(io.StringIO(text))
    now = _now_iso()
    inserted = 0

    def get_any(row, keys):
        for k in keys:
            if k in row and row[k]:
                return str(row[k]).strip()
        return ""

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cur = conn.cursor()
        for row in reader:
            first = get_any(row, ["First Name", "FirstName", "Prénom", "Prenom"])
            last = get_any(row, ["Last Name", "LastName", "Nom"])
            name = (first + " " + last).strip() or get_any(row, ["Name", "Full Name", "Nom complet"])
            if not name:
                continue
            role = get_any(row, ["Position", "Title", "Rôle", "Role"])
            location = get_any(row, ["Location", "Localisation", "City"])
            linkedin = get_any(row, ["URL", "LinkedIn URL", "LinkedIn", "Profil", "Profile URL"])
            company = get_any(row, ["Company", "Entreprise"])
            notes = get_any(row, ["Notes", "Comment", "Commentaires"])
            if company and notes:
                notes = f"{company}\n{notes}"
            elif company and not notes:
                notes = company

            cur.execute(
                '''
                INSERT INTO candidates (name, role, location, seniority, tech, linkedin, source, status, notes, createdAt, updatedAt, owner_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                ''',
                (
                    name,
                    role or None,
                    location or None,
                    None,
                    None,
                    linkedin or None,
                    "linkedin_csv",
                    "a_sourcer",
                    notes or None,
                    now,
                    now,
                    uid,
                ),
            )
            inserted += 1

    return jsonify({"ok": True, "inserted": inserted})

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
    return jsonify([dict(r) for r in rows])


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
                    "📝 Nouvelle tâche",
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
    last_contact = (payload.get("lastContact") or _today_iso()).strip()
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
                "✅ Compte-rendu",
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
    title = f"🤖 Enrichissement IA — {field_count} champ(s)"
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
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".pdf", ".doc", ".docx"):
        return jsonify(ok=False, error="Format non supporté. Utilisez PDF ou Word (.doc/.docx)."), 400

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
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".pdf", ".doc", ".docx"):
        return Response(_sse_message("error", {"message": "Format non supporté. Utilisez PDF ou Word."}), status=400, mimetype="text/event-stream")

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


@app.post("/api/ollama/generate")
def api_ollama_generate():
    """Proxy IA unifié (non-streaming) : route vers le provider configuré (Ollama/Groq) avec fallback."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    prompt = payload.get("prompt")
    req_timeout = payload.get("timeout")
    if req_timeout is not None:
        try:
            req_timeout = min(600, max(30, int(req_timeout)))
        except (TypeError, ValueError):
            req_timeout = OLLAMA_TIMEOUT
    else:
        req_timeout = OLLAMA_TIMEOUT
    if not prompt:
        return jsonify(ok=False, error="prompt requis"), 400
    web_search = payload.get("web_search", False)
    try:
        text = _call_ai_web(prompt, timeout=req_timeout) if web_search else _call_ai(prompt, timeout=req_timeout)
        return jsonify(ok=True, text=text)
    except urllib.error.HTTPError as e:
        try:
            err_body = ""
            try:
                if e.fp:
                    err_body = e.read().decode("utf-8")
            except Exception:
                pass
            err_data = json.loads(err_body) if err_body else {}
            msg = err_data.get("error", err_body) or str(e)
        except Exception:
            msg = str(e)
        logger.warning("AI HTTP error %s: %s", e.code, msg)
        return jsonify(ok=False, error=msg), 502
    except urllib.error.URLError as e:
        config = _load_ai_config()
        provider = config.get("provider", "ollama")
        label = {"ollama": "Ollama", "groq": "Groq", "sonar": "Sonar"}.get(provider, provider)
        logger.warning("%s unreachable: %s", label, e)
        return jsonify(ok=False, error=f"{label} indisponible (vérifiez la configuration dans Paramètres)"), 503
    except Exception as e:
        logger.exception("AI generate failed")
        return jsonify(ok=False, error=str(e)), 503


@app.post("/api/ollama/generate-stream")
def api_ollama_generate_stream():
    """Proxy IA unifié avec streaming SSE : route vers le provider configuré (Ollama/Groq) avec fallback."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    prompt = payload.get("prompt")
    model = payload.get("model")
    req_timeout = payload.get("timeout")
    if req_timeout is not None:
        try:
            req_timeout = min(600, max(30, int(req_timeout)))
        except (TypeError, ValueError):
            req_timeout = OLLAMA_TIMEOUT
    else:
        req_timeout = OLLAMA_TIMEOUT
    if not prompt:
        return jsonify(ok=False, error="prompt requis"), 400
    web_search = payload.get("web_search", False)
    stream_fn = _stream_ai_web_sse if web_search else _stream_ai_sse

    return Response(
        stream_fn(prompt, model, req_timeout),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ═══════════════════════════════════════════════════════════════════
# v26.3: API de configuration IA multi-provider
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/ai/config")
def api_ai_config_get():
    """Retourne la config IA courante (provider, modèles, statut). Masque les clés API."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    config = _load_ai_config()
    sonar_key = config.get("sonar_api_key", "")
    return jsonify(ok=True, config={
        "provider": config.get("provider", "ollama"),
        "fallback_enabled": config.get("fallback_enabled", True),
        "ollama_url": config.get("ollama_url", OLLAMA_URL),
        "ollama_model": config.get("ollama_model", OLLAMA_MODEL),
        "sonar_model": config.get("sonar_model", SONAR_MODEL),
        "sonar_api_key_set": bool(sonar_key),
        "sonar_api_key_preview": (sonar_key[:8] + "…") if len(sonar_key) > 8 else ("••••" if sonar_key else ""),
    })

@app.post("/api/ai/config")
def api_ai_config_post():
    """Met à jour la config IA. Admin uniquement."""
    user = _get_current_user()
    if not user:
        return jsonify(ok=False, error="Non authentifié"), 401
    if user.get("role") != "admin":
        return jsonify(ok=False, error="Réservé aux administrateurs"), 403
    payload = request.get_json(force=True, silent=True) or {}
    config = _load_ai_config()
    if "provider" in payload and payload["provider"] in ("ollama", "sonar"):
        config["provider"] = payload["provider"]
    if "fallback_enabled" in payload:
        config["fallback_enabled"] = bool(payload["fallback_enabled"])
    if "ollama_url" in payload:
        config["ollama_url"] = str(payload["ollama_url"]).strip().rstrip("/") or OLLAMA_URL
    if "ollama_model" in payload:
        config["ollama_model"] = str(payload["ollama_model"]).strip() or OLLAMA_MODEL
    if "sonar_api_key" in payload:
        config["sonar_api_key"] = str(payload["sonar_api_key"]).strip()
    if "sonar_model" in payload:
        config["sonar_model"] = str(payload["sonar_model"]).strip() or SONAR_MODEL
    _save_ai_config(config)
    logger.info("AI config updated by user %s: provider=%s", user.get("id"), config.get("provider"))
    return jsonify(ok=True)

@app.post("/api/ai/test")
def api_ai_test():
    """Teste la connexion au provider IA configuré."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    global _ai_config_cache
    _ai_config_cache = None
    payload = request.get_json(force=True, silent=True) or {}
    provider = payload.get("provider")
    config = _load_ai_config()
    if provider:
        config = dict(config)
        config["provider"] = provider
        if payload.get("ollama_url"):
            config["ollama_url"] = payload["ollama_url"]
        if payload.get("ollama_model"):
            config["ollama_model"] = payload["ollama_model"]
        if payload.get("sonar_api_key"):
            config["sonar_api_key"] = payload["sonar_api_key"]
        if payload.get("sonar_model"):
            config["sonar_model"] = payload["sonar_model"]
    test_provider = config.get("provider", "ollama")
    label = "Sonar" if test_provider == "sonar" else "Ollama"
    if test_provider == "sonar" and not config.get("sonar_api_key"):
        return jsonify(ok=False, error=f"Clé API {label} non configurée. Enregistrez d'abord la configuration."), 400
    test_prompt = "Réponds uniquement par le mot OK."
    try:
        text = _call_ai_provider(test_provider, test_prompt, config, timeout=15)
        model = config.get("sonar_model") if test_provider == "sonar" else config.get("ollama_model")
        return jsonify(ok=True, provider=test_provider, model=model, response=text.strip()[:200])
    except urllib.error.HTTPError as e:
        try:
            err_body = ""
            try:
                if e.fp:
                    err_body = e.read().decode("utf-8")
            except Exception:
                pass
            err_data = json.loads(err_body) if err_body else {}
            if isinstance(err_data.get("error"), dict):
                msg = err_data["error"].get("message", "") or str(e)
            else:
                msg = err_data.get("error", "") or str(e)
        except Exception:
            msg = str(e)
        if e.code in (401, 403):
            msg = f"Clé API {label} invalide ou expirée (HTTP {e.code}). Vérifiez-la sur le site du provider."
        logger.warning("AI test %s HTTP %s: %s", label, e.code, msg)
        return jsonify(ok=False, error=msg), 200
    except urllib.error.URLError as e:
        return jsonify(ok=False, error=f"{label} injoignable. Vérifiez que le service tourne."), 200
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 200

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


@app.post("/api/deploy/pull")
@login_required
@role_required('admin')
def api_deploy_pull():
    """Streaming git pull depuis origin/main puis redémarrage (admin uniquement). Réponse SSE."""
    chk = _require_same_origin()
    if chk:
        return chk

    def generate():
        try:
            cp = subprocess.run(
                ["git", "rev-parse", "--git-dir"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            if cp.returncode != 0:
                yield f"data: {json.dumps({'step': 'error', 'error': 'Pas un dépôt git'}, ensure_ascii=False)}\n\n"
                return

            yield f"data: {json.dumps({'step': 'fetch', 'message': 'git fetch --prune origin main...'}, ensure_ascii=False)}\n\n"
            fetch = subprocess.run(
                ["git", "fetch", "--prune", "origin", "main"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=15,
            )
            if fetch.returncode != 0:
                err = (fetch.stderr or fetch.stdout or "Erreur inconnue").strip()
                yield f"data: {json.dumps({'step': 'error', 'error': f'git fetch échoué: {err}'}, ensure_ascii=False)}\n\n"
                return
            if fetch.stdout:
                for line in fetch.stdout.strip().splitlines():
                    if line.strip():
                        yield f"data: {json.dumps({'step': 'log', 'line': line.strip()}, ensure_ascii=False)}\n\n"
            if fetch.stderr:
                for line in fetch.stderr.strip().splitlines():
                    if line.strip():
                        yield f"data: {json.dumps({'step': 'log', 'line': line.strip()}, ensure_ascii=False)}\n\n"

            cp2 = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            local_hash = (cp2.stdout or "").strip()[:7] if cp2.returncode == 0 else "unknown"
            local_hash_full = (cp2.stdout or "").strip() if cp2.returncode == 0 else "unknown"
            cp3 = subprocess.run(
                ["git", "rev-parse", "origin/main"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            remote_hash = (cp3.stdout or "").strip()[:7] if cp3.returncode == 0 else "unknown"
            remote_hash_full = (cp3.stdout or "").strip() if cp3.returncode == 0 else "unknown"

            if local_hash == remote_hash:
                yield f"data: {json.dumps({'step': 'done', 'updated': False, 'restarting': False, 'local_hash': local_hash, 'remote_hash': remote_hash, 'message': 'Déjà à jour'}, ensure_ascii=False)}\n\n"
                return

            # ═══════════════════════════════════════════════════════════════════
            # SAFETY: Sauvegarder le commit actuel pour rollback possible
            # ═══════════════════════════════════════════════════════════════════
            if local_hash_full != "unknown":
                try:
                    last_commit_file = APP_DIR / ".last_commit_hash"
                    last_commit_file.write_text(local_hash_full, encoding="utf-8")
                    yield f"data: {json.dumps({'step': 'log', 'line': f'✅ Commit actuel sauvegardé ({local_hash}) pour rollback possible'}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    logger.warning("Failed to save last commit hash: %s", e)

            # ═══════════════════════════════════════════════════════════════════
            # SAFETY: Créer un snapshot DB automatique avant mise à jour
            # ═══════════════════════════════════════════════════════════════════
            try:
                yield f"data: {json.dumps({'step': 'log', 'line': '💾 Création snapshot DB automatique avant mise à jour...'}, ensure_ascii=False)}\n\n"
                snapshot_file = create_snapshot(label="before_update", is_auto=False)
                yield f"data: {json.dumps({'step': 'log', 'line': f'✅ Snapshot créé: {snapshot_file}'}, ensure_ascii=False)}\n\n"
            except Exception as e:
                logger.warning("Failed to create snapshot before update: %s", e)
                yield f"data: {json.dumps({'step': 'log', 'line': f'⚠️ Impossible de créer snapshot: {e}'}, ensure_ascii=False)}\n\n"

            # Fichiers sous logs/ souvent verrouillés par l'app : on les ignore pour le pull
            log_paths = []
            ls_logs = subprocess.run(
                ["git", "ls-files", "logs/"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=5,
            )
            if ls_logs.returncode == 0 and ls_logs.stdout.strip():
                for p in ls_logs.stdout.strip().splitlines():
                    p = p.strip()
                    if p:
                        log_paths.append(p)
                for p in log_paths:
                    subprocess.run(
                        ["git", "update-index", "--assume-unchanged", p],
                        cwd=str(APP_DIR),
                        capture_output=True,
                        timeout=5,
                    )
                if log_paths:
                    yield f"data: {json.dumps({'step': 'log', 'line': 'Fichiers logs/ ignorés pour le pull (évite fichiers verrouillés)'}, ensure_ascii=False)}\n\n"

            status = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=5,
            )
            has_local_changes = status.returncode == 0 and bool(status.stdout.strip())
            if has_local_changes:
                yield f"data: {json.dumps({'step': 'log', 'line': 'Modifications locales détectées, stash...'}, ensure_ascii=False)}\n\n"
                stash = subprocess.run(
                    ["git", "stash", "push", "-m", f"Auto-stash avant pull {remote_hash}"],
                    cwd=str(APP_DIR),
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if stash.returncode != 0:
                    err = (stash.stderr or stash.stdout or "Erreur stash").strip()
                    yield f"data: {json.dumps({'step': 'error', 'error': f'Impossible de stasher: {err}'}, ensure_ascii=False)}\n\n"
                    # Restaurer assume-unchanged avant de quitter
                    for p in log_paths:
                        subprocess.run(
                            ["git", "update-index", "--no-assume-unchanged", p],
                            cwd=str(APP_DIR),
                            capture_output=True,
                            timeout=5,
                        )
                    return

            # ═══════════════════════════════════════════════════════════════════
            # S'assurer d'être sur la branche main
            # ═══════════════════════════════════════════════════════════════════
            branch_cp = subprocess.run(
                ["git", "branch", "--show-current"],
                cwd=str(APP_DIR), capture_output=True, text=True, timeout=2,
            )
            cur_branch = (branch_cp.stdout or "").strip() if branch_cp.returncode == 0 else ""
            if cur_branch and cur_branch != "main":
                yield f"data: {json.dumps({'step': 'log', 'line': f'⚠️ Branche actuelle: {cur_branch} → checkout main'}, ensure_ascii=False)}\n\n"
                co = subprocess.run(
                    ["git", "checkout", "main"],
                    cwd=str(APP_DIR), capture_output=True, text=True, timeout=5,
                )
                if co.returncode != 0:
                    subprocess.run(["git", "checkout", "-B", "main", "origin/main"],
                                   cwd=str(APP_DIR), capture_output=True, text=True, timeout=5)

            yield f"data: {json.dumps({'step': 'pull', 'message': 'git pull --ff-only origin main...'}, ensure_ascii=False)}\n\n"
            pull = subprocess.run(
                ["git", "pull", "--ff-only", "origin", "main"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=15,
            )
            if pull.stdout:
                for line in pull.stdout.strip().splitlines():
                    if line.strip():
                        yield f"data: {json.dumps({'step': 'log', 'line': line.strip()}, ensure_ascii=False)}\n\n"
            if pull.stderr:
                for line in pull.stderr.strip().splitlines():
                    if line.strip():
                        yield f"data: {json.dumps({'step': 'log', 'line': line.strip()}, ensure_ascii=False)}\n\n"
            if pull.returncode != 0:
                yield f"data: {json.dumps({'step': 'log', 'line': '⚠️ Fast-forward impossible — forçage sync sur origin/main (git reset --hard)...'}, ensure_ascii=False)}\n\n"
                logger.warning("Deploy pull: ff-only failed, falling back to git reset --hard origin/main")
                reset = subprocess.run(
                    ["git", "reset", "--hard", "origin/main"],
                    cwd=str(APP_DIR),
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if reset.returncode != 0:
                    err = (reset.stderr or reset.stdout or "Erreur reset").strip()
                    yield f"data: {json.dumps({'step': 'error', 'error': f'git reset --hard échoué: {err}'}, ensure_ascii=False)}\n\n"
                    for p in log_paths:
                        subprocess.run(
                            ["git", "update-index", "--no-assume-unchanged", p],
                            cwd=str(APP_DIR), capture_output=True, timeout=5,
                        )
                    return
                yield f"data: {json.dumps({'step': 'log', 'line': '✅ Synchronisation forcée sur origin/main réussie'}, ensure_ascii=False)}\n\n"

            for p in log_paths:
                subprocess.run(
                    ["git", "update-index", "--no-assume-unchanged", p],
                    cwd=str(APP_DIR),
                    capture_output=True,
                    timeout=5,
                )

            # ═══════════════════════════════════════════════════════════════════
            # SAFETY: Sauvegarder le nouveau hash après pull réussi
            # ═══════════════════════════════════════════════════════════════════
            cp4 = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            new_hash_full = (cp4.stdout or "").strip() if cp4.returncode == 0 else None
            if new_hash_full:
                try:
                    last_commit_file = APP_DIR / ".last_commit_hash"
                    last_commit_file.write_text(new_hash_full, encoding="utf-8")
                except Exception:
                    pass

            # ═══════════════════════════════════════════════════════════════════
            # SAFETY: Installer les nouvelles dépendances avant le redémarrage
            # ═══════════════════════════════════════════════════════════════════
            req_file = APP_DIR / "requirements.txt"
            if req_file.exists():
                yield f"data: {json.dumps({'step': 'log', 'line': '📦 Installation des dépendances (pip install)...'}, ensure_ascii=False)}\n\n"
                try:
                    pip_result = subprocess.run(
                        [sys.executable, "-m", "pip", "install", "-r", str(req_file),
                         "--quiet", "--no-warn-script-location"],
                        cwd=str(APP_DIR),
                        capture_output=True,
                        text=True,
                        timeout=120,
                    )
                    if pip_result.returncode == 0:
                        yield f"data: {json.dumps({'step': 'log', 'line': '✅ Dépendances à jour'}, ensure_ascii=False)}\n\n"
                    else:
                        err_pip = (pip_result.stderr or pip_result.stdout or "").strip()[:300]
                        yield f"data: {json.dumps({'step': 'log', 'line': f'⚠️ pip install partiel (app redémarre quand même): {err_pip}'}, ensure_ascii=False)}\n\n"
                        logger.warning("Deploy pull: pip install partiel: %s", err_pip)
                except subprocess.TimeoutExpired:
                    yield f"data: {json.dumps({'step': 'log', 'line': '⚠️ pip install timeout — redémarrage quand même'}, ensure_ascii=False)}\n\n"
                    logger.warning("Deploy pull: pip install timeout")
                except Exception as e_pip:
                    yield f"data: {json.dumps({'step': 'log', 'line': f'⚠️ pip install erreur: {e_pip}'}, ensure_ascii=False)}\n\n"
                    logger.warning("Deploy pull: pip install erreur: %s", e_pip)

            logger.info("Deploy pull: mise à jour appliquée, redémarrage demandé")
            _schedule_restart(delay=10.0)
            yield f"data: {json.dumps({'step': 'done', 'updated': True, 'restarting': True, 'local_hash': local_hash, 'remote_hash': remote_hash, 'message': 'Mise à jour appliquée, redémarrage dans 10 s', 'restart_delay_s': 10}, ensure_ascii=False)}\n\n"
        except subprocess.TimeoutExpired:
            yield f"data: {json.dumps({'step': 'error', 'error': 'Timeout lors du pull'}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.exception("Deploy pull error")
            yield f"data: {json.dumps({'step': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/deploy/restart")
@login_required
@role_required('admin')
def api_deploy_restart():
    """Redémarre le serveur sans faire de pull (admin uniquement)."""
    try:
        logger.info("Restart demandé par admin (sans pull)")
        _schedule_restart(delay=5.0)
        return jsonify(ok=True, message="Redémarrage programmé dans 5 secondes")
    except Exception as e:
        logger.error("Erreur lors du redémarrage: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@app.get("/api/deploy/health")
def api_deploy_health():
    """Health check simple pour vérifier que l'app répond (accessible sans auth pour 404)."""
    try:
        # Vérifier que l'app peut répondre
        cp = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        current_hash = (cp.stdout or "").strip()[:7] if cp.returncode == 0 else "unknown"
        
        # Vérifier si un rollback est possible
        last_commit_file = APP_DIR / ".last_commit_hash"
        can_rollback = last_commit_file.exists()
        rollback_hash = None
        if can_rollback:
            try:
                rollback_hash = last_commit_file.read_text(encoding="utf-8").strip()[:7]
            except Exception:
                can_rollback = False
        
        return jsonify(ok=True, current_hash=current_hash, can_rollback=can_rollback, rollback_hash=rollback_hash)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


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
            d["is_contact"] = int(d.get("is_contact") or 0)
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
    # Déjà au bon format (contient des étoiles)
    if "⭐" in s:
        return s
    mapping = {
        "À contacter": "Pas d'actions",
        "A contacter": "Pas d'actions",
        "Appelé": "Appelé",
        "📞 Appelé": "Appelé",
        "A rappeler": "À rappeler",
        "À rappeler": "À rappeler",
        "📞 A rappeler": "À rappeler",
        "📞 À rappeler": "À rappeler",
        "Rendez-vous": "Rendez-vous",
        "🤝 Rendez-vous": "Rendez-vous",
        "Prospecté": "Prospecté",
        "🎯 Prospecté": "Prospecté",
        "Messagerie": "Messagerie",
        "💬 Messagerie": "Messagerie",
        "Pas intéressé": "Pas intéressé",
        "Pas interesse": "Pas intéressé",
        "❌ Pas intéressé": "Pas intéressé",
    }
    return mapping.get(s, s)

def _excel_map_statut(val: str | None) -> str | None:
    if not val:
        return None
    s = str(val).strip()
    # Normaliser vers les libellés "simples" (sans emojis) utilisés dans l'UI.
    mapping = {
        "À contacter": "Pas d'actions",
        "A contacter": "Pas d'actions",
        "□ Pas d'actions": "Pas d'actions",

        "Appelé": "Appelé",
        "📞 Appelé": "Appelé",

        "A rappeler": "À rappeler",
        "À rappeler": "À rappeler",
        "📞 A rappeler": "À rappeler",
        "📞 À rappeler": "À rappeler",

        "Rendez-vous": "Rendez-vous",
        "🤝 Rendez-vous": "Rendez-vous",


        "Prospecté": "Prospecté",
        "🎯 Prospecté": "Prospecté",

        "Messagerie": "Messagerie",
        "💬 Messagerie": "Messagerie",

        "Pas intéressé": "Pas intéressé",
        "Pas interesse": "Pas intéressé",
        "❌ Pas intéressé": "Pas intéressé",
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

    contacts_today = [p for p in prospects if (p.get("lastContact") or "").strip() == date_str]
    notes_today = [n for n in all_notes if (n.get("date") or "")[:10] == date_str]
    push_today = [pl for pl in push_logs if (pl.get("sentAt") or "")[:10] == date_str]
    overdue = [p for p in prospects if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < date_str]
    due_today = [p for p in prospects if (p.get("nextFollowUp") or "").strip() == date_str]

    recap = {
        "date": date_str,
        "contacts_count": len(contacts_today),
        "contacts": [{"id": p["id"], "name": p.get("name"), "company_id": p.get("company_id")} for p in contacts_today],
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
    return render_template("rapport.html", static_hashes=_static_hashes)


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

    # Parse call notes
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

    week_notes = [n for n in all_notes if start <= (n.get("date") or "")[:10] <= end]
    week_push = [pl for pl in push_logs if start <= (pl.get("sentAt") or "")[:10] <= end]
    week_contacts = [p for p in prospects if start <= (p.get("lastContact") or "") <= end]

    push_email = sum(1 for pl in week_push if pl.get("channel") == "email")
    push_linkedin = sum(1 for pl in week_push if pl.get("channel") == "linkedin")

    # Status snapshot
    statuts = {}
    for p in prospects:
        s = p.get("statut") or "Inconnu"
        statuts[s] = statuts.get(s, 0) + 1

    rdv_count = statuts.get("Rendez-vous", 0)
    total = len(prospects)

    # Overdue
    overdue = [p for p in prospects if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < today]

    # New contacts this week (lastContact in range AND not before)
    new_contacts_count = len(week_contacts)

    # Companies touched this week
    week_company_ids = set()
    for n in week_notes:
        cid = n.get("_company_id")
        if cid:
            week_company_ids.add(cid)
    for pl in week_push:
        pid = pl.get("prospect_id")
        p = next((x for x in prospects if x["id"] == pid), None)
        if p:
            week_company_ids.add(p.get("company_id"))
    companies_map = {c["id"]: c for c in companies}
    touched_companies = [
        (companies_map.get(cid, {}).get("groupe") or companies_map.get(cid, {}).get("site") or f"ID {cid}")
        for cid in week_company_ids if cid
    ]

    # Activity detail
    notes_detail = [{
        "name": n.get("_pname", ""),
        "statut": n.get("_statut", ""),
        "content": (n.get("content") or "")[:150],
        "date": n.get("date", ""),
    } for n in sorted(week_notes, key=lambda x: x.get("date", ""))]

    push_detail = [{
        "channel": pl.get("channel", ""),
        "date": (pl.get("sentAt") or "")[:10],
        "prospect_id": pl.get("prospect_id"),
    } for pl in sorted(week_push, key=lambda x: x.get("sentAt", ""))]

    # Conversion rate
    conversion_pct = round((rdv_count / total) * 100, 1) if total else 0

    return jsonify(ok=True, data={
        "week_label": week_label,
        "start": start,
        "end": end,
        "kpi": {
            "contacts": new_contacts_count,
            "notes": len(week_notes),
            "push_total": len(week_push),
            "push_email": push_email,
            "push_linkedin": push_linkedin,
            "rdv": rdv_count,
            "overdue": len(overdue),
            "conversion_pct": conversion_pct,
            "total_prospects": total,
            "companies_touched": len(touched_companies),
        },
        "statuts": statuts,
        "touched_companies": sorted(touched_companies)[:15],
        "notes_detail": notes_detail[:20],
        "push_detail": push_detail[:20],
    })


# ────────────────────────────────────────────────────────────────────
# Custom Métiers – ajout de compétences / spécialités / catégories
# ────────────────────────────────────────────────────────────────────

@app.get("/api/custom_metiers")
def api_custom_metiers_list():
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM custom_metiers ORDER BY category, specialty, tech_group, value").fetchall()
    return jsonify(ok=True, items=[dict(r) for r in rows])


@app.post("/api/custom_metiers")
def api_custom_metiers_add():
    d = request.get_json(force=True)
    tp = d.get("type", "tech")  # tech | specialty | category | sector
    cat = d.get("category", "").strip()
    spec = d.get("specialty", "").strip() or None
    tg = d.get("tech_group", "").strip() or None
    val = d.get("value", "").strip()
    if not val:
        return jsonify(ok=False, error="value required"), 400
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
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
        conn.commit()
    return jsonify(ok=True)


@app.delete("/api/custom_metiers/<int:item_id>")
def api_custom_metiers_delete(item_id):
    with _conn() as conn:
        conn.execute("DELETE FROM custom_metiers WHERE id=?", (item_id,))
        conn.commit()
    return jsonify(ok=True)


# ────────────────────────────────────────────────────────────────────
# Calendar – vue calendrier des actions
# ────────────────────────────────────────────────────────────────────

@app.get("/calendrier")
def page_calendar():
    return render_template("calendrier.html", static_hashes=_static_hashes)


@app.get("/collab")
@login_required
def page_collab():
    """Page de collaboration."""
    return render_template("collab.html", static_hashes=_static_hashes)


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

    return jsonify(ok=True, events=events)


def _parse_ics_to_events(ics_text: str) -> List[Dict[str, Any]]:
    """Parse ICS text and return list of events { date, time, name }. Simple VEVENT parser."""
    events = []
    if not ics_text or "BEGIN:VEVENT" not in ics_text:
        return events
    blocks = ics_text.split("BEGIN:VEVENT")
    for block in blocks[1:]:
        part = block.split("END:VEVENT")[0]
        summary = ""
        start_date = ""
        start_time = ""
        summary_m = re.search(r"SUMMARY[^:]*:(.*?)(?:\r?\n(?!\s))", part, re.DOTALL)
        if summary_m:
            summary = re.sub(r"\r?\n\s+", "", summary_m.group(1)).strip()
        start_m = re.search(r"DTSTART[^:]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?", part)
        if start_m:
            start_date = f"{start_m.group(1)}-{start_m.group(2)}-{start_m.group(3)}"
            if start_m.group(4):
                start_time = f"{start_m.group(4)}:{start_m.group(5) or '00'}"
        if start_date and summary:
            events.append({"date": start_date, "time": start_time, "name": summary})
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
        {"id": None, "name": e["name"], "company": "", "date": e["date"], "time": e.get("time") or "", "type": "external", "statut": "", "url": ""}
        for e in raw
    ]
    return jsonify(ok=True, events=events)


# ────────────────────────────────────────────────────────────────────
# Dashboard – activité quotidienne / hebdo
# ────────────────────────────────────────────────────────────────────

@app.get("/dashboard")
def page_dashboard():
    return render_template("dashboard.html", static_hashes=_static_hashes)


# Gamified goals helpers are extracted in services/dashboard_goals.py.


@app.get("/api/dashboard")
def api_dashboard():
    """Return KPIs for today + this week + trends."""
    today = _today_iso()
    # Monday of this week
    d_today = datetime.date.fromisoformat(today)
    monday = (d_today - datetime.timedelta(days=d_today.weekday())).isoformat()
    # Last week range
    prev_monday = (d_today - datetime.timedelta(days=d_today.weekday() + 7)).isoformat()
    prev_sunday = (d_today - datetime.timedelta(days=d_today.weekday() + 1)).isoformat()

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        prospects = conn.execute("SELECT * FROM prospects WHERE owner_id=?;", (uid,)).fetchall()
        push_logs = conn.execute(
            "SELECT l.* FROM push_logs l JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=?;",
            (uid,),
        ).fetchall()
        goals_cfg = _get_goals_config(conn)
        # Event-based KPIs (for goals)
        try:
            rdv_taken_today = conn.execute(
                "SELECT COUNT(*) FROM prospect_events e JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=? WHERE e.type='rdv_taken' AND e.date=?",
                (uid, today),
            ).fetchone()[0]
            rdv_taken_week = conn.execute(
                "SELECT COUNT(*) FROM prospect_events e JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=? WHERE e.type='rdv_taken' AND e.date BETWEEN ? AND ?",
                (uid, monday, today),
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

    prospects_list = [dict(r) for r in prospects]
    push_list = [dict(r) for r in push_logs]

    # Parse all call notes
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

    def count_contacts(date_str):
        return sum(1 for p in prospects_list if (p.get("lastContact") or "") == date_str)

    def count_contacts_range(start, end):
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

    # Today's notes for activity feed
    today_notes = sorted(
        [n for n in all_notes if (n.get("date") or "")[:10] == today],
        key=lambda x: x.get("date", ""), reverse=True
    )
    today_push = sorted(
        [pl for pl in push_list if (pl.get("sentAt") or "")[:10] == today],
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
            "contacts": count_contacts(d),
            "notes": count_notes(d),
            "push": count_push(d),
        })

    # Goals / gamification payload (daily + weekly)
    goals_daily_counts = {
        "rdv": rdv_taken_today,
        "push": count_push(today),
        "sourcing_contacted": cand_contacted_today,
    }
    goals_weekly_counts = {
        "rdv": rdv_taken_week,
        "push": count_push_range(monday, today),
        "sourcing_contacted": cand_contacted_week,
        "sourcing_solid": cand_solid_week,
    }
    goals_payload = _build_goals_payload(
        goals_cfg=goals_cfg,
        daily_counts=goals_daily_counts,
        weekly_counts=goals_weekly_counts,
    )

    return jsonify(ok=True, data={
        "today": {
            "date": today,
            "contacts": count_contacts(today),
            "notes": count_notes(today),
            "push_total": count_push(today),
            "push_email": count_push_channel(today, today, "email"),
            "push_linkedin": count_push_channel(today, today, "linkedin"),
        },
        "goals": goals_payload,
        "week": {
            "start": monday,
            "end": today,
            "contacts": count_contacts_range(monday, today),
            "notes": count_notes_range(monday, today),
            "push_total": count_push_range(monday, today),
            "push_email": count_push_channel(monday, today, "email"),
            "push_linkedin": count_push_channel(monday, today, "linkedin"),
            "days": week_days,
        },
        "prev_week": {
            "contacts": count_contacts_range(prev_monday, prev_sunday),
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
        },
        "overdue_list": [{
            "id": p["id"],
            "name": p["name"],
            "nextFollowUp": p.get("nextFollowUp", ""),
            "statut": p.get("statut", ""),
            "company_id": p.get("company_id"),
        } for p in sorted(overdue, key=lambda x: x.get("nextFollowUp", ""))[:10]],
        "upcoming_rdv": [{
            "id": p["id"],
            "name": p["name"],
            "rdvDate": p.get("rdvDate", ""),
            "statut": p.get("statut", ""),
        } for p in sorted(
            [p for p in prospects_list if (p.get("rdvDate") or "").strip() >= today],
            key=lambda x: x.get("rdvDate", "")
        )[:5]],
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

Réponds UNIQUEMENT avec le JSON, sans texte avant ni après.
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
            '➜ ' + contexte_entreprise.get("conclusion_matching", ""),
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
    """Créer une nouvelle réunion à partir de la grille de qualification actuelle."""
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

    if not prospect_id:
        return jsonify(ok=False, error="prospect_id requis"), 400
    if not title:
        return jsonify(ok=False, error="Titre requis"), 400
    if not _prospect_owned(int(prospect_id)):
        return jsonify(ok=False, error="Accès refusé"), 403
    
    now = datetime.datetime.now().isoformat(timespec="seconds")
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    
    with _conn() as conn:
        cursor = conn.execute(
            """INSERT INTO meetings (prospect_id, owner_id, date, title, checklist_data, notes, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (prospect_id, uid, today, title, json.dumps(checklist_data, ensure_ascii=False) if checklist_data else None, notes, now)
        )
        meeting_id = cursor.lastrowid
        
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
                # Récupérer le nom de l'entreprise
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
    
    return jsonify(ok=True, id=meeting_id, date=today)


@app.get("/api/meetings")
def meetings_list():
    """Lister les réunions d'un prospect (owner only)."""
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
            """SELECT id, date, title, checklist_data, notes, createdAt
               FROM meetings
               WHERE prospect_id = ? AND owner_id = ?
               ORDER BY date DESC, createdAt DESC""",
            (prospect_id, uid)
        ).fetchall()
    
    meetings = []
    for row in rows:
        checklist = None
        if row["checklist_data"]:
            try:
                checklist = json.loads(row["checklist_data"])
            except Exception:
                pass
        meetings.append({
            "id": row["id"],
            "date": row["date"],
            "title": row["title"],
            "checklist_data": checklist,
            "notes": row["notes"] or "",
            "createdAt": row["createdAt"]
        })
    
    return jsonify(ok=True, meetings=meetings)


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
        <h1>📋 Compte-rendu de réunion</h1>
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
# v26.3: Routes API pour "Avant réunion IA" — streaming SSE et génération PDF
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/prospect/<int:prospect_id>/infos-rdv-stream")
@login_required
def api_prospect_infos_rdv_stream(prospect_id: int):
    """Route SSE pour analyser un prospect via Ollama et générer une fiche de préparation RDV.
    
    Stream les tokens Ollama en temps réel, puis stocke la réponse complète en session
    pour la génération PDF ultérieure.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    # Vérifier que le prospect appartient à l'utilisateur
    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Accès refusé"), 403
    
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
    
    # Construire le prompt Ollama
    prompt = build_ollama_prompt_rdv(prospect, company)
    fallback_prompt = build_fallback_prompt_rdv(prospect, company)
    
    def generate():
        try:
            # Appeler Ollama en streaming
            body = json.dumps({"model": OLLAMA_MODEL, "prompt": prompt, "stream": True}, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(
                f"{OLLAMA_URL}/api/generate",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            
            yield f"data: {json.dumps({'type': 'start', 'message': 'Connexion à Ollama établie'}, ensure_ascii=False)}\n\n"
            
            full_response = ""
            with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as resp:
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
                                # Dernier chunk avec le texte complet
                                final_text = data.get("response", "")
                                if final_text:
                                    full_response += final_text
                                    yield f"data: {json.dumps({'type': 'token', 'content': final_text, 'done': True}, ensure_ascii=False)}\n\n"
                                
                                # Stocker la réponse complète en session pour le PDF
                                session[f"rdv_analysis_{prospect_id}"] = full_response
                                
                                # Envoyer l'événement de fin avec l'URL du PDF
                                yield f"data: {json.dumps({'type': 'done', 'pdf_url': f'/api/prospect/{prospect_id}/download-rdv-pdf'}, ensure_ascii=False)}\n\n"
                                break
                            else:
                                # Token partiel
                                token = data.get("response", "")
                                if token:
                                    full_response += token
                                    yield f"data: {json.dumps({'type': 'token', 'content': token, 'done': False}, ensure_ascii=False)}\n\n"
                        except json.JSONDecodeError:
                            continue
        except urllib.error.URLError as e:
            logger.warning("Ollama unreachable (infos-rdv-stream): %s", e)
            yield f"data: {json.dumps({'type': 'error', 'fallback_prompt': fallback_prompt}, ensure_ascii=False)}\n\n"
        except urllib.error.HTTPError as e:
            try:
                err_body = ""
                if e.fp:
                    err_body = e.read().decode("utf-8")
                err_data = json.loads(err_body) if err_body else {}
                msg = err_data.get("error", err_body) or str(e)
            except Exception:
                msg = str(e)
            logger.warning("Ollama HTTP error %s (infos-rdv-stream): %s", e.code, msg)
            yield f"data: {json.dumps({'type': 'error', 'fallback_prompt': fallback_prompt}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.exception("Ollama infos-rdv-stream failed")
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
    
    # Récupérer la réponse Ollama depuis la session
    ollama_response = session.get(f"rdv_analysis_{prospect_id}")
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
    # Extraire le JSON (peut être entouré de texte)
    import re as re_mod
    json_match = re_mod.search(r"\{[\s\S]*\}", ollama_response)
    if not json_match:
        return jsonify(ok=False, error="Format de réponse Ollama invalide. Réessayez."), 400
    
    try:
        ollama_data = json.loads(json_match.group(0))
    except json.JSONDecodeError as e:
        logger.warning("Erreur parsing JSON Ollama: %s", e)
        return jsonify(ok=False, error="Erreur lors du parsing de la réponse Ollama. Réessayez."), 400
    
    # Générer le PDF
    try:
        pdf_buffer = build_fiche_rdv_pdf(prospect, company, ollama_data)
        
        # Nettoyer la session (optionnel, pour éviter l'accumulation)
        session.pop(f"rdv_analysis_{prospect_id}", None)
        
        # Nom du fichier
        nom_complet = prospect.get("name", "").strip() or "prospect"
        nom_safe = "".join(c for c in nom_complet if c.isalnum() or c in (' ', '-', '_')).strip()[:50]
        filename = f"fiche_rdv_{nom_safe}.pdf"
        
        return send_file(
            pdf_buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        logger.exception("Erreur génération PDF fiche RDV")
        return jsonify(ok=False, error=f"Erreur lors de la génération du PDF: {str(e)}"), 500


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
        # Entreprises partagées PAR l'utilisateur (envoyées)
        sent_rows = aconn.execute(
            """
            SELECT sc.id, sc.company_id, sc.to_user_id, sc.shared_at,
                   u.username, u.display_name,
                   c.groupe, c.site
            FROM shared_companies sc
            JOIN users u ON u.id = sc.to_user_id
            LEFT JOIN companies c ON c.id = sc.company_id AND c.owner_id = ?
            WHERE sc.from_user_id = ?
            ORDER BY sc.shared_at DESC;
            """,
            (uid, uid)
        ).fetchall()
        
        # Entreprises partagées AVEC l'utilisateur (reçues)
        received_rows = aconn.execute(
            """
            SELECT sc.id, sc.company_id, sc.from_user_id, sc.shared_at,
                   u.username, u.display_name,
                   c.groupe, c.site
            FROM shared_companies sc
            JOIN users u ON u.id = sc.from_user_id
            LEFT JOIN companies c ON c.id = sc.company_id AND c.owner_id = sc.from_user_id
            WHERE sc.to_user_id = ?
            ORDER BY sc.shared_at DESC;
            """,
            (uid,)
        ).fetchall()
    
    return jsonify(ok=True, sent=[dict(r) for r in sent_rows], received=[dict(r) for r in received_rows])


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
                     fixedMetier, rdvDate, is_contact, owner_id, deleted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);
                    """,
                    (
                        p["id"], p["name"], target_company_id, p.get("fonction"), p.get("telephone"),
                        p.get("email"), p.get("linkedin"), p.get("pertinence"), p.get("statut"),
                        p.get("lastContact"), p.get("nextFollowUp"), p.get("priority"),
                        p.get("notes"), p.get("callNotes"), p.get("pushEmailSentAt"), p.get("tags"),
                        p.get("template_id"), p.get("nextAction"), p.get("pushLinkedInSentAt"),
                        p.get("photo_url"), p.get("push_category_id"), p.get("fixedMetier"),
                        p.get("rdvDate"), p.get("is_contact"), to_user_id
                    )
                )
        finally:
            to_conn.execute("PRAGMA foreign_keys = ON;")


@app.get("/api/collab/shared-company/<int:company_id>/prospects")
@login_required
def api_collab_shared_company_prospects(company_id: int):
    """Liste des prospects d'une entreprise partagée."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    # Vérifier que l'entreprise est bien partagée avec l'utilisateur
    with _auth_conn() as aconn:
        share = aconn.execute(
            "SELECT from_user_id FROM shared_companies WHERE company_id = ? AND to_user_id = ?;",
            (company_id, uid)
        ).fetchone()
        if not share:
            return jsonify(ok=False, error="Entreprise non partagée"), 404
    
    # Lire les prospects depuis la DB de l'utilisateur (l'entreprise partagée devrait être dans sa DB)
    with _conn() as conn:
        prospects = conn.execute(
            "SELECT * FROM prospects WHERE company_id = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY id;",
            (company_id, uid)
        ).fetchall()
    
    def _parse_tags(v):
        if not v:
            return []
        try:
            return json.loads(v) if isinstance(v, str) else v
        except:
            return [t.strip() for t in str(v).split(",") if t.strip()]
    
    result = []
    for p in prospects:
        d = dict(p)
        try:
            d["callNotes"] = json.loads(d.get("callNotes") or "[]")
        except:
            d["callNotes"] = []
        d["tags"] = _parse_tags(d.get("tags"))
        d["is_contact"] = int(d.get("is_contact") or 0)
        result.append(d)
    
    return jsonify(ok=True, prospects=result)


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
        prospects = conn.execute("SELECT * FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchall()
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


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    init_db()
    _migrate_users_schema()
    _migrate_all_user_dbs()
    load_initial_data_if_needed()

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
