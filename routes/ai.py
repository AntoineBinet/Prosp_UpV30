"""
Blueprint : /api/ollama/* et /api/ai/*
Extrait de app.py — proxy IA (Ollama/Sonar) et configuration multi-provider.

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
    SONAR_MODEL,
    _call_ai,
    _call_ai_provider,
    _call_ai_web,
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
    """Proxy IA unifié (non-streaming) : route vers le provider configuré (Ollama/Sonar) avec fallback."""
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


@ai_bp.post("/api/ollama/generate-stream")
def api_ollama_generate_stream():
    """Proxy IA unifié avec streaming SSE : route vers le provider configuré avec fallback."""
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


@ai_bp.get("/api/ai/config")
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


@ai_bp.post("/api/ai/test")
def api_ai_test():
    """Teste la connexion au provider IA configuré."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    _clear_ai_config_cache()
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
