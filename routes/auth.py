"""
Blueprint : /api/auth/*
Extrait de app.py — toutes les routes d'authentification.

Les helpers (_auth_conn, log_activity, etc.) restent dans app.py pour l'instant
et sont importés ici. L'import est résolu sans conflit circulaire car app.py
enregistre ce blueprint APRÈS avoir défini tous ses helpers.
"""

import os
import datetime
import hashlib

from flask import Blueprint, jsonify, request, session, g

# Importés depuis app.py (module partiellement chargé au moment de l'import,
# mais tous ces noms sont définis avant l'appel à register_blueprint en bas de app.py)
from app import (
    APP_VERSION,
    AVATARS_DIR,
    _JWT_ACCESS_EXPIRY,
    _auth_conn,
    _check_login_rate_limit,
    _generate_access_token,
    _generate_refresh_token,
    _get_current_user,
    _get_user_prefix,
    _record_login_attempt,
    _validate_upload,
    _verify_refresh_token,
    check_password_hash,
    generate_password_hash,
    log_activity,
    login_required,
    validate_payload,
)

auth_bp = Blueprint("auth", __name__)

# Utilisateurs créés avant cette date = existants, ne jamais afficher le popup bienvenue
ONBOARDING_CUTOFF_DATE = "2025-03-01"


# ── Session login ──────────────────────────────────────────────────

@auth_bp.post("/api/auth/login")
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
        # v32.67 : régénération de session pour prévenir session fixation.
        # Vide toutes les valeurs (potentiellement injectées avant login) puis
        # re-set propre. Flask régénère le cookie signé au prochain rendu.
        session.clear()
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


@auth_bp.get("/api/auth/me")
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


@auth_bp.patch("/api/auth/profile")
@login_required
def api_auth_profile_update():
    """Mise à jour du profil utilisateur : display_name, email, phone (v27.7)."""
    uid = session.get("user_id")
    data = request.get_json(force=True, silent=True) or {}
    display_name = (data.get("display_name") or "").strip()
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()
    with _auth_conn() as conn:
        if display_name:
            conn.execute(
                "UPDATE users SET display_name=?, email=?, phone=? WHERE id=?",
                (display_name, email, phone, uid),
            )
        else:
            # Garder le display_name existant, mettre à jour seulement email et phone
            conn.execute(
                "UPDATE users SET email=?, phone=? WHERE id=?",
                (email, phone, uid),
            )
            user = conn.execute("SELECT display_name, username FROM users WHERE id=?", (uid,)).fetchone()
            display_name = (user["display_name"] or user["username"] or "") if user else ""
    return jsonify(ok=True, display_name=display_name, email=email, phone=phone)


@auth_bp.post("/api/auth/avatar")
@login_required
def api_auth_avatar_upload():
    """Upload de la photo de profil utilisateur (v27.7)."""
    uid = session.get("user_id")
    f = request.files.get("avatar")
    if not f or not f.filename:
        return jsonify(ok=False, error="Aucun fichier fourni"), 400
    ok_upload, err_upload = _validate_upload(f, "image")
    if not ok_upload:
        return jsonify(ok=False, error=err_upload[0]), err_upload[1]
    ext = os.path.splitext(f.filename)[1].lower()
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


@auth_bp.get("/api/auth/avatar/<int:user_id>")
@login_required
def api_auth_avatar_serve(user_id):
    """Sert la photo de profil d'un utilisateur (v27.7).

    Note sécu (v32.67) : flaggé IDOR par l'audit du 19 mai 2026 — n'importe
    quel user authentifié peut lire l'avatar de tous les autres users. En
    contexte mono-tenant (1 instance = 1 entreprise), c'est volontaire : les
    collègues doivent voir les avatars de leurs collègues (commentaires,
    timeline, etc.). Si un jour on ouvre le SaaS multi-tenant strict, ajouter
    ici un check `user_id == _uid() or _shares_org(user_id, _uid())`."""
    from flask import send_file as _send_file
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        fpath = AVATARS_DIR / f"avatar_{user_id}{ext}"
        if fpath.exists():
            return _send_file(str(fpath))
    return jsonify(ok=False, error="Aucun avatar"), 404


@auth_bp.post("/api/auth/onboarding-seen")
@login_required
def api_auth_onboarding_seen():
    """Marque la visite guidée / popup bienvenue comme vue pour l'utilisateur connecté."""
    uid = session.get("user_id")
    if not uid:
        return jsonify(ok=False), 401
    with _auth_conn() as conn:
        conn.execute("UPDATE users SET onboarding_seen=1 WHERE id=?;", (uid,))
    return jsonify(ok=True)


@auth_bp.post("/api/auth/logout")
def api_auth_logout():
    log_activity('logout')
    session.clear()
    return jsonify(ok=True)


# ── JWT endpoints (v24.0 — mobile app) ────────────────────────────

@auth_bp.post("/api/auth/token")
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


@auth_bp.post("/api/auth/refresh")
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


@auth_bp.post("/api/auth/revoke")
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


@auth_bp.post("/api/auth/change-password")
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
        # v32.67 : invalider tous les refresh tokens du user après changement
        # de mdp. Sinon un attaquant qui avait volé un refresh token reste actif
        # pendant 30 j même après que la victime ait reset son mot de passe.
        conn.execute("UPDATE refresh_tokens SET revoked=1 WHERE user_id=?;", (uid,))
    return jsonify(ok=True)
