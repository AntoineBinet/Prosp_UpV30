#!/usr/bin/env python3
"""
Surveillance Prosp'Up : vérifie toutes les 15 minutes que l'application répond.
Si la requête GET échoue (timeout, status != 200), relance la commande configurée.

Variables d'environnement (optionnel) :
  PROSPUP_WATCH_URL   : URL à tester (défaut https://prospup.work ou http://127.0.0.1:8000)
  PROSPUP_WATCH_CMD   : Commande de relance (défaut: python app.py --prod)
  PROSPUP_WATCH_DIR   : Répertoire de travail pour la relance (défaut: répertoire parent du script)
  PROSPUP_WATCH_INTERVAL : Intervalle en secondes (défaut: 900 = 15 min)
  PROSPUP_WATCH_TIMEOUT  : Timeout du GET en secondes (défaut: 10)

Usage :
  python scripts/watch-prospup.py           # Une vérification puis sortie
  python scripts/watch-prospup.py --loop   # Boucle toutes les 15 min
"""
from __future__ import annotations

import os
import sys
import time
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

def _log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def check_url(url: str, timeout: int = 10) -> bool:
    """Retourne True si GET url renvoie 200, False sinon."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception as e:
        _log(f"Check failed: {e}")
        return False

def run_restart(cmd: str, cwd: str | None) -> bool:
    """Exécute la commande de relance. Retourne True si le processus a été lancé."""
    _log(f"Restarting: {cmd} (cwd={cwd or '.'})")
    try:
        subprocess.Popen(
            cmd,
            shell=True,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _log("Restart command started.")
        return True
    except Exception as e:
        _log(f"Restart failed: {e}")
        return False

def main() -> None:
    loop = "--loop" in sys.argv
    url = os.environ.get("PROSPUP_WATCH_URL", "https://prospup.work").strip()
    if not url.startswith("http"):
        url = "http://127.0.0.1:8000"
    cmd = os.environ.get("PROSPUP_WATCH_CMD", "python app.py --prod").strip()
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    cwd = os.environ.get("PROSPUP_WATCH_DIR", str(project_root)).strip() or str(project_root)
    interval = max(60, int(os.environ.get("PROSPUP_WATCH_INTERVAL", "900")))
    timeout = max(3, int(os.environ.get("PROSPUP_WATCH_TIMEOUT", "10")))

    _log(f"URL={url} interval={interval}s timeout={timeout}s loop={loop}")

    while True:
        if check_url(url, timeout=timeout):
            _log("OK")
        else:
            _log("Down — triggering restart")
            run_restart(cmd, cwd)
        if not loop:
            break
        time.sleep(interval)

if __name__ == "__main__":
    main()
