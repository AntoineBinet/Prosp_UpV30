"""Blueprint TEMPORAIRE — Bootstrap du site Portfolio (marienour.work).

À supprimer une fois le bootstrap effectué :
  1. Supprimer ce fichier
  2. Supprimer le dossier `bootstrap_skeleton/`
  3. Retirer `register_blueprint(bootstrap_portfolio_bp)` dans app.py
  4. Retirer la carte « [TEMP] Bootstrap Portfolio » dans templates/v30/parametres.html

Endpoint :
  POST /api/admin/bootstrap-portfolio   (SSE, admin only)
    - Clone https://github.com/AntoineBinet/ProjetPortefolio.git → ~/Desktop/Portfolio
    - Y copie le skeleton Flask (bootstrap_skeleton/)
    - Détecte le tunnel `mnwork` via cloudflared, écrit Portfolio/mnwork.yml
      avec ingress marienour.work → http://localhost:8001
    - git add + commit + push origin main
    - Lance PORTFOLIO.bat (serveur :8001 + tunnel mnwork) en fenêtre détachée

Body JSON optionnel :
  { "force": true }   # autorise écraser un dossier Portfolio existant non vide
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from flask import Blueprint, Response, request

from app import APP_DIR, login_required, role_required, _require_same_origin, logger

bootstrap_portfolio_bp = Blueprint("bootstrap_portfolio", __name__)

PORTFOLIO_REPO = "https://github.com/AntoineBinet/ProjetPortefolio.git"
PORTFOLIO_PORT = 8001
TUNNEL_NAME = "mnwork"
TUNNEL_HOSTNAME = "marienour.work"
SKELETON_DIR = APP_DIR / "bootstrap_skeleton"


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _find_cloudflared() -> str | None:
    candidates = [
        "cloudflared",
        r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
        r"C:\Program Files\cloudflared\cloudflared.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\cloudflared\cloudflared.exe"),
        os.path.expandvars(
            r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
        ),
    ]
    for c in candidates:
        try:
            cp = subprocess.run([c, "--version"], capture_output=True, text=True, timeout=4)
            if cp.returncode == 0:
                return c
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
    return None


def _detect_tunnel_uuid(cloudflared: str) -> tuple[str | None, str | None]:
    """Retourne (uuid, credentials_file) pour le tunnel mnwork, ou (None, None)."""
    # Tentative 1 : tunnel info JSON
    try:
        cp = subprocess.run(
            [cloudflared, "tunnel", "info", TUNNEL_NAME, "--output", "json"],
            capture_output=True, text=True, timeout=10,
        )
        if cp.returncode == 0 and cp.stdout.strip():
            data = json.loads(cp.stdout)
            uuid = data.get("id") or data.get("ID")
            if uuid:
                cred = Path.home() / ".cloudflared" / f"{uuid}.json"
                if cred.exists():
                    return uuid, str(cred)
                return uuid, None
    except Exception:
        pass

    # Tentative 2 : tunnel list JSON
    try:
        cp = subprocess.run(
            [cloudflared, "tunnel", "list", "--output", "json"],
            capture_output=True, text=True, timeout=10,
        )
        if cp.returncode == 0 and cp.stdout.strip():
            tunnels = json.loads(cp.stdout)
            for t in tunnels:
                if (t.get("name") or "").lower() == TUNNEL_NAME.lower():
                    uuid = t.get("id") or t.get("ID")
                    if uuid:
                        cred = Path.home() / ".cloudflared" / f"{uuid}.json"
                        return uuid, (str(cred) if cred.exists() else None)
    except Exception:
        pass

    return None, None


def _git(cwd: Path, *args, timeout=30) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=str(cwd),
        capture_output=True, text=True, timeout=timeout,
    )


def _copy_skeleton(dest: Path):
    """Copie récursive du contenu de bootstrap_skeleton/ dans dest (préserve .git)."""
    for item in SKELETON_DIR.iterdir():
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)


@bootstrap_portfolio_bp.post("/api/admin/bootstrap-portfolio")
@login_required
@role_required("admin")
def api_bootstrap_portfolio():
    chk = _require_same_origin()
    if chk:
        return chk

    body = request.get_json(silent=True) or {}
    force = bool(body.get("force"))
    folder_name = (body.get("folder_name") or "Portfolio").strip() or "Portfolio"

    # Dossier cible : USERPROFILE\Desktop\<folder_name>
    desktop = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"
    target = desktop / folder_name

    def gen():
        try:
            yield _sse({"step": "log", "line": f"Skeleton source : {SKELETON_DIR}"})
            yield _sse({"step": "log", "line": f"Dossier cible   : {target}"})

            if not SKELETON_DIR.exists():
                yield _sse({"step": "error", "error": f"Skeleton introuvable : {SKELETON_DIR}"})
                return

            if not desktop.exists():
                yield _sse({"step": "error", "error": f"Bureau introuvable : {desktop}"})
                return

            # 1) Préparer le dossier
            if target.exists():
                non_empty = any(target.iterdir())
                if non_empty and not force:
                    yield _sse({"step": "error",
                                "error": f"Le dossier {target} existe déjà et n'est pas vide. "
                                         "Renvoie la requête avec force=true pour le réutiliser."})
                    return
                yield _sse({"step": "log", "line": "Dossier existant — réutilisation"})
            else:
                target.mkdir(parents=True, exist_ok=False)
                yield _sse({"step": "log", "line": "Dossier créé"})

            # 2) Clone (uniquement si pas déjà un repo git)
            if not (target / ".git").exists():
                yield _sse({"step": "clone", "message": f"git clone {PORTFOLIO_REPO}…"})
                cp = _git(target, "clone", PORTFOLIO_REPO, ".", timeout=60)
                for line in (cp.stdout + cp.stderr).splitlines():
                    if line.strip():
                        yield _sse({"step": "log", "line": line.strip()})
                if cp.returncode != 0:
                    yield _sse({"step": "error", "error": "git clone échoué"})
                    return
            else:
                yield _sse({"step": "log", "line": "Déjà un dépôt git — clone sauté"})

            # S'assurer d'être sur main
            br = _git(target, "branch", "--show-current", timeout=5)
            cur_b = (br.stdout or "").strip()
            if cur_b != "main":
                co = _git(target, "checkout", "-B", "main", timeout=10)
                if co.returncode != 0:
                    yield _sse({"step": "log", "line": f"checkout main : {co.stderr.strip()}"})

            # Vérifier qu'on a bien le bon remote
            rem = _git(target, "remote", "get-url", "origin", timeout=5)
            if rem.returncode != 0:
                _git(target, "remote", "add", "origin", PORTFOLIO_REPO, timeout=5)
            elif rem.stdout.strip() != PORTFOLIO_REPO:
                _git(target, "remote", "set-url", "origin", PORTFOLIO_REPO, timeout=5)

            # 3) Copier le skeleton
            yield _sse({"step": "log", "line": "Copie du skeleton Flask…"})
            _copy_skeleton(target)
            yield _sse({"step": "log", "line": "Skeleton copié"})

            # 4) Détecter cloudflared + tunnel mnwork → écrire mnwork.yml
            cf = _find_cloudflared()
            if not cf:
                yield _sse({"step": "log",
                            "line": "[WARN] cloudflared introuvable — mnwork.yml NON généré, "
                                    "le tunnel ne se lancera pas."})
            else:
                yield _sse({"step": "log", "line": f"cloudflared : {cf}"})
                uuid, cred = _detect_tunnel_uuid(cf)
                if not uuid:
                    yield _sse({"step": "log",
                                "line": f"[WARN] Tunnel '{TUNNEL_NAME}' introuvable via cloudflared. "
                                        "Vérifie que tu es loggé : `cloudflared login`. mnwork.yml NON généré."})
                else:
                    yield _sse({"step": "log", "line": f"Tunnel {TUNNEL_NAME} UUID : {uuid}"})
                    if not cred:
                        # Fallback : on devine le chemin standard même s'il n'existe pas (l'user verra l'erreur cloudflared)
                        cred = str(Path.home() / ".cloudflared" / f"{uuid}.json")
                        yield _sse({"step": "log",
                                    "line": f"[WARN] credentials-file non trouvé, fallback : {cred}"})
                    else:
                        yield _sse({"step": "log", "line": f"credentials-file : {cred}"})

                    yaml_content = (
                        f"tunnel: {TUNNEL_NAME}\n"
                        f"credentials-file: {cred}\n\n"
                        "ingress:\n"
                        f"  - hostname: {TUNNEL_HOSTNAME}\n"
                        f"    service: http://localhost:{PORTFOLIO_PORT}\n"
                        "  - service: http_status:404\n"
                    )
                    (target / "mnwork.yml").write_text(yaml_content, encoding="utf-8")
                    yield _sse({"step": "log", "line": "mnwork.yml généré"})

            # 5) Commit + push (le mnwork.yml est gitignored, normal)
            # Configurer user.email / user.name local si manquant
            cfg = _git(target, "config", "user.email", timeout=5)
            if cfg.returncode != 0 or not cfg.stdout.strip():
                _git(target, "config", "user.email", "bootstrap@portfolio.local", timeout=5)
                _git(target, "config", "user.name", "Portfolio Bootstrap", timeout=5)

            _git(target, "add", "-A", timeout=15)
            status = _git(target, "status", "--porcelain", timeout=5)
            if status.stdout.strip():
                yield _sse({"step": "log", "line": "git commit (skeleton initial)…"})
                cm = _git(target, "commit", "-m", "Bootstrap : skeleton Flask Portfolio", timeout=15)
                if cm.returncode != 0:
                    yield _sse({"step": "log", "line": f"commit : {(cm.stderr or cm.stdout).strip()}"})
                else:
                    for line in cm.stdout.splitlines():
                        if line.strip():
                            yield _sse({"step": "log", "line": line.strip()})

                yield _sse({"step": "push", "message": "git push -u origin main…"})
                push = _git(target, "push", "-u", "origin", "main", timeout=60)
                for line in (push.stdout + push.stderr).splitlines():
                    if line.strip():
                        yield _sse({"step": "log", "line": line.strip()})
                if push.returncode != 0:
                    yield _sse({"step": "log",
                                "line": "[WARN] git push échoué (auth GitHub manquante ?). "
                                        "Le serveur va quand même se lancer en local."})
            else:
                yield _sse({"step": "log", "line": "Rien à committer (skeleton déjà présent)"})

            # 6) Lancer PORTFOLIO.bat dans une nouvelle fenêtre détachée
            bat = target / "PORTFOLIO.bat"
            if not bat.exists():
                yield _sse({"step": "error", "error": "PORTFOLIO.bat introuvable après copie"})
                return
            yield _sse({"step": "launch", "message": f"Lancement de {bat.name}…"})
            try:
                if sys.platform == "win32":
                    # cmd /c start "" ouvre une nouvelle fenêtre, on peut détacher
                    flags = subprocess.CREATE_NEW_CONSOLE
                    try:
                        flags |= subprocess.DETACHED_PROCESS
                    except AttributeError:
                        pass
                    subprocess.Popen(
                        ["cmd", "/c", "start", "", str(bat)],
                        cwd=str(target),
                        creationflags=subprocess.CREATE_NEW_CONSOLE,
                        close_fds=True,
                    )
                else:
                    subprocess.Popen(["bash", str(bat)], cwd=str(target),
                                     start_new_session=True)
                yield _sse({"step": "log", "line": "PORTFOLIO.bat lancé en arrière-plan"})
            except Exception as e:
                yield _sse({"step": "error", "error": f"Lancement échoué : {e}"})
                return

            yield _sse({
                "step": "done",
                "message": "Bootstrap terminé. Patiente ~10 s puis ouvre https://marienour.work",
                "target": str(target),
                "port": PORTFOLIO_PORT,
                "tunnel": TUNNEL_NAME,
                "url_local": f"http://127.0.0.1:{PORTFOLIO_PORT}",
                "url_public": f"https://{TUNNEL_HOSTNAME}",
            })
        except subprocess.TimeoutExpired as e:
            yield _sse({"step": "error", "error": f"Timeout : {e}"})
        except Exception as e:
            logger.exception("Bootstrap Portfolio error")
            yield _sse({"step": "error", "error": str(e)})

    return Response(
        gen(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── DIAGNOSTIC ────────────────────────────────────────────────────
# Quand marienour.work répond Error 1033 (tunnel down), on a besoin
# d'inspecter l'état côté PC sans avoir d'accès direct.

def _read_text_safe(path: Path, max_bytes: int = 8192) -> str | None:
    try:
        if not path.exists():
            return None
        data = path.read_bytes()[:max_bytes]
        return data.decode("utf-8", errors="replace")
    except Exception as e:
        return f"<lecture impossible : {e}>"


def _list_processes_windows() -> list[dict]:
    """Liste cloudflared.exe et python.exe avec leur cmdline (PowerShell)."""
    if sys.platform != "win32":
        return []
    ps = (
        "Get-CimInstance Win32_Process "
        "-Filter \"name='cloudflared.exe' or name='python.exe' or name='pythonw.exe'\" "
        "| Select-Object ProcessId,Name,CommandLine "
        "| ConvertTo-Json -Compress"
    )
    try:
        cp = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, timeout=10,
        )
        if cp.returncode != 0 or not cp.stdout.strip():
            return []
        data = json.loads(cp.stdout)
        if isinstance(data, dict):
            data = [data]
        return data
    except Exception:
        return []


def _http_local_health() -> dict:
    """Test http://127.0.0.1:8001/api/deploy/health (timeout 2 s)."""
    try:
        from urllib.request import urlopen
        with urlopen(f"http://127.0.0.1:{PORTFOLIO_PORT}/api/deploy/health", timeout=2) as r:
            body = r.read(2048).decode("utf-8", errors="replace")
            return {"reachable": True, "status": r.status, "body": body}
    except Exception as e:
        return {"reachable": False, "error": str(e)}


