#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Reset du mot de passe d'un utilisateur (par défaut : admin).

Usage :
  python scripts/reset_admin_password.py
      → reset admin / admin (avec confirmation)
  python scripts/reset_admin_password.py --user antoine --password "mon_nouveau_mdp"
      → reset le user "antoine" avec le mot de passe fourni
  python scripts/reset_admin_password.py --yes
      → skip la confirmation interactive
  python scripts/reset_admin_password.py --list
      → liste les users actifs sans rien modifier

Toujours :
  - Crée un backup horodaté de la DB dans data/backups/ avant modification.
  - Affiche le résultat de la mise à jour.
"""

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

from config import DB_PATH  # noqa: E402

try:
    from werkzeug.security import generate_password_hash
except ImportError:
    print("[ERREUR] werkzeug n'est pas installé. Lance : pip install -r requirements.txt")
    sys.exit(2)


def backup_db() -> Path:
    backups_dir = APP_DIR / "data" / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = backups_dir / f"prospects_before_password_reset_{stamp}.db"
    shutil.copy2(DB_PATH, dest)
    return dest


def list_users() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, username, display_name, role, is_active, lastLoginAt "
        "FROM users ORDER BY id;"
    ).fetchall()
    conn.close()
    if not rows:
        print("(aucun utilisateur dans la DB)")
        return
    print(f"{'ID':>3}  {'USERNAME':<20} {'ROLE':<8} {'ACTIF':<6} {'DERNIER LOGIN':<20} DISPLAY NAME")
    print("-" * 90)
    for r in rows:
        print(
            f"{r['id']:>3}  {r['username']:<20} {r['role']:<8} "
            f"{('oui' if r['is_active'] else 'non'):<6} "
            f"{(r['lastLoginAt'] or '-'):<20} {r['display_name'] or ''}"
        )


def reset_password(username: str, new_password: str, skip_confirm: bool) -> int:
    if not DB_PATH.exists():
        print(f"[ERREUR] DB introuvable : {DB_PATH}")
        return 2

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    user = conn.execute(
        "SELECT id, username, role, is_active FROM users WHERE LOWER(username)=?;",
        (username.lower(),),
    ).fetchone()

    if not user:
        print(f"[ERREUR] User '{username}' introuvable. Liste des users :")
        conn.close()
        list_users()
        return 1

    print(f"DB cible        : {DB_PATH}")
    print(f"User trouvé     : id={user['id']} username={user['username']} "
          f"role={user['role']} actif={'oui' if user['is_active'] else 'non'}")
    print(f"Nouveau mdp     : {'*' * len(new_password)} ({len(new_password)} car.)")

    if not skip_confirm:
        ans = input("Confirmer le reset ? [o/N] : ").strip().lower()
        if ans not in ("o", "oui", "y", "yes"):
            print("Annulé.")
            conn.close()
            return 0

    backup = backup_db()
    print(f"Backup DB créé  : {backup}")

    new_hash = generate_password_hash(new_password)
    conn.execute(
        "UPDATE users SET password_hash=?, must_change_password=1, is_active=1 WHERE id=?;",
        (new_hash, user["id"]),
    )
    conn.commit()
    conn.close()

    print(f"[OK] Mot de passe réinitialisé pour '{user['username']}'.")
    print("     `must_change_password=1` posé : tu seras invité à le changer "
          "dès la prochaine connexion.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset du mot de passe d'un utilisateur ProspUp.")
    parser.add_argument("--user", default="admin", help="username à reset (défaut: admin)")
    parser.add_argument("--password", default="admin",
                        help="nouveau mot de passe (défaut: admin — à changer après login)")
    parser.add_argument("--yes", action="store_true", help="skip la confirmation interactive")
    parser.add_argument("--list", action="store_true", help="liste les utilisateurs et quitte")
    args = parser.parse_args()

    if args.list:
        list_users()
        return 0

    return reset_password(args.user, args.password, args.yes)


if __name__ == "__main__":
    sys.exit(main())
