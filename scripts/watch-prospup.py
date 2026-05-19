#!/usr/bin/env python3
"""
Watchdog ProspUp v2 — surveille l'app et déclenche restart/rollback si nécessaire.

Logique de décision :
  1. Vérifie l'URL locale Flask (http://127.0.0.1:PORT)
  2. Vérifie l'URL publique Cloudflare (https://prospup.work)
  3. LOCAL KO → restart simple (kill process sur le port, relance l'app)
  4. LOCAL toujours KO après RESTART_WAIT_S → rollback Git + nouveau restart
  5. LOCAL OK mais PUBLIC KO → log + notification (problème Cloudflare/réseau, pas Flask)
  6. Tout OK → log "OK"

Variables d'environnement :
  PROSPUP_LOCAL_URL       URL locale Flask      (défaut: http://127.0.0.1:8000)
  PROSPUP_PUBLIC_URL      URL publique          (défaut: https://prospup.work)
  PROSPUP_HEALTH_PORT     Port Flask            (défaut: 8000)
  PROSPUP_WATCH_CMD       Commande relance      (défaut: python app.py --production)
  PROSPUP_WATCH_DIR       Répertoire de travail (défaut: répertoire parent du script)
  PROSPUP_WATCH_INTERVAL  Intervalle en s       (défaut: 300 = 5 min)
  PROSPUP_WATCH_TIMEOUT   Timeout HTTP en s     (défaut: 10)
  PROSPUP_RESTART_WAIT    Attente post-restart  (défaut: 30)
  PROSPUP_LOG_FILE        Fichier de log        (défaut: logs/watchdog.log)
  PROSPUP_NTFY_TOPIC      Topic ntfy.sh         (optionnel, ex: my-prospup-alerts)
  PROSPUP_DRY_RUN         Si "1", simule sans agir réellement (pour tests)

Usage :
  python scripts/watch-prospup.py            # Un cycle puis sortie (tâche planifiée)
  python scripts/watch-prospup.py --loop     # Boucle toutes les INTERVAL secondes
  PROSPUP_DRY_RUN=1 python scripts/watch-prospup.py --loop  # Mode test sans actions
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


# ─── Constantes ───────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LAST_COMMIT_FILE = PROJECT_ROOT / ".last_commit_hash"
ROLLBACK_DONE_FILE = PROJECT_ROOT / ".rollback_done"


# ─── Logging (console + fichier) ──────────────────────────────────────────────

_log_file: Path | None = None


def _init_log(log_path: Path) -> None:
    global _log_file
    log_path.parent.mkdir(parents=True, exist_ok=True)
    _log_file = log_path


def _log(msg: str, level: str = "INFO") -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    # Normaliser les caractères non-ASCII pour la console Windows (cp1252)
    safe_msg = msg.encode("cp1252", errors="replace").decode("cp1252")
    line_safe = f"[{stamp}] [{level}] {safe_msg}"
    line_utf8 = f"[{stamp}] [{level}] {msg}"
    try:
        print(line_safe, flush=True)
    except Exception:
        print(line_safe.encode("ascii", errors="replace").decode("ascii"), flush=True)
    if _log_file:
        try:
            with _log_file.open("a", encoding="utf-8") as f:
                f.write(line_utf8 + "\n")
        except Exception:
            pass


def _notify(topic: str, title: str, msg: str, dry_run: bool = False) -> None:
    """Envoie une notification push via ntfy.sh (optionnel)."""
    if not topic:
        return
    if dry_run:
        _log(f"[DRY RUN] Notification ntfy: {title} — {msg}")
        return
    try:
        body = msg.encode("utf-8")
        url = f"https://ntfy.sh/{topic}"
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Title": title,
                "Priority": "high",
                "Tags": "warning,rotating_light",
            },
        )
        with urllib.request.urlopen(req, timeout=8):
            pass
        _log(f"Notification ntfy envoyée: {title}")
    except Exception as e:
        _log(f"Notification ntfy échouée: {e}", "WARN")


# ─── Vérification HTTP ────────────────────────────────────────────────────────


def _check_url(url: str, timeout: int) -> tuple[bool, str]:
    """Retourne (ok, raison). ok=True si status 200."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return True, "200 OK"
            return False, f"status {resp.status}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        return False, f"URLError: {e.reason}"
    except Exception as e:
        return False, str(e)


