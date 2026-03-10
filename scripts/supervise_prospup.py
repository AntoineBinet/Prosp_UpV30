#!/usr/bin/env python3
"""
Superviseur ProspUp:
- lance le serveur Flask/Waitress,
- surveille le processus et le relance automatiquement en cas de crash,
- redémarre le serveur si l'application demande un redémarrage (code 42).

Note: Le pull automatique a été désactivé. Utilisez le bouton "Mettre à jour et redémarrer"
dans les paramètres de l'application (section admin) pour déclencher manuellement un pull.

Variables d'environnement (optionnel):
  PROSPUP_APP_CMD                Commande serveur (défaut: python app.py --production)
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _log(message: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def _run(cmd: list[str], *, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        check=check,
    )


def _is_git_repo() -> bool:
    return (PROJECT_ROOT / ".git").exists()


def _git_rev(ref: str) -> str:
    cp = _run(["git", "rev-parse", ref])
    if cp.returncode != 0:
        return ""
    return (cp.stdout or "").strip()


def _current_branch() -> str:
    cp = _run(["git", "branch", "--show-current"])
    if cp.returncode != 0:
        return ""
    return (cp.stdout or "").strip()


def _is_worktree_clean() -> bool:
    cp = _run(["git", "status", "--porcelain"])
    if cp.returncode != 0:
        return False
    return not (cp.stdout or "").strip()


def _ensure_deploy_branch(branch: str) -> bool:
    """Tente de se placer sur la branche de déploiement; False si impossible."""
    cur = _current_branch()
    if cur == branch:
        return True
    if not _is_worktree_clean():
        _log(f"[AUTO-DEPLOY] Branche actuelle '{cur}' et worktree non propre: checkout '{branch}' annulé.")
        return False
    cp = _run(["git", "checkout", branch])
    if cp.returncode != 0:
        _log(f"[AUTO-DEPLOY] Impossible de passer sur '{branch}': {(cp.stderr or cp.stdout).strip()}")
        return False
    _log(f"[AUTO-DEPLOY] Branche active basculée sur '{branch}'.")
    return True


def _is_ancestor(ancestor: str, descendant: str) -> bool:
    cp = _run(["git", "merge-base", "--is-ancestor", ancestor, descendant])
    return cp.returncode == 0


def _auto_pull(remote: str, branch: str) -> bool:
    """Retourne True si un pull a réellement mis à jour le code."""
    fetch = _run(["git", "fetch", "--prune", remote, branch])
    if fetch.returncode != 0:
        _log(f"[AUTO-DEPLOY] git fetch en échec: {(fetch.stderr or fetch.stdout).strip()}")
        return False

    local_ref = _git_rev("HEAD")
    remote_ref = _git_rev(f"{remote}/{branch}")
    if not local_ref or not remote_ref:
        return False
    if local_ref == remote_ref:
        return False

    if not _is_ancestor(local_ref, remote_ref):
        _log("[AUTO-DEPLOY] Branche divergente: fast-forward impossible (action manuelle requise).")
        return False

    pull = _run(["git", "pull", "--ff-only", remote, branch])
    if pull.returncode != 0:
        _log(f"[AUTO-DEPLOY] git pull en échec: {(pull.stderr or pull.stdout).strip()}")
        return False

    _log("[AUTO-DEPLOY] Nouvelle version détectée et appliquée (fast-forward).")
    return True


def _start_server(app_cmd: str) -> subprocess.Popen:
    env = os.environ.copy()
    # Conserve le contrat existant: app.py sort avec code 42 pour redémarrage.
    env["PROSPUP_LAUNCHER"] = "BAT"
    _log(f"[SERVER] Démarrage: {app_cmd}")
    return subprocess.Popen(
        app_cmd,
        cwd=str(PROJECT_ROOT),
        env=env,
        shell=True,
    )


def _stop_server(proc: subprocess.Popen, timeout_s: int = 20) -> None:
    if proc.poll() is not None:
        return
    _log("[SERVER] Redémarrage en cours: arrêt du processus serveur...")
    try:
        proc.terminate()
        proc.wait(timeout=timeout_s)
        return
    except Exception:
        pass
    try:
        proc.kill()
    except Exception:
        pass


def _as_bool(raw: str | None, default: bool = True) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    app_cmd = (os.environ.get("PROSPUP_APP_CMD") or "python app.py --production").strip()
    
    _log("[SUPERVISEUR] Démarrage du superviseur (pull automatique désactivé)")
    _log("[SUPERVISEUR] Pour mettre à jour, utilisez le bouton dans les paramètres de l'application")

    server = _start_server(app_cmd)

    try:
        while True:
            code = server.poll()
            if code is not None:
                if code == 42:
                    _log("[SERVER] Redémarrage demandé par l'application (code 42).")
                else:
                    _log(f"[SERVER] Processus arrêté (code={code}). Relance automatique dans 2s.")
                    time.sleep(2)
                server = _start_server(app_cmd)
                continue

            time.sleep(2)
    except KeyboardInterrupt:
        _log("[SUPERVISEUR] Arrêt demandé (CTRL+C).")
        _stop_server(server, timeout_s=10)
        return 0


if __name__ == "__main__":
    sys.exit(main())
