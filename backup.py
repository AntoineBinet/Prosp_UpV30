"""
backup.py — Sauvegarde automatique SQLite pour ProspUp.
Lecture seule : ne modifie jamais la base de données.
"""
from __future__ import annotations

import gzip
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

APP_DIR = Path(__file__).resolve().parent
BACKUP_DIR = APP_DIR / "backups"
MAX_BACKUPS = 14  # 14 jours de rétention


def _resolve_db_path() -> Path:
    """Résout le chemin de la DB dans le même ordre que app.py."""
    env = os.environ.get("PROSPECTION_DB")
    if env:
        p = env.strip().strip('"')
        return Path(p)
    cfg = APP_DIR / "db_path.txt"
    if cfg.exists():
        try:
            p = cfg.read_text(encoding="utf-8").strip().strip('"')
        except Exception:
            p = cfg.read_text().strip().strip('"')
        if p:
            return Path(p)
    return APP_DIR / "prospects.db"


def create_backup() -> Optional[str]:
    """
    Copie la base SQLite dans backups/ avec horodatage.
    Compresse en .gz pour économiser l'espace.
    Applique la rotation (MAX_BACKUPS fichiers maximum).
    Retourne le chemin du backup créé, ou None en cas d'échec.
    """
    try:
        db_path = _resolve_db_path()
        BACKUP_DIR.mkdir(exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = BACKUP_DIR / f"prospup_{ts}.db.gz"
        with open(db_path, "rb") as f_in:
            with gzip.open(dest, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
        # Rotation : supprimer les plus anciens
        backups = sorted(BACKUP_DIR.glob("prospup_*.db.gz"))
        for old in backups[:-MAX_BACKUPS]:
            old.unlink()
        print(f"[Backup] Backup créé : {dest}")
        return str(dest)
    except Exception as e:
        print(f"[Backup] Erreur : {e}")
        return None


def list_backups() -> List[Dict[str, Any]]:
    """Retourne la liste des backups disponibles (du plus récent au plus ancien)."""
    BACKUP_DIR.mkdir(exist_ok=True)
    items: List[Dict[str, Any]] = []
    for p in sorted(BACKUP_DIR.glob("prospup_*.db.gz"), reverse=True):
        stat = p.stat()
        items.append({
            "name": p.name,
            "size": stat.st_size,
            "date": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })
    return items