# ─── Gestion du process Flask ─────────────────────────────────────────────────


def _find_pid_on_port(port: int) -> list[int]:
    """Trouve les PIDs des processus qui écoutent sur le port (Windows/Linux)."""
    pids: list[int] = []
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["netstat", "-ano", "-p", "TCP"],
                capture_output=True, timeout=10,
            )
            stdout = (result.stdout or b"").decode("utf-8", errors="replace")
            for line in stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    if parts:
                        try:
                            pids.append(int(parts[-1]))
                        except ValueError:
                            pass
        else:
            result = subprocess.run(
                ["lsof", "-ti", f"tcp:{port}"],
                capture_output=True, timeout=10,
            )
            for p in (result.stdout or b"").decode("utf-8", errors="replace").strip().splitlines():
                try:
                    pids.append(int(p))
                except ValueError:
                    pass
    except Exception as e:
        _log(f"Erreur lors de la recherche du PID sur port {port}: {e}", "WARN")
    return pids


def _kill_port(port: int, dry_run: bool = False) -> bool:
    """Tue les processus qui écoutent sur le port. Retourne True si au moins un tué."""
    pids = _find_pid_on_port(port)
    if not pids:
        _log(f"Aucun process trouvé sur le port {port}.")
        return False

    killed_any = False
    for pid in pids:
        _log(f"Kill PID {pid} (port {port})...")
        if dry_run:
            _log(f"[DRY RUN] Aurait tué PID {pid}")
            killed_any = True
            continue
        try:
            if sys.platform == "win32":
                r = subprocess.run(
                    ["taskkill", "/F", "/PID", str(pid)],
                    capture_output=True, text=True, timeout=10,
                )
                if r.returncode == 0:
                    _log(f"PID {pid} tué.")
                    killed_any = True
                else:
                    _log(f"taskkill PID {pid} échoué: {r.stderr.strip()}", "WARN")
            else:
                import signal
                os.kill(pid, signal.SIGTERM)
                time.sleep(1)
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                killed_any = True
        except Exception as e:
            _log(f"Impossible de tuer PID {pid}: {e}", "WARN")
    return killed_any


# v32.68 — Whitelist stricte
_ALLOWED_START_COMMANDS = {
    "python app.py --production",
    "python app.py --prod",
    "python app.py",
    "py app.py --production",
    "py app.py --prod",
    "py app.py",
}


