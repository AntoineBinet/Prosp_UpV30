"""ProspUp — Blueprint Settings (clé/valeur dans app_settings)."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from utils.db import _conn

settings_bp = Blueprint("settings", __name__)


@settings_bp.get("/api/settings")
def api_settings_get():
    """Retrieve all app settings as a key-value dict."""
    with _conn() as conn:
        rows = conn.execute("SELECT key, value FROM app_settings;").fetchall()
    settings = {r["key"]: r["value"] for r in rows}
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
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);",
                (str(key), str(value) if value is not None else ""),
            )
    return jsonify(ok=True)
