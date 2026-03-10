#!/usr/bin/env python3
"""
Script de diagnostic pour vérifier si prospup.work est à jour.

Usage:
    python scripts/check_deployment.py
    python scripts/check_deployment.py --url https://prospup.work
"""

from __future__ import annotations

import sys
import subprocess
import urllib.request
import urllib.error
import json
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent


def get_local_commit() -> tuple[str, str]:
    """Récupère le hash et la date du dernier commit local."""
    try:
        cp = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        commit_hash = (cp.stdout or "").strip()[:7] if cp.returncode == 0 else "unknown"
        
        cp2 = subprocess.run(
            ["git", "log", "-1", "--format=%ci", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        commit_date = (cp2.stdout or "").strip() if cp2.returncode == 0 else ""
        
        return commit_hash, commit_date
    except Exception as e:
        print(f"❌ Erreur récupération commit local: {e}")
        return "unknown", ""


def get_remote_commit(url: str) -> dict | None:
    """Récupère les infos de version depuis prospup.work."""
    try:
        api_url = f"{url.rstrip('/')}/api/app-version"
        req = urllib.request.Request(api_url)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok"):
                return {
                    "version": data.get("version", "?"),
                    "commit_hash": data.get("commit_hash", "unknown"),
                    "commit_date": data.get("commit_date", ""),
                    "badge_color": data.get("badge_color", "#64748b"),
                }
    except urllib.error.HTTPError as e:
        print(f"❌ Erreur HTTP {e.code}: {e.reason}")
        return None
    except urllib.error.URLError as e:
        print(f"❌ Erreur connexion: {e.reason}")
        print(f"   Vérifiez que {url} est accessible et que le serveur tourne.")
        return None
    except Exception as e:
        print(f"❌ Erreur: {e}")
        return None
    return None


def force_pull_remote(url: str, username: str, password: str) -> dict | None:
    """Force un git pull à distance via l'API (nécessite authentification admin)."""
    try:
        # D'abord se connecter pour obtenir la session
        login_url = f"{url.rstrip('/')}/api/auth/login"
        login_data = json.dumps({"username": username, "password": password}).encode("utf-8")
        req_login = urllib.request.Request(login_url, data=login_data, headers={"Content-Type": "application/json"})
        
        import http.cookiejar
        cookie_jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
        
        try:
            resp_login = opener.open(req_login, timeout=10)
            if resp_login.getcode() != 200:
                return None
        except Exception:
            return None
        
        # Appeler l'API deploy/pull
        pull_url = f"{url.rstrip('/')}/api/deploy/pull"
        req_pull = urllib.request.Request(pull_url, method="POST", headers={"Content-Type": "application/json"})
        resp_pull = opener.open(req_pull, timeout=15)
        data = json.loads(resp_pull.read().decode("utf-8"))
        return data
    except Exception as e:
        return {"ok": False, "error": str(e)}


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Vérifie si prospup.work est à jour")
    parser.add_argument("--url", default="https://prospup.work", help="URL de prospup.work")
    parser.add_argument("--force-pull", action="store_true", help="Forcer un git pull à distance (nécessite --user et --pass)")
    parser.add_argument("--user", help="Nom d'utilisateur admin pour --force-pull")
    parser.add_argument("--pass", dest="password", help="Mot de passe admin pour --force-pull")
    args = parser.parse_args()
    
    print("🔍 Diagnostic déploiement ProspUp\n")
    print(f"URL cible: {args.url}\n")
    
    # Récupérer commit local
    local_hash, local_date = get_local_commit()
    print(f"📦 Commit local:")
    print(f"   Hash: {local_hash}")
    print(f"   Date: {local_date}\n")
    
    # Récupérer infos depuis prospup.work
    print(f"🌐 Récupération depuis {args.url}...")
    remote_info = get_remote_commit(args.url)
    
    if not remote_info:
        print("\n❌ Impossible de récupérer les infos depuis le serveur.")
        print("   Vérifiez que:")
        print("   - Le serveur tourne sur prospup.work")
        print("   - L'URL est correcte")
        print("   - Vous êtes connecté à Internet")
        if args.force_pull:
            print("\n   ⚠️  --force-pull nécessite que l'endpoint /api/app-version soit accessible")
        return 1
    
    print(f"\n📦 Commit sur {args.url}:")
    print(f"   Version: {remote_info['version']}")
    print(f"   Hash: {remote_info['commit_hash']}")
    print(f"   Date: {remote_info['commit_date']}")
    print(f"   Couleur badge: {remote_info['badge_color']}\n")
    
    # Comparaison
    if local_hash == "unknown":
        print("⚠️  Impossible de déterminer le commit local (pas un dépôt git ?)")
        return 0
    
    if remote_info['commit_hash'] == "unknown":
        print("⚠️  Le serveur n'a pas pu déterminer son commit (git non disponible ?)")
        return 0
    
    if local_hash == remote_info['commit_hash']:
        print("✅ prospup.work est à jour !")
        print(f"   Les deux sont sur le commit {local_hash}")
        return 0
    else:
        print("⚠️  prospup.work n'est PAS à jour")
        print(f"   Local:  {local_hash}")
        print(f"   Remote: {remote_info['commit_hash']}")
        
        # Option force-pull
        if args.force_pull:
            if not args.user or not args.password:
                print("\n❌ --force-pull nécessite --user et --pass")
                return 1
            print(f"\n🔄 Tentative de pull forcé à distance...")
            result = force_pull_remote(args.url, args.user, args.password)
            if result and result.get("ok"):
                if result.get("updated"):
                    print("✅ Pull réussi ! Le serveur va redémarrer dans quelques secondes.")
                    print(f"   {result.get('message', '')}")
                else:
                    print("ℹ️  Le serveur était déjà à jour.")
                return 0
            else:
                error = result.get("error", "Erreur inconnue") if result else "Impossible de se connecter"
                print(f"❌ Échec du pull forcé: {error}")
                print("   Vérifiez vos identifiants admin et que la route /api/deploy/pull existe")
                return 1
        else:
            print("\n   Actions possibles:")
            print("   1. Attendre que le superviseur fasse le pull automatique (max 90s)")
            print("   2. Sur le PC qui héberge prospup.work, faire: git pull origin main")
            print("   3. Utiliser --force-pull avec --user et --pass pour forcer à distance")
        return 1


if __name__ == "__main__":
    sys.exit(main())
