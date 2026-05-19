#!/usr/bin/env python3
"""
Synchronisation automatique ProspUp avec GitHub.
- Vérifie GitHub toutes les 30 secondes (git fetch + comparaison).
- Effectue un git pull si des changements sont détectés.
- Relance l'application ProspUp si des mises à jour ont été appliquées.

Variables d'environnement (optionnel) :
  PROSPUP_SYNC_INTERVAL : Intervalle en secondes entre deux vérifications (défaut: 30)
  PROSPUP_SYNC_DIR      : Répertoire du projet (défaut: parent du script)
  PROSPUP_RESTART_CMD   : Commande pour relancer l'app après un pull (défaut: python app.py --prod)
  PROSPUP_SYNC_RESTART  : 1 ou true pour relancer l'app après un pull (défaut: 1)

Usage :
  python scripts/auto_sync_pc.py   # Tourne en continu, affiche les mises à jour
"""
from __future__ import annotations

import os
import sys
import time
import subprocess
from pathlib import Path


def _log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _run(cmd: list[str], cwd: str) -> subprocess.CompletedProcess:
    """Exécute une commande et retourne le résultat."""
    return subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=60,
    )


def get_current_rev(cwd: str) -> str | None:
    """Retourne le hash du commit actuel (HEAD)."""
    r = _run(["git", "rev-parse", "HEAD"], cwd)
    if r.returncode != 0:
        return None
    return (r.stdout or "").strip()


def fetch_and_get_remote_rev(cwd: str) -> str | None:
    """Fait git fetch puis retourne le hash du commit sur la branche suivie (ex: origin/main)."""
    _run(["git", "fetch", "origin"], cwd)
    r = _run(["git", "rev-parse", "HEAD@{upstream}"], cwd)
    if r.returncode != 0:
        # fallback: origin/HEAD ou branche courante
        r = _run(["git", "rev-parse", "origin/HEAD"], cwd)
    if r.returncode != 0:
        return None
    return (r.stdout or "").strip()


def pull(cwd: str) -> bool:
    """Effectue git pull. Retourne True en cas de succès."""
    _log("git pull en cours...")
    r = _run(["git", "pull"], cwd)
    if r.returncode != 0:
        _log(f"git pull échec: {r.stderr or r.stdout}")
        return False
    out = (r.stdout or "").strip()
    if out:
        _log(out)
    _log("Mise à jour appliquée.")
    return True


# v32.68 — Mêmes commandes que supervise_prospup.py
_ALLOWED_RESTART_COMMANDS = {
    "python app.py --production",
    "python app.py --prod",
    "python app.py",
    "py app.py --production",
    "py app.py --prod",
    "py app.py",
}


def run_restart(cmd: str, cwd: str) -> None:
    """Lance la commande de relance en arrière-plan (whitelist stricte v32.68)."""
    safe = (cmd or "").strip()
    if safe not in _ALLOWED_RESTART_COMMANDS:
        _log(f"PROSPUP_RESTART_CMD={safe!r} hors whitelist — fallback sur défaut.")
        safe = "python app.py --prod"
    _log(f"Relance de l'application: {safe}")
    try:
        subprocess.Popen(
            safe.split(),  # shell=False
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _log("Application relancée.")
    except Exception as e:
        _log(f"Erreur relance: {e}")


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    project_root = Path(os.environ.get("PROSPUP_SYNC_DIR", str(script_dir.parent)))
    cwd = str(project_root)
    interval = max(10, int(os.environ.get("PROSPUP_SYNC_INTERVAL", "30")))
    restart_cmd = os.environ.get("PROSPUP_RESTART_CMD", "python app.py --prod").strip()
    do_restart = os.environ.get("PROSPUP_SYNC_RESTART", "1").strip().lower() in ("1", "true", "yes")

    _log(f"Dossier projet: {cwd}")
    _log(f"Vérification toutes les {interval} secondes. Relance après pull: {do_restart}")

    while True:
        try:
            head = get_current_rev(cwd)
            remote = fetch_and_get_remote_rev(cwd)
            if head is None or remote is None:
                _log("Impossible de lire les révisions git, on continue.")
                time.sleep(interval)
                continue
            if head != remote:
                _log("Changements détectés sur GitHub.")
                if pull(cwd):
                    if do_restart and restart_cmd:
                        run_restart(restart_cmd, cwd)
            else:
                _log("À jour.")
        except Exception as e:
            _log(f"Erreur: {e}")
        time.sleep(interval)


if __name__ == "__main__":
    main()
