"""ProspUp v30 — Backup des DB avant migration additive.

Utilisation :
  python -m scripts.v30_backup              # backup manuel (CLI)
  from scripts.v30_backup import backup_all_databases  # depuis app.py

Crée data/backups/v30_migration/<YYYY-MM-DD_HHMMSS>/ avec :
  - prospects.db (DB principale)
  - auth.db (si présent)
  - user_<id>/prospects.db (par user)
  - manifest.json (liste + tailles + timestamps)

Retourne le chemin absolu du backup, ou None si rien à backuper.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
BACKUP_ROOT = DATA_DIR / "backups" / "v30_migration"


def _find_dbs() -> list[Path]:
    """Retourne la liste des fichiers .db à backuper (DB principale, auth, user_*)."""
    if not DATA_DIR.exists():
        return []
    dbs: list[Path] = []
    # DB principale + auth
    for name in ("prospects.db", "auth.db", "main.db"):
        p = DATA_DIR / name
        if p.exists() and p.is_file():
            dbs.append(p)
    # DB par user
    for user_dir in sorted(DATA_DIR.glob("user_*")):
        if not user_dir.is_dir():
            continue
        for f in user_dir.glob("*.db"):
            if f.is_file():
                dbs.append(f)
    return dbs


def backup_all_databases(reason: str = "v30_migration") -> str | None:
    """Copie toutes les DB trouvées dans un dossier horodaté.

    :param reason: étiquette libre (loggée dans manifest.json)
    :return: chemin str du dossier de backup, ou None si aucune DB trouvée
    """
    dbs = _find_dbs()
    if not dbs:
        print("[v30_backup] Aucune DB trouvée dans data/, skip.")
        return None

    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    dest_root = BACKUP_ROOT / stamp
    dest_root.mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    for src in dbs:
        rel = src.relative_to(DATA_DIR)
        dest = dest_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        src_size = src.stat().st_size
        size = dest.stat().st_size
        # Verification integrité : taille dest doit être ≥ taille source (egal, jamais moins)
        if size < src_size:
            raise RuntimeError(
                f"Backup {dest} plus petit que la source ({size} < {src_size})"
            )
        entry = {
            "src": str(src),
            "dest": str(dest),
            "rel": str(rel).replace("\\", "/"),
            "size": size,
            "copied_at": datetime.now().isoformat(timespec="seconds"),
        }
        manifest.append(entry)
        marker = "OK " if size > 0 else "OK (empty)"
        print(f"[v30_backup] {marker}  {rel}  ({size} bytes)  -> {dest}")

    meta = {
        "timestamp": stamp,
        "reason": reason,
        "count": len(manifest),
        "files": manifest,
    }
    (dest_root / "manifest.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[v30_backup] Manifest écrit : {dest_root / 'manifest.json'}")
    print(f"[v30_backup] Backup complet : {dest_root}")
    return str(dest_root)


def latest_backup() -> str | None:
    """Retourne le dernier backup v30_migration (ou None)."""
    if not BACKUP_ROOT.exists():
        return None
    subs = [p for p in BACKUP_ROOT.iterdir() if p.is_dir()]
    if not subs:
        return None
    subs.sort()
    return str(subs[-1])


if __name__ == "__main__":
    out = backup_all_databases(reason="manual_cli")
    if out is None:
        sys.exit(1)
    print(f"\nRollback : voir docs/ROLLBACK_V30.md")
    print(f"Source   : {out}")
