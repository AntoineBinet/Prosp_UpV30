#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de nettoyage des utilisateurs de test.

Identifie et supprime les utilisateurs de test basés sur des critères :
- Username contient "test", "demo", "fake", "temp"
- Créés il y a moins de 7 jours avec moins de 5 prospects
"""

import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
import sqlite3

# Ajouter le répertoire parent au path pour importer app
APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

from app import _auth_conn, DATA_DIR, _user_db_path

def is_test_user(username: str, created_at: str, user_id: int) -> tuple[bool, str]:
    """Détermine si un utilisateur est un utilisateur de test.
    Retourne (is_test, reason)."""
    username_lower = (username or "").lower()
    
    # Critère 1 : username contient des mots-clés de test
    test_keywords = ["test", "demo", "fake", "temp", "temporary", "essai"]
    if any(kw in username_lower for kw in test_keywords):
        return True, f"Username contient un mot-clé de test: {username}"
    
    # Critère 2 : créé récemment avec peu de données
    try:
        if created_at:
            created = datetime.fromisoformat(created_at.replace("Z", "+00:00").split(".")[0])
            days_old = (datetime.now() - created.replace(tzinfo=None)).days
            
            if days_old < 7:
                # Vérifier le nombre de prospects
                user_db = _user_db_path(user_id)
                if user_db.exists():
                    try:
                        conn = sqlite3.connect(user_db)
                        conn.row_factory = sqlite3.Row
                        count = conn.execute(
                            "SELECT COUNT(*) AS n FROM prospects WHERE deleted_at IS NULL;"
                        ).fetchone()["n"]
                        conn.close()
                        
                        if count < 5:
                            return True, f"Créé il y a {days_old} jours avec seulement {count} prospect(s)"
                    except Exception:
                        pass
    
    except Exception:
        pass
    
    return False, ""

def list_test_users(dry_run: bool = True) -> list:
    """Liste les utilisateurs de test."""
    test_users = []
    
    with _auth_conn() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, role, createdAt FROM users WHERE is_active=1 ORDER BY id;"
        ).fetchall()
        
        for row in rows:
            user_id = row["id"]
            username = row["username"] or ""
            display_name = row["display_name"] or username
            created_at = row.get("createdAt")
            
            is_test, reason = is_test_user(username, created_at, user_id)
            if is_test:
                test_users.append({
                    "id": user_id,
                    "username": username,
                    "display_name": display_name,
                    "role": row.get("role", "editor"),
                    "created_at": created_at,
                    "reason": reason
                })
    
    return test_users

def delete_test_user(user_id: int) -> bool:
    """Supprime un utilisateur de test via l'API."""
    # On ne peut pas appeler directement l'endpoint, donc on fait la suppression manuellement
    # en réutilisant la logique de api_users_delete
    from app import logger
    
    try:
        with _auth_conn() as conn:
            user = conn.execute(
                "SELECT id, username, display_name FROM users WHERE id=?;",
                (user_id,)
            ).fetchone()
            if not user:
                return False
            
            username = user.get("username") or user.get("display_name") or f"user_{user_id}"
            
            # Nettoyer shared_companies
            conn.execute("DELETE FROM shared_companies WHERE from_user_id=? OR to_user_id=?;", (user_id, user_id))
            
            # Nettoyer audit_log
            conn.execute("DELETE FROM audit_log WHERE user_id=?;", (user_id,))
            
            # Nettoyer refresh_tokens
            conn.execute("DELETE FROM refresh_tokens WHERE user_id=?;", (user_id,))
            
            # Supprimer l'utilisateur
            conn.execute("DELETE FROM users WHERE id=?;", (user_id,))
            
            logger.info(f"Utilisateur de test {user_id} ({username}) supprimé")
        
        # Supprimer le dossier
        user_dir = DATA_DIR / f"user_{user_id}"
        if user_dir.exists():
            import shutil
            try:
                shutil.rmtree(user_dir)
            except Exception as e:
                logger.warning(f"Impossible de supprimer {user_dir}: {e}")
        
        return True
    except Exception as e:
        print(f"Erreur suppression user {user_id}: {e}")
        return False

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Nettoyer les utilisateurs de test")
    parser.add_argument("--execute", action="store_true", help="Exécuter la suppression (sinon dry-run)")
    parser.add_argument("--user-id", type=int, help="Supprimer un utilisateur spécifique par ID")
    args = parser.parse_args()
    
    if args.user_id:
        # Supprimer un utilisateur spécifique
        with _auth_conn() as conn:
            user = conn.execute(
                "SELECT id, username, display_name FROM users WHERE id=?;",
                (args.user_id,)
            ).fetchone()
            if not user:
                print(f"❌ Utilisateur {args.user_id} introuvable")
                return 1
            
            username = user.get("username") or user.get("display_name") or f"user_{args.user_id}"
            print(f"⚠️  Suppression de l'utilisateur {args.user_id} ({username})...")
            
            if args.execute:
                if delete_test_user(args.user_id):
                    print(f"✅ Utilisateur {args.user_id} supprimé")
                    return 0
                else:
                    print(f"❌ Erreur lors de la suppression")
                    return 1
            else:
                print("⚠️  Mode dry-run : utilisez --execute pour supprimer")
                return 0
    
    # Lister les utilisateurs de test
    test_users = list_test_users()
    
    if not test_users:
        print("✅ Aucun utilisateur de test trouvé")
        return 0
    
    print(f"🔍 {len(test_users)} utilisateur(s) de test trouvé(s):\n")
    for u in test_users:
        print(f"  - ID {u['id']}: {u['username']} ({u['display_name']})")
        print(f"    Raison: {u['reason']}")
        print(f"    Créé: {u['created_at'] or 'N/A'}")
        print()
    
    if args.execute:
        print("🗑️  Suppression en cours...")
        deleted = 0
        for u in test_users:
            if delete_test_user(u['id']):
                deleted += 1
                print(f"  ✅ {u['username']} supprimé")
            else:
                print(f"  ❌ Erreur suppression {u['username']}")
        print(f"\n✅ {deleted}/{len(test_users)} utilisateur(s) supprimé(s)")
    else:
        print("⚠️  Mode dry-run : utilisez --execute pour supprimer ces utilisateurs")
        print("   Exemple: python scripts/cleanup_test_users.py --execute")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