def _start_server(cmd: str, cwd: str, dry_run: bool = False) -> bool:
    """Lance la commande de démarrage en arrière-plan (whitelist stricte v32.68)."""
    safe = (cmd or "").strip()
    if safe not in _ALLOWED_START_COMMANDS:
        _log(f"Cmd hors whitelist ({safe!r}) — fallback sur défaut.", "WARN")
        safe = "python app.py --prod"
    _log(f"Démarrage serveur: {safe} (cwd={cwd})")
    if dry_run:
        _log("[DRY RUN] Aurait lancé le serveur.")
        return True
    try:
        subprocess.Popen(
            safe.split(),  # shell=False
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception as e:
        _log(f"Impossible de démarrer le serveur: {e}", "ERROR")
        return False


# ─── Rollback Git ─────────────────────────────────────────────────────────────


def _run_git(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=str(PROJECT_ROOT),
        capture_output=True, text=True, timeout=30,
    )


def _git_rev(ref: str) -> str:
    try:
        cp = _run_git(["git", "rev-parse", ref])
        return cp.stdout.strip() if cp.returncode == 0 else ""
    except Exception:
        return ""


def _rollback_git(dry_run: bool = False) -> bool:
    """
    Rollback vers le commit stable.
    Priorité : .last_commit_hash → HEAD~1.
    Retourne True si réussi.
    """
    if LAST_COMMIT_FILE.exists():
        rollback_hash = LAST_COMMIT_FILE.read_text(encoding="utf-8").strip()
        source = ".last_commit_hash"
    else:
        rollback_hash = _git_rev("HEAD~1")
        source = "HEAD~1"

    if not rollback_hash:
        _log("Impossible de trouver un commit de rollback.", "ERROR")
        return False

    current = _git_rev("HEAD")
    if current == rollback_hash:
        _log(f"Déjà sur le commit de rollback {rollback_hash[:10]} — rollback inutile.", "WARN")
        return False

    _log(f"Rollback vers {rollback_hash[:10]} (source: {source})...")
    if dry_run:
        _log(f"[DRY RUN] git reset --hard {rollback_hash[:10]}")
        return True

    # Stash d'abord pour ne pas perdre les modifications locales
    _run_git(["git", "stash", "--include-untracked", "-m", "watchdog-pre-rollback"])

    cp = _run_git(["git", "reset", "--hard", rollback_hash])
    if cp.returncode != 0:
        _log(f"git reset --hard échoué: {(cp.stderr or cp.stdout).strip()}", "ERROR")
        return False

    _log(f"Rollback réussi vers {rollback_hash[:10]}.")
    try:
        ROLLBACK_DONE_FILE.write_text(
            f"rollback_to={rollback_hash}\ntime={time.strftime('%Y-%m-%d %H:%M:%S')}\n",
            encoding="utf-8",
        )
    except Exception:
        pass
    return True


# ─── Cycle principal ──────────────────────────────────────────────────────────


def _run_cycle(
    local_url: str,
    public_url: str,
    health_port: int,
    watch_cmd: str,
    watch_cwd: str,
    timeout: int,
    restart_wait: int,
    ntfy_topic: str,
    dry_run: bool,
) -> None:
    """Exécute un cycle complet de surveillance."""

    # ── 1. Vérification locale ────────────────────────────────────────────────
    local_ok, local_reason = _check_url(local_url, timeout)
    _log(f"LOCAL  {local_url} -> {'OK' if local_ok else 'KO'} ({local_reason})")

    # ── 2. Vérification publique ─────────────────────────────────────────────
    public_ok, public_reason = _check_url(public_url, timeout)
    _log(f"PUBLIC {public_url} -> {'OK' if public_ok else 'KO'} ({public_reason})")

    # ── 3. Analyse de la situation ────────────────────────────────────────────
    if local_ok and public_ok:
        _log("Tout OK.")
        return

    if local_ok and not public_ok:
        msg = f"Flask local OK mais URL publique KO ({public_reason}). Probable problème Cloudflare Tunnel ou réseau."
        _log(msg, "WARN")
        _notify(ntfy_topic, "ProspUp — Tunnel KO", msg, dry_run)
        return

    # ── 4. LOCAL KO : restart simple ─────────────────────────────────────────
    _log("Flask local KO — tentative de restart simple.", "WARN")
    _notify(ntfy_topic, "ProspUp — Flask KO", f"Flask inaccessible ({local_reason}). Restart en cours…", dry_run)

    _kill_port(health_port, dry_run)
    time.sleep(2)
    _start_server(watch_cmd, watch_cwd, dry_run)

    _log(f"Attente {restart_wait}s pour que Flask redémarre...")
    if not dry_run:
        time.sleep(restart_wait)
    else:
        _log("[DRY RUN] Attente simulée.")

    # ── 5. Re-vérification post-restart ──────────────────────────────────────
    local_ok2, local_reason2 = _check_url(local_url, timeout)
    _log(f"POST-RESTART LOCAL → {'OK' if local_ok2 else 'KO'} ({local_reason2})")

    if local_ok2:
        _log("Flask OK après restart simple.")
        _notify(ntfy_topic, "ProspUp — Flask rétabli", "Flask répond après restart.", dry_run)
        return

    # ── 6. TOUJOURS KO : rollback Git + restart ───────────────────────────────
    _log("Flask toujours KO après restart — rollback Git en cours.", "ERROR")
    _notify(ntfy_topic, "ProspUp — ROLLBACK", "Flask KO après restart. Rollback Git + redémarrage.", dry_run)

    rolled_back = _rollback_git(dry_run)

    if rolled_back:
        _log("Rollback effectué — redémarrage du serveur...")
        _kill_port(health_port, dry_run)
        time.sleep(2)
        _start_server(watch_cmd, watch_cwd, dry_run)

        _log(f"Attente {restart_wait}s post-rollback...")
        if not dry_run:
            time.sleep(restart_wait)

        local_ok3, local_reason3 = _check_url(local_url, timeout)
        if local_ok3:
            _log("Flask OK après rollback.")
            _notify(ntfy_topic, "ProspUp — rétabli après rollback", "Flask répond après rollback Git.", dry_run)
        else:
            _log(f"Flask KO même après rollback ({local_reason3}) — intervention manuelle requise.", "ERROR")
            _notify(ntfy_topic, "ProspUp — CRITIQUE", "Flask KO même après rollback. Intervention manuelle requise.", dry_run)
    else:
        _log("Rollback impossible — intervention manuelle requise.", "ERROR")
        _notify(ntfy_topic, "ProspUp — CRITIQUE", "Rollback impossible. Intervention manuelle requise.", dry_run)


# ─── Point d'entrée ───────────────────────────────────────────────────────────


def main() -> None:
    loop_mode = "--loop" in sys.argv
    dry_run = os.environ.get("PROSPUP_DRY_RUN", "").strip() == "1"

    health_port = int(os.environ.get("PROSPUP_HEALTH_PORT", "8000"))
    local_url = os.environ.get("PROSPUP_LOCAL_URL", f"http://127.0.0.1:{health_port}/api/deploy/health").strip()
    public_url = os.environ.get("PROSPUP_PUBLIC_URL", "https://prospup.work/api/deploy/health").strip()
    watch_cmd = os.environ.get("PROSPUP_WATCH_CMD", "python app.py --production").strip()
    watch_cwd = os.environ.get("PROSPUP_WATCH_DIR", str(PROJECT_ROOT)).strip()
    interval = max(60, int(os.environ.get("PROSPUP_WATCH_INTERVAL", "300")))
    timeout = max(3, int(os.environ.get("PROSPUP_WATCH_TIMEOUT", "10")))
    restart_wait = max(10, int(os.environ.get("PROSPUP_RESTART_WAIT", "30")))
    ntfy_topic = os.environ.get("PROSPUP_NTFY_TOPIC", "").strip()

    log_file_path = os.environ.get("PROSPUP_LOG_FILE", str(PROJECT_ROOT / "logs" / "watchdog.log")).strip()
    _init_log(Path(log_file_path))

    _log("=" * 60)
    _log(f"Watchdog ProspUp v2 - dry_run={dry_run} loop={loop_mode}")
    _log(f"  Local:   {local_url}")
    _log(f"  Public:  {public_url}")
    _log(f"  Cmd:     {watch_cmd}")
    _log(f"  Restart wait: {restart_wait}s | Interval: {interval}s")
    if ntfy_topic:
        _log(f"  Notifications ntfy.sh: topic={ntfy_topic}")
    if dry_run:
        _log("  MODE DRY RUN — aucune action réelle ne sera effectuée")
    _log("=" * 60)

    while True:
        try:
            _run_cycle(
                local_url=local_url,
                public_url=public_url,
                health_port=health_port,
                watch_cmd=watch_cmd,
                watch_cwd=watch_cwd,
                timeout=timeout,
                restart_wait=restart_wait,
                ntfy_topic=ntfy_topic,
                dry_run=dry_run,
            )
        except Exception as e:
            _log(f"Erreur inattendue dans le cycle: {e}", "ERROR")

        if not loop_mode:
            break
        _log(f"Prochain check dans {interval}s...")
        time.sleep(interval)


if __name__ == "__main__":
    main()
