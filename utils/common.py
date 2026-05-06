"""ProspUp — petits helpers utilitaires sans état.

Fonctions pures (pas de DB, pas de logger) regroupées ici pour éviter la
pollution du namespace global de app.py.
"""
from __future__ import annotations

import datetime
import sqlite3
from typing import Any, Dict


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
