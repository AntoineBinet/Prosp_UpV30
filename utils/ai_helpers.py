"""ProspUp — appels IA (Ollama local, Tavily web), embeddings, similarité.

Centralise toute la couche IA :
- Lecture / écriture de la config IA (`data/ai_config.json`).
- Appels Ollama (non-streaming + SSE streaming).
- Recherche web Tavily.
- Combinaison Tavily + Ollama (web-enriched generation).
- Embeddings simplifiés + similarité cosinus pour matching sémantique.

Dépend de utils/db.py (cache embeddings en DB) et de config.py (URL/modèle
par défaut). Importé par app.py + routes/ai.py + services/transcription.py.
"""
from __future__ import annotations

import json
import logging
import math
import os
import urllib.error
import urllib.request
from typing import Dict, List

from config import DATA_DIR, OLLAMA_MODEL, OLLAMA_URL, TAVILY_API_KEY, TAVILY_URL
from utils.db import _conn

logger = logging.getLogger("prospup")

# ═══════════════════════════════════════════════════════════════════
# Configuration IA (cache mémoire + persistance fichier)
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
        "candidate_description_prompt": "",
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
        # Avec llama3.2:3B (modèle Ollama par défaut), l'analyse de réunions
        # longues hallucine massivement. Mieux vaut une erreur claire qu'un
        # faux CR. Réactivable explicitement si gros modèle local dispo.
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
            defaults.pop("sonar_api_key", None)
            defaults.pop("sonar_model", None)
        except Exception:
            pass
    _ai_config_cache = defaults
    return defaults


def _save_ai_config(config: dict):
    """Persiste la config IA sur disque et rafraîchit le cache.
    v32.68 : chmod 600 sur le fichier (POSIX) — il contient les clés API
    en clair (Tavily, Anthropic, HuggingFace, France Travail, etc.)."""
    global _ai_config_cache
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(_AI_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(_AI_CONFIG_FILE, 0o600)
    except (NotImplementedError, OSError):
        pass  # Windows : ACL géré au niveau du dossier user
    _ai_config_cache = config


# ═══════════════════════════════════════════════════════════════════
# Appels IA non-streaming (Ollama + Tavily)
# ═══════════════════════════════════════════════════════════════════
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


# ═══════════════════════════════════════════════════════════════════
# Embeddings et similarité sémantique
# Cache mémoire process-level pour éviter les requêtes DB répétées
# ═══════════════════════════════════════════════════════════════════
_embedding_mem_cache: dict = {}


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


def _get_text_embedding_simple(text: str) -> List[float] | None:
    """Embedding simplifié basé sur la fréquence des caractères (fallback rapide)."""
    if not text:
        return None
    key = text.strip().lower()
    if key in _embedding_mem_cache:
        return _embedding_mem_cache[key]

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

    max_val = max(abs(x) for x in embedding) if embedding else 1.0
    if max_val > 0:
        embedding = [x / max_val for x in embedding]

    _embedding_mem_cache[key] = embedding
    return embedding


def _get_embedding_for_text(text: str, entity_type: str, entity_id: int = None, config: dict = None) -> List[float] | None:
    """Génère ou récupère un embedding pour un texte donné.

    Phase 1 : approche simplifiée basée sur la fréquence des caractères et
    mots-clés techniques. Pour une vraie solution d'embeddings, brancher
    sentence-transformers ou OpenAI.
    """
    if not text or not text.strip():
        return None

    text_key = text.strip().lower()
    if text_key in _embedding_mem_cache:
        return _embedding_mem_cache[text_key]

    config = config or _load_ai_config()

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

    embedding = _get_text_embedding_simple(text)

    if embedding:
        with _conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO embeddings_cache (entity_type, entity_id, text_key, embedding) VALUES (?, ?, ?, ?);",
                (entity_type, entity_id, text_key, json.dumps(embedding))
            )
        return embedding

    return None


def _compute_semantic_similarity(text1: str, text2: str, entity_type: str = "tag") -> float:
    """Score de proximité entre deux termes techniques (0.0 à 1.0).

    Stratégie (du plus fiable au plus approximatif) :
    1. Match exact après normalisation (accents/casse/espaces) → 1.0
    2. Synonyme via le dictionnaire `utils.tech_synonyms` → 0.85
    3. Jaccard sur les mots (utile pour les libellés multi-mots type
       « chef de projet industrialisation ») → ratio brut
    L'ancien embedding-fréquence-de-caractères a été retiré : il
    produisait des cosinus parasites entre termes sans rapport.
    """
    if not text1 or not text2:
        return 0.0

    from utils.tech_synonyms import _norm, are_synonyms

    a, b = _norm(text1), _norm(text2)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if are_synonyms(a, b):
        return 0.85

    words1 = set(a.split())
    words2 = set(b.split())
    if not words1 or not words2:
        return 0.0
    intersection = len(words1 & words2)
    union = len(words1 | words2)
    return intersection / union if union > 0 else 0.0


# ═══════════════════════════════════════════════════════════════════
# Streaming SSE (Ollama + Tavily+Ollama)
# ═══════════════════════════════════════════════════════════════════
def _stream_ai_web_sse(prompt: str, model_override: str | None, timeout: int, temperature: float | None = None, search_query: str | None = None):
    """Stream SSE : Tavily + Ollama si configuré, sinon Ollama seul.

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
