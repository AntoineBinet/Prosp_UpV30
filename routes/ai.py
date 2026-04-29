"""
Blueprint : /api/ollama/* et /api/ai/*
Extrait de app.py — proxy IA (Ollama + Tavily recherche web) et configuration.

Inclut :
  POST /api/ollama/generate           — proxy non-streaming (tous rôles)
  POST /api/ollama/generate-stream    — proxy SSE streaming (tous rôles)
  GET  /api/ai/config                 — config courante (tous rôles)
  POST /api/ai/config                 — mise à jour config (admin)
  POST /api/ai/test                   — test connexion provider (tous rôles)
"""

import json
import urllib.error

from flask import Blueprint, Response, jsonify, request

from app import (
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT,
    OLLAMA_URL,
    _call_ai,
    _call_ai_provider,
    _call_ai_web,
    _call_tavily_search,
    _clear_ai_config_cache,
    _get_current_user,
    _load_ai_config,
    _save_ai_config,
    _stream_ai_sse,
    _stream_ai_web_sse,
    _uid,
    logger,
)

ai_bp = Blueprint("ai", __name__)


@ai_bp.post("/api/ollama/generate")
def api_ollama_generate():
    """Proxy IA unifié (non-streaming) : Ollama + Tavily (recherche web) si configuré."""
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
        label = {"ollama": "Ollama"}.get(provider, provider)
        logger.warning("%s unreachable: %s", label, e)
        return jsonify(ok=False, error=f"{label} indisponible (vérifiez la configuration dans Paramètres)"), 503
    except Exception as e:
        logger.exception("AI generate failed")
        return jsonify(ok=False, error=str(e)), 503


