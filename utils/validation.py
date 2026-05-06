"""ProspUp — helpers de validation d'entrée et exécution SQL sécurisée."""
from __future__ import annotations

import logging
import re
import sqlite3
from typing import Any, Dict

logger = logging.getLogger("prospup")


def _validate_positive_int(value: Any, param_name: str = "id") -> int:
    """Valide qu'une valeur est un entier positif. Lève ValueError si invalide."""
    if value is None:
        raise ValueError(f"{param_name} est requis")
    try:
        int_val = int(value)
        if int_val <= 0:
            raise ValueError(f"{param_name} doit être un entier positif")
        return int_val
    except (ValueError, TypeError) as e:
        if isinstance(e, ValueError) and "doit être" in str(e):
            raise
        raise ValueError(f"{param_name} doit être un entier valide") from e


def _validate_optional_positive_int(value: Any, param_name: str = "id") -> int | None:
    """Valide qu'une valeur est None ou un entier positif. Retourne None ou l'entier."""
    if value is None or value == "" or value == "null":
        return None
    try:
        int_val = int(value)
        if int_val <= 0:
            return None
        return int_val
    except (ValueError, TypeError):
        return None


def _safe_row_to_dict(row: sqlite3.Row | None) -> Dict[str, Any] | None:
    """Convertit un sqlite3.Row en dict de manière sécurisée. Retourne None si row est None."""
    if row is None:
        return None
    try:
        return dict(row)
    except Exception:
        return None


def _safe_execute_insert(conn: sqlite3.Connection, query: str, params: tuple) -> int:
    """Exécute une insertion. Retourne lastrowid. Lève Exception en cas d'erreur."""
    try:
        cur = conn.cursor()
        cur.execute(query, params)
        return cur.lastrowid
    except sqlite3.OperationalError as e:
        logger.error("Erreur insertion DB: %s", e)
        raise
    except Exception as e:
        logger.error("Erreur inattendue insertion DB: %s", e)
        raise


def _safe_execute_update(conn: sqlite3.Connection, query: str, params: tuple) -> None:
    """Exécute une mise à jour. Lève Exception en cas d'erreur."""
    try:
        conn.execute(query, params)
    except sqlite3.OperationalError as e:
        logger.error("Erreur mise à jour DB: %s", e)
        raise
    except Exception as e:
        logger.error("Erreur inattendue mise à jour DB: %s", e)
        raise


def _check_table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    """Vérifie si une table existe. Sécurisé contre injection SQL via validation du nom."""
    if not table_name or not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', table_name):
        logger.warning("Nom de table invalide pour _check_table_exists: %s", table_name)
        return False
    try:
        conn.execute(f"SELECT 1 FROM {table_name} LIMIT 1").fetchone()
        return True
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower():
            return False
        raise