@bootstrap_portfolio_bp.get("/api/admin/portfolio-status")
@login_required
@role_required("admin")
def api_portfolio_status():
    """Diagnostic complet de l'état du Portfolio sur le PC hébergeur."""
    desktop = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"
    target = desktop / "Portfolio"
    cf_dir = Path.home() / ".cloudflared"

    out: dict = {
        "platform": sys.platform,
        "portfolio_dir": str(target),
        "portfolio_exists": target.exists(),
        "skeleton_dir": str(SKELETON_DIR),
        "skeleton_exists": SKELETON_DIR.exists(),
    }

    if target.exists():
        try:
            out["portfolio_files"] = sorted(p.name for p in target.iterdir())
        except Exception as e:
            out["portfolio_files_error"] = str(e)

    # mnwork.yml
    yaml_path = target / "mnwork.yml"
    out["mnwork_yml_path"] = str(yaml_path)
    out["mnwork_yml_exists"] = yaml_path.exists()
    if yaml_path.exists():
        out["mnwork_yml_content"] = _read_text_safe(yaml_path)

    # ~/.cloudflared/
    out["cloudflared_dir"] = str(cf_dir)
    if cf_dir.exists():
        try:
            entries = []
            for p in sorted(cf_dir.iterdir()):
                entries.append({
                    "name": p.name,
                    "size": p.stat().st_size if p.is_file() else None,
                    "is_dir": p.is_dir(),
                })
            out["cloudflared_dir_entries"] = entries
        except Exception as e:
            out["cloudflared_dir_error"] = str(e)

    # cloudflared binary
    cf = _find_cloudflared()
    out["cloudflared_bin"] = cf
    if cf:
        # tunnel list
        try:
            cp = subprocess.run(
                [cf, "tunnel", "list", "--output", "json"],
                capture_output=True, text=True, timeout=10,
            )
            out["tunnel_list_returncode"] = cp.returncode
            if cp.stdout.strip():
                try:
                    out["tunnel_list"] = json.loads(cp.stdout)
                except Exception:
                    out["tunnel_list_raw"] = cp.stdout[:2000]
            if cp.stderr:
                out["tunnel_list_stderr"] = cp.stderr[:1000]
        except Exception as e:
            out["tunnel_list_error"] = str(e)

        # tunnel info mnwork
        try:
            cp = subprocess.run(
                [cf, "tunnel", "info", TUNNEL_NAME, "--output", "json"],
                capture_output=True, text=True, timeout=10,
            )
            out["tunnel_info_returncode"] = cp.returncode
            if cp.stdout.strip():
                try:
                    out["tunnel_info"] = json.loads(cp.stdout)
                except Exception:
                    out["tunnel_info_raw"] = cp.stdout[:2000]
            if cp.stderr:
                out["tunnel_info_stderr"] = cp.stderr[:1000]
        except Exception as e:
            out["tunnel_info_error"] = str(e)

    # Local server health
    out["local_health_8001"] = _http_local_health()

    # Processus en cours
    out["processes"] = _list_processes_windows()

    return out


