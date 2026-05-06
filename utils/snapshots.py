"""ProspUp — snapshots SQLite (sauvegarde/restauration locale).

Utilisé par le flux de déploiement (`routes/deploy.py`) pour faire un point
de sauvegarde avant chaque mise à jour, et par les routes admin de gestion
manuelle des snapshots.
"""
from __future__ import annotations

import datetime
import sqlite3
from pathlib import Path
from typing import Any, Dict, List

from config import DB_PATH, SNAPSHOT_DIR


def create_snapshot(label: str = "manual", is_auto: bool = False, source_db: Path | None = None) -> str:
    """Snapshot de la DB. source_db permet de cibler une DB spécifique (sinon DB admin)."""
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    safe = "".join(ch for ch in label if ch.isalnum() or ch in ("-", "_"))[:40] or "snapshot"
    filename = f"{safe}_{ts}.db"
    path = SNAPSHOT_DIR / filename

    db_to_snapshot = source_db or DB_PATH
    src = sqlite3.connect(db_to_snapshot)
    try:
        dst = sqlite3.connect(path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()

    return filename


def list_snapshots() -> List[Dict[str, Any]]:
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    out = []
    for p in sorted(SNAPSHOT_DIR.glob("*.db"), key=lambda x: x.stat().st_mtime, reverse=True):
        st = p.stat()
        out.append(
            {
                "filename": p.name,
                "size": st.st_size,
                "mtime": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                "modifiedAt": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
            }
        )
    return out


def _is_safe_snapshot_name(filename: str) -> bool:
    if not filename:
        return False
    fn = str(filename).strip()
    if any(x in fn for x in ("/", "\\", "..")):
        return False
    if not fn.endswith(".db"):
        return False
    return True


def _snapshot_path(filename: str) -> Path:
    """Returns the normalized path inside SNAPSHOT_DIR (or raises ValueError)."""
    if not _is_safe_snapshot_name(filename):
        raise ValueError("invalid snapshot filename")
    p = (SNAPSHOT_DIR / filename).resolve()
    base = SNAPSHOT_DIR.resolve()
    if base not in p.parents and p != base:
        raise ValueError("invalid snapshot path")
    return p


def restore_snapshot(filename: str) -> None:
    snap = _snapshot_path(filename)
    if not snap.exists():
        raise FileNotFoundError(filename)

    # Safety snapshot before restore
    try:
        create_snapshot(label="before_restore", is_auto=False)
    except Exception:
        pass

    src = sqlite3.connect(snap)
    try:
        dst = sqlite3.connect(DB_PATH)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
