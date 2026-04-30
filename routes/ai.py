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
import urllib.request

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
        "transcription_fallback_ollama": bool(config.get("transcription_fallback_ollama", False)),
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
    if "transcription_fallback_ollama" in payload:
        config["transcription_fallback_ollama"] = bool(payload["transcription_fallback_ollama"])
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
    elif test_target == "huggingface":
        # v32.7 — Test token HF + accès réel aux 2 modèles pyannote requis
        # par la diarisation. Distingue clairement les cas :
        #   - 401 sur whoami → token invalide / expiré
        #   - 200 whoami mais 403 download → conditions pas acceptées OU
        #     token fine-grained sans scope pyannote
        #   - 200 sur tout → diarisation devrait marcher
        hf_token = (payload.get("huggingface_token") or config.get("huggingface_token", "")).strip()
        if not hf_token:
            return jsonify(ok=False, error="Token HuggingFace non configuré."), 400
        # 1. whoami (vérifie token globalement)
        username = None
        try:
            req = urllib.request.Request(
                "https://huggingface.co/api/whoami-v2",
                headers={"Authorization": f"Bearer {hf_token}", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                who = json.loads(resp.read().decode("utf-8"))
            username = who.get("name") or who.get("fullname") or "?"
            token_type = (who.get("auth", {}) or {}).get("type") or "?"
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return jsonify(ok=False, error="Token HF invalide ou expiré (401). "
                                              "Recrée un Classic Read token sur "
                                              "huggingface.co/settings/tokens."), 200
            return jsonify(ok=False, error=f"HF whoami échoué : HTTP {e.code}"), 200
        except urllib.error.URLError as e:
            return jsonify(ok=False, error=f"Réseau HF injoignable : {e}"), 200
        except Exception as e:
            return jsonify(ok=False, error=f"HF whoami : {e}"), 200

        # 2. Test d'accès RÉEL aux 2 modèles pyannote (download d'un petit
        # fichier — config.yaml). Si conditions OK et token valide, ça
        # passe. Si fine-grained sans scope ou conditions non acceptées,
        # 401/403.
        models = ["pyannote/speaker-diarization-3.1", "pyannote/segmentation-3.0"]
        access_results = {}
        for m in models:
            url = f"https://huggingface.co/{m}/resolve/main/config.yaml"
            try:
                req = urllib.request.Request(
                    url,
                    headers={"Authorization": f"Bearer {hf_token}"},
                    method="HEAD",
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    code = resp.getcode()
                if 200 <= code < 300:
                    access_results[m] = {"ok": True, "msg": "accès OK"}
                else:
                    access_results[m] = {"ok": False, "msg": f"HTTP {code}"}
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    access_results[m] = {
                        "ok": False,
                        "msg": "401 — token rejeté pour ce modèle. "
                               "Très probable : token fine-grained sans scope. "
                               "Solution : créer un Classic Read token.",
                    }
                elif e.code == 403:
                    access_results[m] = {
                        "ok": False,
                        "msg": "403 — conditions d'utilisation non acceptées. "
                               f"Va sur huggingface.co/{m} et clique « Agree ».",
                    }
                else:
                    access_results[m] = {"ok": False, "msg": f"HTTP {e.code}"}
            except Exception as e:
                access_results[m] = {"ok": False, "msg": f"Erreur : {e}"}

        all_ok = all(r["ok"] for r in access_results.values())
        if all_ok:
            return jsonify(
                ok=True,
                provider="huggingface",
                model="pyannote",
                response=(
                    f"OK — connecté en tant que **{username}** (token type : {token_type}). "
                    "Accès validé aux 2 modèles pyannote requis pour la diarisation."
                ),
            )
        # Au moins un modèle bloqué : message détaillé
        details = "\n".join(f"• {m} : {r['msg']}" for m, r in access_results.items())
        return jsonify(
            ok=False,
            error=(
                f"Token valide pour le compte **{username}** (type : {token_type}), "
                f"mais accès aux modèles pyannote bloqué :\n{details}"
            ),
            details=access_results,
            user=username,
            token_type=token_type,
        ), 200
    elif test_target == "anthropic":
        # v32.8 — Test Anthropic via vrai appel /v1/messages (max_tokens=10).
        # /v1/models seul ne révélait PAS l'épuisement des crédits — on ratait
        # le cas typique « Max 5x sans crédits API » qu'on a hit en v32.6.
        # Coût du test : ~10 input + 10 output tokens = quasi 0 (~0,00001 €).
        anth_key = (payload.get("anthropic_api_key") or config.get("anthropic_api_key", "")).strip()
        if not anth_key:
            return jsonify(ok=False, error="Clé API Anthropic non configurée."), 400
        anth_model = (payload.get("anthropic_model") or config.get("anthropic_model") or "claude-haiku-4-5").strip()
        try:
            body = json.dumps({
                "model": anth_model,
                "max_tokens": 10,
                "messages": [{"role": "user", "content": "OK"}],
            }).encode("utf-8")
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=body,
                headers={
                    "x-api-key": anth_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                resp.read()
            return jsonify(
                ok=True,
                provider="anthropic",
                model=anth_model,
                response=f"OK — clé valide ET crédits API disponibles (modèle {anth_model}).",
            )
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8") if e.fp else ""
                err_data = json.loads(err_body) if err_body else {}
                err = err_data.get("error", {})
                msg = err.get("message") if isinstance(err, dict) else str(err)
                msg = msg or str(e)
            except Exception:
                msg = str(e)
            low = (msg or "").lower()
            if "credit" in low or "billing" in low or "insufficient" in low:
                msg = (
                    f"Crédits API Anthropic épuisés. "
                    f"Recharge sur console.anthropic.com/settings/billing "
                    f"(le forfait Claude.ai ne donne PAS accès à l'API). Détail : {msg}"
                )
            elif e.code in (401, 403):
                msg = f"Clé API Anthropic invalide (HTTP {e.code}) : {msg}"
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
            return jsonify(ok=False, error="IA locale injoignable. Vérifiez que le service tourne."), 200
        except Exception as e:
            return jsonify(ok=False, error=str(e)), 200


# ─── Gestion des modèles Ollama ──────────────────────────────────────────────

@ai_bp.get("/api/ollama/models")
def api_ollama_models():
    """Liste les modèles installés sur le serveur Ollama."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    config = _load_ai_config()
    url = config.get("ollama_url", OLLAMA_URL).rstrip("/")
    try:
        with urllib.request.urlopen(url + "/api/tags", timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        models = [
            {
                "name": m.get("name", ""),
                "size": m.get("size", 0),
                "modified_at": m.get("modified_at", ""),
            }
            for m in data.get("models", [])
        ]
        return jsonify(ok=True, models=models)
    except urllib.error.URLError:
        return jsonify(ok=False, error="IA locale injoignable"), 200
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 200


@ai_bp.post("/api/ollama/pull")
def api_ollama_pull():
    """Pull un modèle Ollama — réponse en SSE streaming."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    user = _get_current_user()
    if not user or user.get("role") != "admin":
        return jsonify(ok=False, error="Réservé aux administrateurs"), 403
    payload = request.get_json(force=True, silent=True) or {}
    model_name = (payload.get("model") or "").strip()
    if not model_name:
        return jsonify(ok=False, error="Nom du modèle requis"), 400
    config = _load_ai_config()
    ollama_url = config.get("ollama_url", OLLAMA_URL).rstrip("/")

    def generate():
        body = json.dumps({"model": model_name, "stream": True}).encode("utf-8")
        req = urllib.request.Request(
            ollama_url + "/api/pull",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8").strip()
                    if line:
                        yield f"data: {line}\n\n"
        except urllib.error.URLError as e:
            yield "data: " + json.dumps({"error": "IA locale injoignable : " + str(e)}) + "\n\n"
        except Exception as e:
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@ai_bp.delete("/api/ollama/model")
def api_ollama_delete_model():
    """Supprime un modèle Ollama."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    user = _get_current_user()
    if not user or user.get("role") != "admin":
        return jsonify(ok=False, error="Réservé aux administrateurs"), 403
    payload = request.get_json(force=True, silent=True) or {}
    model_name = (payload.get("model") or "").strip()
    if not model_name:
        return jsonify(ok=False, error="Nom du modèle requis"), 400
    config = _load_ai_config()
    ollama_url = config.get("ollama_url", OLLAMA_URL).rstrip("/")
    body = json.dumps({"model": model_name}).encode("utf-8")
    req = urllib.request.Request(
        ollama_url + "/api/delete",
        data=body,
        headers={"Content-Type": "application/json"},
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
        logger.info("Ollama model deleted: %s by user %s", model_name, uid)
        return jsonify(ok=True)
    except urllib.error.HTTPError as e:
        return jsonify(ok=False, error=f"HTTP {e.code}"), 200
    except urllib.error.URLError:
        return jsonify(ok=False, error="IA locale injoignable"), 200
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 200


_RECOMMENDED_MODELS = [
    {
        "name": "qwen2.5:7b",
        "size_hint": "~5 GB",
        "vram_gb": 6,
        "tags": ["⭐ Recommandé", "JSON"],
        "desc": "Meilleur suivi d'instructions JSON. Idéal pour scrapping IA et enrichissement de fiches. Rapide et précis.",
    },
    {
        "name": "mistral:7b",
        "size_hint": "~5 GB",
        "vram_gb": 6,
        "tags": ["Généraliste"],
        "desc": "Excellent généraliste, très rapide. Bon pour emails, comptes-rendus, résumés. Le plus polyvalent.",
    },
    {
        "name": "llama3.1:8b",
        "size_hint": "~5 GB",
        "vram_gb": 6,
        "tags": ["Généraliste"],
        "desc": "Solide généraliste de Meta. Bonne compréhension du contexte métier et du français.",
    },
    {
        "name": "gemma3:12b",
        "size_hint": "~8 GB",
        "vram_gb": 9,
        "tags": ["Qualité+"],
        "desc": "Dernière génération Google (2025). Qualité supérieure aux 7B pour l'analyse et la rédaction.",
    },
    {
        "name": "qwen2.5:14b",
        "size_hint": "~9 GB",
        "vram_gb": 10,
        "tags": ["Qualité+", "JSON"],
        "desc": "Version améliorée de qwen2.5, encore meilleur sur JSON et instructions complexes. Nécessite 10 GB VRAM.",
    },
    {
        "name": "qwen2.5:32b",
        "size_hint": "~20 GB",
        "vram_gb": 22,
        "tags": ["Transcription", "Max local"],
        "desc": "Pour le fallback transcription et les tâches les plus exigeantes. Nécessite une GPU haut de gamme.",
    },
]


@ai_bp.get("/api/ollama/recommended")
def api_ollama_recommended():
    """Retourne la liste des modèles recommandés."""
    if not _uid():
        return jsonify(ok=False, error="Non authentifié"), 401
    return jsonify(ok=True, models=_RECOMMENDED_MODELS)
