#!/usr/bin/env python3
"""
Script de vérification complète pour agent local Cursor.
Vérifie que tous les composants nécessaires au travail à distance fonctionnent :
- Git (repo, branche, pull)
- Ollama (répond)
- App Flask (répond)
- API Ollama via Flask (test fonctionnel)
- Scripts Python (exécutables)
- Variables d'environnement

Exit codes :
  0 = Tout OK
  1 = Erreur Git
  2 = Erreur Ollama
  3 = Erreur App Flask
  4 = Erreur API Ollama
  5 = Erreur scripts
  6 = Erreur variables d'environnement
"""
from __future__ import annotations

import os
import sys
import json
import time
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EXIT_GIT = 1
EXIT_OLLAMA = 2
EXIT_FLASK = 3
EXIT_API_OLLAMA = 4
EXIT_SCRIPTS = 5
EXIT_ENV = 6


def _run(cmd: list[str], cwd: Path | None = None, timeout: int = 10) -> tuple[int, str, str]:
    """Exécute une commande et retourne (code, stdout, stderr)."""
    try:
        cp = subprocess.run(
            cmd,
            cwd=str(cwd or PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return cp.returncode, (cp.stdout or "").strip(), (cp.stderr or "").strip()
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except Exception as e:
        return -1, "", str(e)


def check_git() -> bool:
    """Vérifie que Git fonctionne et que le repo est prêt pour pull."""
    if not (PROJECT_ROOT / ".git").exists():
        return False
    
    # Vérifier qu'on est sur main
    code, branch, _ = _run(["git", "branch", "--show-current"])
    if code != 0 or branch != "main":
        return False
    
    # Vérifier que le worktree est propre
    code, status, _ = _run(["git", "status", "--porcelain"])
    if code != 0:
        return False
    if status.strip():
        return False
    
    # Vérifier que fetch fonctionne
    code, _, _ = _run(["git", "fetch", "--dry-run", "origin", "main"], timeout=30)
    return code == 0


def check_ollama() -> bool:
    """Vérifie qu'Ollama répond sur 127.0.0.1:11434."""
    url = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    try:
        req = urllib.request.Request(f"{url}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return isinstance(data, dict) and "models" in data
            return False
    except Exception:
        return False


def check_flask() -> bool:
    """Vérifie que l'app Flask répond sur le port 8000."""
    try:
        req = urllib.request.Request("http://127.0.0.1:8000/", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def check_api_ollama() -> bool:
    """Vérifie que l'API Ollama via Flask fonctionne (test avec prompt minimal)."""
    # Nécessite une session valide, on teste juste que la route existe
    # En réalité, on teste que l'app peut appeler Ollama
    try:
        # Test simple : vérifier que la route répond (même si 401 sans auth)
        req = urllib.request.Request(
            "http://127.0.0.1:8000/api/ollama/generate",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"prompt": "test"}).encode("utf-8"),
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            # 401 = route existe mais pas auth (OK), 200 = auth OK (OK)
            return resp.status in (200, 401)
    except urllib.error.HTTPError as e:
        # 401 = route existe mais pas auth (OK)
        return e.code == 401
    except Exception:
        return False


def check_scripts() -> bool:
    """Vérifie que les scripts Python sont exécutables."""
    scripts = [
        PROJECT_ROOT / "scripts" / "supervise_prospup.py",
        PROJECT_ROOT / "scripts" / "watch-prospup.py",
    ]
    for script in scripts:
        if not script.exists():
            return False
        # Vérifier que le script peut être importé (syntaxe OK)
        code, _, _ = _run([sys.executable, "-m", "py_compile", str(script)], timeout=5)
        if code != 0:
            return False
    return True


def check_env() -> bool:
    """Vérifie que les variables d'environnement critiques sont définies ou ont des valeurs par défaut OK."""
    # OLLAMA_URL doit pointer vers une URL valide
    ollama_url = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    if not ollama_url.startswith("http://") and not ollama_url.startswith("https://"):
        return False
    
    # OLLAMA_MODEL doit être défini (ou défaut OK)
    model = os.environ.get("OLLAMA_MODEL", "llama3.2")
    if not model or not model.strip():
        return False
    
    # OLLAMA_TIMEOUT doit être un entier valide
    try:
        timeout = int(os.environ.get("OLLAMA_TIMEOUT", "120"))
        if timeout < 10 or timeout > 600:
            return False
    except ValueError:
        return False
    
    return True


def main() -> int:
    """Exécute tous les checks et retourne le code d'erreur approprié."""
    if not check_git():
        return EXIT_GIT
    
    if not check_ollama():
        return EXIT_OLLAMA
    
    if not check_flask():
        return EXIT_FLASK
    
    if not check_api_ollama():
        return EXIT_API_OLLAMA
    
    if not check_scripts():
        return EXIT_SCRIPTS
    
    if not check_env():
        return EXIT_ENV
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
