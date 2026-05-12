"""ProspUp — Blueprint Settings (clé/valeur dans app_settings + email reports)."""
from __future__ import annotations

import logging
import smtplib

from flask import Blueprint, g, jsonify, request

from services.email_reports import (
    EmailConfigError,
    build_and_send_daily,
    build_and_send_weekly,
    compute_daily_data,
    compute_weekly_data,
    load_settings as load_email_settings,
    render_daily_html,
    render_weekly_html,
    send_email,
)
from utils.auth import _get_current_user, _uid, login_required
from utils.db import _conn

logger = logging.getLogger("prospup")

settings_bp = Blueprint("settings", __name__)


@settings_bp.get("/api/settings")
def api_settings_get():
    """Retrieve all app settings as a key-value dict."""
    with _conn() as conn:
        rows = conn.execute("SELECT key, value FROM app_settings;").fetchall()
    settings = {r["key"]: r["value"] for r in rows}
    # Le mot de passe SMTP n'est pas renvoyé en clair : on remplace par un
    # marqueur côté UI pour signaler qu'une valeur est stockée.
    if settings.get("email_smtp_password"):
        settings["email_smtp_password"] = "__set__"
    return jsonify(ok=True, settings=settings)


@settings_bp.post("/api/settings")
def api_settings_save():
    """Save one or more settings (key-value pairs)."""
    payload = request.get_json(force=True, silent=False) or {}
    settings = payload.get("settings", {})
    if not settings:
        return jsonify(ok=False, error="No settings provided"), 400
    with _conn() as conn:
        for key, value in settings.items():
            # Ne pas écraser le mot de passe SMTP si l'UI a renvoyé le marqueur.
            if key == "email_smtp_password" and value == "__set__":
                continue
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);",
                (str(key), str(value) if value is not None else ""),
            )
    return jsonify(ok=True)


# ────────────────────────────────────────────────────────────────────
#  Email reports — preview, test, send-now
# ────────────────────────────────────────────────────────────────────

def _user_display_name() -> str:
    user = getattr(g, "user", None) or _get_current_user() or {}
    return user.get("display_name") or user.get("username") or ""


@settings_bp.get("/api/email-reports/preview")
@login_required
def api_email_reports_preview():
    """Aperçu HTML du rapport quotidien ou hebdomadaire (sans envoi)."""
    kind = (request.args.get("kind") or "daily").lower()
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        settings = load_email_settings(conn)
        sender = settings.get("email_smtp_from_name") or "Prosp'Up"
        if kind == "weekly":
            data = compute_weekly_data(conn, uid)
            html = render_weekly_html(data, user_name=_user_display_name(),
                                      sender_name=sender)
        else:
            data = compute_daily_data(conn, uid)
            html = render_daily_html(data, user_name=_user_display_name(),
                                     sender_name=sender)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@settings_bp.post("/api/email-reports/send")
@login_required
def api_email_reports_send():
    """Envoie immédiatement un rapport (daily ou weekly) au destinataire courant."""
    kind = (request.get_json(silent=True) or {}).get("kind", "daily").lower()
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    try:
        with _conn() as conn:
            if kind == "weekly":
                out = build_and_send_weekly(conn, uid, user_name=_user_display_name())
            else:
                out = build_and_send_daily(conn, uid, user_name=_user_display_name())
        return jsonify(ok=True, subject=out["subject"], to=out["to"])
    except EmailConfigError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except smtplib.SMTPException as exc:
        logger.warning("SMTP error (send-now %s) : %s", kind, exc)
        return jsonify(ok=False, error=f"SMTP : {exc}"), 502
    except Exception as exc:  # noqa: BLE001 — surface user-facing
        logger.exception("Erreur envoi rapport %s", kind)
        return jsonify(ok=False, error=str(exc)), 500


@settings_bp.post("/api/email-reports/test")
@login_required
def api_email_reports_test():
    """Envoie un email de test (1 ligne, sujet « Prosp'Up — test SMTP »)
    pour vérifier la configuration SMTP sans dépendre des KPI."""
    payload = request.get_json(silent=True) or {}
    to_override = (payload.get("to") or "").strip()
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        settings = load_email_settings(conn)
    to = to_override or settings.get("email_daily_to") or settings.get("email_weekly_to") or ""
    if not to:
        return jsonify(ok=False, error="Aucun destinataire défini"), 400
    html = (
        "<!DOCTYPE html><html><body style=\"font-family:Inter,sans-serif; "
        "background:#f6f6f5; padding:24px;\">"
        "<div style=\"max-width:480px; margin:0 auto; background:#fff; "
        "border:1px solid #e6e6e6; border-radius:10px; padding:24px;\">"
        "<h1 style=\"font-family:'Instrument Serif',Georgia,serif; font-style:italic; "
        "margin:0 0 8px; font-size:22px;\">Test SMTP — Prosp'Up</h1>"
        "<p style=\"color:#52525c; line-height:1.5; margin:0;\">"
        "Si vous lisez ce message, la configuration SMTP fonctionne. "
        "Les rapports quotidien et hebdomadaire seront envoyés selon vos préférences."
        "</p></div></body></html>"
    )
    try:
        send_email(to=to, subject="Prosp'Up — test SMTP", html=html, settings=settings)
        return jsonify(ok=True, to=to)
    except EmailConfigError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except smtplib.SMTPException as exc:
        logger.warning("SMTP test error : %s", exc)
        return jsonify(ok=False, error=f"SMTP : {exc}"), 502
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erreur test SMTP")
        return jsonify(ok=False, error=str(exc)), 500
