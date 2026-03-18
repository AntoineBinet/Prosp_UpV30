#!/usr/bin/env python3
"""
Superviseur ProspUp — lance le serveur, détecte les crash loops et rollback automatiquement.

Fonctionnalités :
  - Lance le serveur Flask/Waitress
  - Redémarre sur exit code 42 (restart demandé par l'app)
  - Relance automatiquement en cas de crash
  - Détecte les crash loops (N crashs en M secondes) et rollback au commit précédent
  - Health check HTTP après chaque restart
  - Auto-checkout main si le repo n'est pas sur la bonne branche

Variables d'environnement (optionnel) :
  PROSPUP_APP_CMD           Commande serveur (défaut: python app.py --production)
  PROSPUP_CRASH_THRESHOLD   Nombre de crashs pour déclencher un rollback (défaut: 3)
  PROSPUP_CRASH_WINDOW      Fenêtre en secondes pour la détection crash loop (défaut: 120)
  PROSPUP_HEALTH_PORT       Port HTTP pour le health check (défaut: 8000)
  PROSPUP_HEALTH_TIMEOUT    Timeout du health check en secondes (défaut: 30)
  PROSPUP_GRACE_PERIOD      Temps de grâce après restart avant health check (défaut: 8)
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from collections import deque
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
LAST_COMMIT_FILE = PROJECT_ROOT / ".last_commit_hash"
ROLLBACK_DONE_FILE = PROJECT_ROOT / ".rollback_done"
PID_FILE = PROJECT_ROOT / ".supervisor_pid"

_log_file: Path | None = None


def _init_log() -> None:
    global _log_file
    log_path_str = os.environ.get("PROSPUP_SUPERVISOR_LOG", str(PROJECT_ROOT / "logs" / "supervisor.log"))
    log_path = Path(log_path_str)
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        _log_file = log_path
    except Exception:
        pass


def _log(message: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {message}"
    print(line, flush=True)
    if _log_file:
        try:
            with _log_file.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass


def _run(cmd: list[str], *, check: bool = False, timeout: int = 15) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        check=check,
        timeout=timeout,
    )


def _git_rev(ref: str) -> str:
    try:
        cp = _run(["git", "rev-parse", ref])
        if cp.returncode != 0:
            return ""
        return (cp.stdout or "").strip()
    except Exception:
        return ""


def _current_branch() -> str:
    try:
        cp = _run(["git", "branch", "--show-current"])
        if cp.returncode != 0:
            return ""
        return (cp.stdout or "").strip()
    except Exception:
        return ""


def _ensure_on_main() -> bool:
    """S'assure que le repo est sur la branche main. Retourne True si OK."""
    cur = _current_branch()
    if cur == "main":
        return True
    _log(f"[GIT] Branche actuelle: '{cur}' — checkout main")
    cp = _run(["git", "checkout", "main"])
    if cp.returncode == 0:
        _log("[GIT] Basculé sur main.")
        return True
    _log(f"[GIT] checkout main échoué, tentative checkout -B main origin/main")
    cp2 = _run(["git", "checkout", "-B", "main", "origin/main"])
    if cp2.returncode == 0:
        _log("[GIT] Recréation de main depuis origin/main réussie.")
        return True
    _log(f"[GIT] Impossible de passer sur main: {(cp2.stderr or cp2.stdout or '').strip()}")
    return False


def _rollback_to_last_commit() -> bool:
    """Rollback vers le commit sauvegardé dans .last_commit_hash. Retourne True si réussi."""
    if not LAST_COMMIT_FILE.exists():
        _log("[ROLLBACK] Pas de .last_commit_hash — tentative HEAD~1")
        prev = _git_rev("HEAD~1")
        if not prev:
            _log("[ROLLBACK] Impossible de trouver un commit de rollback.")
            return False
        rollback_hash = prev
    else:
        rollback_hash = LAST_COMMIT_FILE.read_text(encoding="utf-8").strip()
        if not rollback_hash:
            _log("[ROLLBACK] .last_commit_hash vide.")
            return False

    current = _git_rev("HEAD")
    if current == rollback_hash:
        _log("[ROLLBACK] Déjà sur le commit de rollback — rollback inutile.")
        return False

    _log(f"[ROLLBACK] Rollback vers {rollback_hash[:10]}...")
    cp = _run(["git", "reset", "--hard", rollback_hash])
    if cp.returncode != 0:
        _log(f"[ROLLBACK] git reset --hard échoué: {(cp.stderr or cp.stdout or '').strip()}")
        return False

    _log(f"[ROLLBACK] ✅ Rollback réussi vers {rollback_hash[:10]}")
    try:
        ROLLBACK_DONE_FILE.write_text(
            f"rollback_to={rollback_hash}\ntime={time.strftime('%Y-%m-%d %H:%M:%S')}\n",
            encoding="utf-8",
        )
    except Exception:
        pass
    return True


