"""ProspUp — auth helpers (sessions, ownership, JWT, rate-limit, CSRF).

Tout ce qui touche à l'identité utilisateur, au contrôle d'accès et au flux
de tokens. Importé par app.py + routes/auth.py + autres blueprints.

Les helpers JWT utilisent `flask.current_app.secret_key` (résolu au moment
de l'appel via le LocalProxy) plutôt que de prendre `app` en argument, ce
qui évite tout cycle d'import avec app.py.
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from functools import wraps
from typing import Dict, List

from flask import current_app, g, jsonify, redirect, request, session

from utils.db import _auth_conn, _conn

# ── Roles ──────────────────────────────────────────────────────────
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


# ── Anti-CSRF (Origin check) ───────────────────────────────────────
# Origines autorisées quand l'app est derrière le tunnel (request.host = localhost,
# Origin = prospup.work). Variable d'env PROSPUP_ALLOWED_ORIGINS = URLs séparées
# par des virgules pour étendre la liste.
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


# ── Rate limit login (in-memory, IP-based) ─────────────────────────
_login_attempts: Dict[str, List[float]] = {}
_login_lock = threading.Lock()
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 300  # 5 minutes


def _check_login_rate_limit() -> bool:
    """Returns True if rate limited (thread-safe)."""
    ip = request.remote_addr or "unknown"
    now = time.time()
    with _login_lock:
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


# ── JWT (HS256, sans dépendance PyJWT) ─────────────────────────────
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
    """Generate a short-lived JWT access token. Uses current_app.secret_key."""
    payload = {
        "user_id": user["id"],
        "user_role": user["role"],
        "user_name": user.get("display_name") or user.get("username") or "",
        "type": "access",
        "iat": int(time.time()),
        "exp": int(time.time()) + _JWT_ACCESS_EXPIRY,
    }
    return _jwt_encode(payload, current_app.secret_key)


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
    result = _jwt_decode(token, current_app.secret_key)
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


def _get_user_prefix(user_id):
    """Teams prefix désactivé (section retirée). Retourne chaîne vide.

    Conservé comme stub pour rétrocompatibilité avec le code qui l'appelle.
    """
    return ""
