#!/usr/bin/env python3
"""
RESTORE_DB.py — Restaure les données manquantes depuis la base originale.
Lance ce script UNE SEULE FOIS après le premier pull v19.

Usage: python RESTORE_DB.py
"""
import sqlite3
import os
import sys
import shutil
from pathlib import Path

DB_PATH = Path(__file__).parent / "prospects.db"

if not DB_PATH.exists():
    print("❌ prospects.db introuvable. Lancez d'abord l'app (python app.py) pour créer la base.")
    sys.exit(1)

# Backup first
backup = DB_PATH.with_suffix('.db.backup_restore')
shutil.copy2(DB_PATH, backup)
print(f"📦 Backup créé: {backup}")

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# Get admin id
admin = conn.execute("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").fetchone()
admin_id = admin['id'] if admin else 1
print(f"👤 Admin ID: {admin_id}")

# Fix all NULL owner_id
total = 0
for tbl in ("prospects", "candidates", "tasks", "saved_views", "push_logs"):
    try:
        n = conn.execute(f"UPDATE {tbl} SET owner_id=? WHERE owner_id IS NULL", (admin_id,)).rowcount
        if n > 0:
            print(f"  ✅ {tbl}: {n} enregistrements corrigés (owner_id → {admin_id})")
            total += n
    except Exception:
        pass

if total > 0:
    conn.commit()
    print(f"\n✅ {total} enregistrements corrigés au total")
else:
    print("\n✅ Tous les enregistrements ont déjà un owner_id — rien à corriger")

# Show counts
for tbl in ("prospects", "companies", "candidates", "tasks"):
    try:
        n = conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
        owned = conn.execute(f"SELECT COUNT(*) FROM {tbl} WHERE owner_id=?", (admin_id,)).fetchone()[0] if tbl != "companies" else n
        print(f"  📊 {tbl}: {n} total ({owned} à admin)")
    except Exception:
        pass

conn.close()
print("\n🎉 Terminé ! Relancez PROSPUP.bat pour vérifier.")
