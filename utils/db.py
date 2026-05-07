"""ProspUp — connexions SQLite (DB centrale + DB per-user).

Le module isole la logique d'ouverture de connexions, la résolution du chemin
DB par utilisateur, et la décision DB principale vs per-user. Tous les
appelants passent par `_conn()` (utilisateur courant), `_auth_conn()` (DB
centrale auth/users) ou `_conn_for_user(uid)` (admin viewing).
"""
from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

from flask import session

from config import DATA_DIR, DB_PATH

logger = logging.getLogger("prospup")


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
    try:
        probe = sqlite3.connect(user_db)
        try:
            for tbl in ("prospects", "companies", "candidates"):
                try:
                    n = probe.execute(f"SELECT COUNT(*) FROM {tbl};").fetchone()[0]
                    if n and n > 0:
                        return user_db
                except sqlite3.OperationalError:
                    continue
        finally:
            probe.close()
    except Exception as exc:
        logger.warning("Probe per-user DB %s a échoué : %s — fallback DB_PATH", user_db, exc)
        return DB_PATH
    return DB_PATH


def _conn_for_user(user_id: int) -> sqlite3.Connection:
    """Connexion à la DB d'un utilisateur spécifique (admin viewing another user's data)."""
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


def _sidebar_counts(uid=None) -> dict:
    """Retourne {prospects, entreprises, candidats} pour la sidebar v30."""
    if uid is None:
        try:
            uid = session.get("user_id")
        except RuntimeError:
            return {}
    if not uid:
        return {}
    try:
        with _conn() as conn:
            return {
                "prospects": conn.execute(
                    "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='') "
                    "AND (is_archived IS NULL OR is_archived=0);", (uid,)
                ).fetchone()[0],
                "entreprises": conn.execute(
                    "SELECT COUNT(*) FROM companies WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='');", (uid,)
                ).fetchone()[0],
                "candidats": conn.execute(
                    "SELECT COUNT(*) FROM candidates WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='');", (uid,)
                ).fetchone()[0],
            }
    except Exception:
        return {}