@bootstrap_portfolio_bp.post("/api/admin/portfolio-action")
@login_required
@role_required("admin")
def api_portfolio_action():
    """Actions de réparation : regenerate-config / kill-tunnel / restart-bat."""
    chk = _require_same_origin()
    if chk:
        return chk

    body = request.get_json(silent=True) or {}
    action = (body.get("action") or "").strip()
    desktop = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"
    target = desktop / "Portfolio"

    if not target.exists():
        return {"ok": False, "error": f"Dossier Portfolio introuvable : {target}"}, 400

    log_lines: list[str] = []
    def log(msg: str):
        log_lines.append(msg)
        logger.info("[portfolio-action] %s", msg)

    try:
        if action == "regenerate-config":
            cf = _find_cloudflared()
            if not cf:
                return {"ok": False, "error": "cloudflared introuvable", "log": log_lines}, 500
            uuid, cred = _detect_tunnel_uuid(cf)
            if not uuid:
                return {"ok": False, "error": f"Tunnel '{TUNNEL_NAME}' introuvable", "log": log_lines}, 500
            if not cred:
                cred = str(Path.home() / ".cloudflared" / f"{uuid}.json")
                log(f"[WARN] credentials-file deviné : {cred}")
            yaml_content = (
                f"tunnel: {TUNNEL_NAME}\n"
                f"credentials-file: {cred}\n\n"
                "ingress:\n"
                f"  - hostname: {TUNNEL_HOSTNAME}\n"
                f"    service: http://localhost:{PORTFOLIO_PORT}\n"
                "  - service: http_status:404\n"
            )
            (target / "mnwork.yml").write_text(yaml_content, encoding="utf-8")
            log(f"mnwork.yml régénéré (uuid={uuid})")
            return {"ok": True, "log": log_lines, "uuid": uuid, "credentials_file": cred,
                    "yaml_content": yaml_content}

        if action == "kill-tunnel":
            # Tue UNIQUEMENT les cloudflared.exe dont la cmdline contient 'mnwork'
            # (préserve donc le tunnel prospup et le service prospup-work).
            if sys.platform != "win32":
                return {"ok": False, "error": "Action Windows-only", "log": log_lines}, 400
            ps = (
                "Get-CimInstance Win32_Process -Filter \"name='cloudflared.exe'\" "
                "| Where-Object { $_.CommandLine -match 'mnwork' } "
                "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output $_.ProcessId }"
            )
            cp = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps],
                capture_output=True, text=True, timeout=15,
            )
            killed = [l.strip() for l in cp.stdout.splitlines() if l.strip()]
            log(f"Processus cloudflared mnwork tués : {killed or 'aucun'}")
            if cp.stderr:
                log(f"stderr : {cp.stderr.strip()}")
            return {"ok": True, "killed": killed, "log": log_lines}

        if action == "kill-server":
            # Tue les python qui exécutent app.py dans le dossier Portfolio
            if sys.platform != "win32":
                return {"ok": False, "error": "Action Windows-only", "log": log_lines}, 400
            ps = (
                "Get-CimInstance Win32_Process "
                "-Filter \"name='python.exe' or name='pythonw.exe'\" "
                "| Where-Object { $_.CommandLine -match 'Portfolio' -and $_.CommandLine -match 'app.py' } "
                "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output $_.ProcessId }"
            )
            cp = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps],
                capture_output=True, text=True, timeout=15,
            )
            killed = [l.strip() for l in cp.stdout.splitlines() if l.strip()]
            log(f"Processus python Portfolio tués : {killed or 'aucun'}")
            return {"ok": True, "killed": killed, "log": log_lines}

        if action == "restart-bat":
            # Lance PORTFOLIO.bat dans une nouvelle fenêtre détachée
            bat = target / "PORTFOLIO.bat"
            if not bat.exists():
                return {"ok": False, "error": "PORTFOLIO.bat introuvable", "log": log_lines}, 400
            if sys.platform == "win32":
                subprocess.Popen(
                    ["cmd", "/c", "start", "", str(bat)],
                    cwd=str(target),
                    creationflags=subprocess.CREATE_NEW_CONSOLE,
                    close_fds=True,
                )
            else:
                subprocess.Popen(["bash", str(bat)], cwd=str(target), start_new_session=True)
            log(f"PORTFOLIO.bat relancé : {bat}")
            return {"ok": True, "log": log_lines}

        return {"ok": False, "error": f"action inconnue : '{action}'"}, 400

    except subprocess.TimeoutExpired as e:
        return {"ok": False, "error": f"Timeout : {e}", "log": log_lines}, 500
    except Exception as e:
        logger.exception("portfolio-action error")
        return {"ok": False, "error": str(e), "log": log_lines}, 500