def _health_check(port: int, timeout: int = 5) -> bool:
    """Vérifie que le serveur répond sur localhost:port."""
    url = f"http://127.0.0.1:{port}/api/deploy/health"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def _start_server(app_cmd: str) -> subprocess.Popen:
    env = os.environ.copy()
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
    _log("[SERVER] Arrêt du processus serveur...")
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


def main() -> int:
    app_cmd = (os.environ.get("PROSPUP_APP_CMD") or "python app.py --production").strip()
    crash_threshold = int(os.environ.get("PROSPUP_CRASH_THRESHOLD", "3"))
    crash_window = float(os.environ.get("PROSPUP_CRASH_WINDOW", "120"))
    health_port = int(os.environ.get("PROSPUP_HEALTH_PORT", "8000"))
    health_timeout = int(os.environ.get("PROSPUP_HEALTH_TIMEOUT", "30"))
    grace_period = float(os.environ.get("PROSPUP_GRACE_PERIOD", "8"))

    _init_log()

    # Écriture du PID du superviseur pour que watch-prospup.py puisse le trouver
    try:
        PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    except Exception:
        pass

    _log("╔═══════════════════════════════════════════════════════════╗")
    _log("║  SUPERVISEUR ProspUp v2 — avec protection crash loop     ║")
    _log("╚═══════════════════════════════════════════════════════════╝")
    _log(f"  PID superviseur: {os.getpid()}")
    _log(f"  Crash loop: {crash_threshold} crashs en {crash_window}s → rollback auto")
    _log(f"  Health check: localhost:{health_port} (timeout {health_timeout}s, grâce {grace_period}s)")

    _ensure_on_main()

    if ROLLBACK_DONE_FILE.exists():
        _log("[INFO] Fichier .rollback_done détecté — un rollback a eu lieu précédemment.")
        try:
            _log(f"  → {ROLLBACK_DONE_FILE.read_text(encoding='utf-8').strip()}")
        except Exception:
            pass

    crash_times: deque[float] = deque()
    rollback_attempted = False
    server = _start_server(app_cmd)
    start_time = time.monotonic()

    try:
        while True:
            code = server.poll()
            if code is not None:
                elapsed_since_start = time.monotonic() - start_time

                if code == 42:
                    _log("[SERVER] Redémarrage demandé par l'application (code 42).")
                    crash_times.clear()
                    rollback_attempted = False
                    if ROLLBACK_DONE_FILE.exists():
                        try:
                            ROLLBACK_DONE_FILE.unlink()
                        except Exception:
                            pass
                else:
                    _log(f"[SERVER] Processus arrêté (code={code}, uptime={elapsed_since_start:.0f}s).")
                    now = time.monotonic()
                    crash_times.append(now)
                    while crash_times and (now - crash_times[0]) > crash_window:
                        crash_times.popleft()

                    if len(crash_times) >= crash_threshold and not rollback_attempted:
                        _log(f"[CRASH LOOP] ⚠️ {len(crash_times)} crashs en {crash_window}s — ROLLBACK AUTOMATIQUE")
                        _ensure_on_main()
                        if _rollback_to_last_commit():
                            rollback_attempted = True
                            crash_times.clear()
                            _log("[CRASH LOOP] Rollback effectué, relance du serveur...")
                        else:
                            _log("[CRASH LOOP] Rollback impossible — relance avec le code actuel.")
                    elif rollback_attempted and len(crash_times) >= crash_threshold:
                        _log("[CRASH LOOP] ⚠️ Crash loop persiste après rollback — attente 30s avant nouvelle tentative.")
                        time.sleep(30)
                    else:
                        time.sleep(2)

                server = _start_server(app_cmd)
                start_time = time.monotonic()

                _log(f"[HEALTH] Attente {grace_period}s avant health check...")
                time.sleep(grace_period)
                ok = False
                for attempt in range(1, 4):
                    if _health_check(health_port, timeout=health_timeout // 3):
                        ok = True
                        break
                    _log(f"[HEALTH] Tentative {attempt}/3 échouée, attente 3s...")
                    time.sleep(3)
                if ok:
                    _log("[HEALTH] ✅ Serveur opérationnel.")
                else:
                    _log("[HEALTH] ⚠️ Serveur ne répond pas au health check — surveillance continue.")
                continue

            time.sleep(2)
    except KeyboardInterrupt:
        _log("[SUPERVISEUR] Arrêt demandé (CTRL+C).")
        _stop_server(server, timeout_s=10)
        try:
            PID_FILE.unlink(missing_ok=True)
        except Exception:
            pass
        return 0


if __name__ == "__main__":
    sys.exit(main())
