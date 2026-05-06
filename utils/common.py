"""ProspUp — petits helpers utilitaires sans état.

Fonctions pures (pas de DB, pas de logger) regroupées ici pour éviter la
pollution du namespace global de app.py.
"""
from __future__ import annotations

import datetime
import re
import sqlite3
from typing import Any, Dict
from urllib.parse import urlparse


def _now_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _today_iso() -> str:
    return datetime.date.today().isoformat()


def _row_to_dict(row) -> Dict[str, Any] | None:
    """Convert sqlite3.Row to dict safely. Returns None if row is None."""
    if row is None:
        return None
    if isinstance(row, sqlite3.Row):
        return dict(row)
    if isinstance(row, dict):
        return row
    try:
        return dict(row)
    except Exception:
        return None


def _parse_linkedin_name(url: str) -> str | None:
    """Extrait nom/prénom depuis une URL LinkedIn /in/slug.

    Retourne None pour les autres formats. Supprime le suffixe d'ID numérique
    LinkedIn (ex. les 8+ chiffres ajoutés en fin de slug).
    """
    try:
        path = urlparse(url).path
        m = re.search(r'/in/([^/?#]+)', path)
        if not m:
            return None
        parts = [p for p in m.group(1).strip('/').split('-') if p]
        if parts and re.fullmatch(r'\d{4,}', parts[-1]):
            parts.pop()
        if not parts:
            return None
        return ' '.join(p.capitalize() for p in parts)
    except Exception:
        return None