@ai_bp.post("/api/ollama/generate-stream")
def api_ollama_generate_stream():
    """Proxy IA unifié avec streaming SSE : Ollama + Tavily (recherche web) si configuré."""
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
    temperature = payload.get("temperature")
    if temperature is not None:
        try:
            temperature = max(0.0, min(2.0, float(temperature)))
        except (TypeError, ValueError):
            temperature = None
    stream_fn = _stream_ai_web_sse if web_search else _stream_ai_sse

    return Response(
        stream_fn(prompt, model, req_timeout, temperature=temperature),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@ai_bp.get("/api/ai/config")
def api_ai_config_get():
    """Retourne la config IA courante (provider, modèles, statut). Masque les clés API."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    config = _load_ai_config()
    tavily_key = config.get("tavily_api_key", "")
    anthropic_key = config.get("anthropic_api_key", "")
    hf_token = config.get("huggingface_token", "")
    return jsonify(ok=True, config={
        "provider": config.get("provider", "ollama"),
        "fallback_enabled": config.get("fallback_enabled", True),
        "ollama_url": config.get("ollama_url", OLLAMA_URL),
        "ollama_model": config.get("ollama_model", OLLAMA_MODEL),
        "tavily_api_key_set": bool(tavily_key),
        "tavily_api_key_preview": (tavily_key[:8] + "…") if len(tavily_key) > 8 else ("••••" if tavily_key else ""),
        "candidate_description_prompt": config.get("candidate_description_prompt", ""),
        "candidate_pdf_max_chars": int(config.get("candidate_pdf_max_chars") or 6000),
        # v32.1 — Transcription
        "anthropic_api_key_set": bool(anthropic_key),
        "anthropic_api_key_preview": (anthropic_key[:10] + "…") if len(anthropic_key) > 10 else ("••••" if anthropic_key else ""),
        "anthropic_model": config.get("anthropic_model", "claude-haiku-4-5"),
        "whisper_model": config.get("whisper_model", "large-v3"),
        "whisper_compute_type": config.get("whisper_compute_type", "float16"),
        "whisper_device": config.get("whisper_device", "cuda"),
        "diarization_enabled": bool(config.get("diarization_enabled", True)),
        "huggingface_token_set": bool(hf_token),
        "huggingface_token_preview": (hf_token[:8] + "…") if len(hf_token) > 8 else ("••••" if hf_token else ""),
    })


@ai_bp.post("/api/ai/config")
def api_ai_config_post():
    """Met à jour la config IA. Admin uniquement."""
    user = _get_current_user()
    if not user:
        return jsonify(ok=False, error="Non authentifié"), 401
    if user.get("role") != "admin":
        return jsonify(ok=False, error="Réservé aux administrateurs"), 403
    payload = request.get_json(force=True, silent=True) or {}
    config = _load_ai_config()
    if "fallback_enabled" in payload:
        config["fallback_enabled"] = bool(payload["fallback_enabled"])
    if "ollama_url" in payload:
        config["ollama_url"] = str(payload["ollama_url"]).strip().rstrip("/") or OLLAMA_URL
    if "ollama_model" in payload:
        config["ollama_model"] = str(payload["ollama_model"]).strip() or OLLAMA_MODEL
    if "tavily_api_key" in payload:
        config["tavily_api_key"] = str(payload["tavily_api_key"]).strip()
    if "candidate_description_prompt" in payload:
        config["candidate_description_prompt"] = str(payload["candidate_description_prompt"])
    if "candidate_pdf_max_chars" in payload:
        try:
            config["candidate_pdf_max_chars"] = max(1000, min(20000, int(payload["candidate_pdf_max_chars"])))
        except (ValueError, TypeError):
            pass
    # v32.1 — Transcription (Anthropic + Whisper + diarisation)
    if "anthropic_api_key" in payload:
        config["anthropic_api_key"] = str(payload["anthropic_api_key"]).strip()
    if "anthropic_model" in payload:
        m = str(payload["anthropic_model"]).strip()
        if m:
            config["anthropic_model"] = m
    if "whisper_model" in payload:
        m = str(payload["whisper_model"]).strip()
        if m:
            config["whisper_model"] = m
    if "whisper_compute_type" in payload:
        m = str(payload["whisper_compute_type"]).strip()
        if m in ("float16", "int8_float16", "int8", "float32"):
            config["whisper_compute_type"] = m
    if "whisper_device" in payload:
        m = str(payload["whisper_device"]).strip()
        if m in ("cuda", "cpu", "auto"):
            config["whisper_device"] = m
    if "diarization_enabled" in payload:
        config["diarization_enabled"] = bool(payload["diarization_enabled"])
    if "huggingface_token" in payload:
        config["huggingface_token"] = str(payload["huggingface_token"]).strip()
    config["provider"] = "ollama"
    _save_ai_config(config)
    logger.info("AI config updated by user %s", user.get("id"))
    return jsonify(ok=True)


@ai_bp.post("/api/ai/test")
def api_ai_test():
    """Teste la connexion au provider IA configuré (Ollama) et optionnellement Tavily."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    _clear_ai_config_cache()
    payload = request.get_json(force=True, silent=True) or {}
    test_target = payload.get("test_target", "ollama")
    config = _load_ai_config()
    if payload.get("ollama_url"):
        config = dict(config)
        config["ollama_url"] = payload["ollama_url"]
    if payload.get("ollama_model"):
        config = dict(config) if not isinstance(config, dict) else config
        config["ollama_model"] = payload["ollama_model"]
    if payload.get("tavily_api_key"):
        config = dict(config) if not isinstance(config, dict) else config
        config["tavily_api_key"] = payload["tavily_api_key"]

    if test_target == "tavily":
        tavily_key = config.get("tavily_api_key", "")
        if not tavily_key:
            return jsonify(ok=False, error="Clé API Tavily non configurée. Enregistrez d'abord la configuration."), 400
        try:
            result = _call_tavily_search("test connexion Tavily", config, timeout=10, max_results=1)
            nb_sources = len(result.get("sources", []))
            return jsonify(ok=True, provider="tavily", model="search", response=f"OK — {nb_sources} résultat(s) trouvé(s)")
        except Exception as e:
            logger.warning("Tavily test failed: %s", e)
            return jsonify(ok=False, error=str(e)), 200
    elif test_target == "anthropic":
        # v32.1 — Test API Anthropic via /v1/models (léger, sans consommer de tokens)
        anth_key = (payload.get("anthropic_api_key") or config.get("anthropic_api_key", "")).strip()
        if not anth_key:
            return jsonify(ok=False, error="Clé API Anthropic non configurée."), 400
        anth_model = (payload.get("anthropic_model") or config.get("anthropic_model") or "claude-haiku-4-5").strip()
        try:
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": anth_key,
                    "anthropic-version": "2023-06-01",
                    "Accept": "application/json",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            return jsonify(ok=True, provider="anthropic", model=anth_model, response="OK — clé valide")
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8") if e.fp else ""
                err_data = json.loads(err_body) if err_body else {}
                err = err_data.get("error", {})
                msg = err.get("message") if isinstance(err, dict) else str(err)
                msg = msg or str(e)
            except Exception:
                msg = str(e)
            if e.code in (401, 403):
                msg = f"Clé API Anthropic invalide (HTTP {e.code})."
            logger.warning("Anthropic test HTTP %s: %s", e.code, msg)
            return jsonify(ok=False, error=msg), 200
        except urllib.error.URLError as e:
            return jsonify(ok=False, error="api.anthropic.com injoignable."), 200
        except Exception as e:
            return jsonify(ok=False, error=str(e)), 200
    else:
        test_prompt = "Réponds uniquement par le mot OK."
        try:
            text = _call_ai_provider("ollama", test_prompt, config, timeout=15)
            model = config.get("ollama_model")
            return jsonify(ok=True, provider="ollama", model=model, response=text.strip()[:200])
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
                msg = f"Clé API invalide ou expirée (HTTP {e.code})."
            logger.warning("AI test Ollama HTTP %s: %s", e.code, msg)
            return jsonify(ok=False, error=msg), 200
        except urllib.error.URLError as e:
            return jsonify(ok=False, error="Ollama injoignable. Vérifiez que le service tourne."), 200
        except Exception as e:
            return jsonify(ok=False, error=str(e)), 200
