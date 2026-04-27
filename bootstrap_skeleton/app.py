"""Portfolio (marienour.work) — Flask app minimale.

Squelette identique en esprit à Prosp'Up : login admin, page paramètres,
système de mise à jour Git via SSE, rollback, restart. Tout en un seul
fichier pour rester simple à faire évoluer ensuite avec Claude Code.
"""
from __future__ import annotations

import datetime
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from functools import wraps
from pathlib import Path

from flask import (
    Blueprint,
    Flask,
    Response,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

APP_VERSION = "0.1.0"
APP_DIR = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORTFOLIO_PORT", "8001"))
ADMIN_USER = os.environ.get("PORTFOLIO_USER", "admin")
ADMIN_PASS = os.environ.get("PORTFOLIO_PASS", "admin")

app = Flask(__name__)
app.secret_key = os.environ.get("PORTFOLIO_SECRET") or secrets.token_hex(32)


# ── Auth helpers ──────────────────────────────────────────────────

def _logged_in() -> bool:
    return bool(session.get("user"))


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not _logged_in():
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapper


def _require_same_origin():
    origin = request.headers.get("Origin") or ""
    referer = request.headers.get("Referer") or ""
    host = request.host_url.rstrip("/")
    if origin and not origin.startswith(host):
        return jsonify(ok=False, error="Origine non autorisée"), 403
    if not origin and referer and not referer.startswith(host):
        return jsonify(ok=False, error="Referer non autorisé"), 403
    return None


# ── Pages ─────────────────────────────────────────────────────────

@app.route("/")
def index():
    if not _logged_in():
        return redirect(url_for("login"))
    return redirect(url_for("parametres"))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        u = (request.form.get("username") or "").strip()
        p = (request.form.get("password") or "").strip()
        if u == ADMIN_USER and p == ADMIN_PASS:
            session["user"] = u
            return redirect(request.args.get("next") or url_for("parametres"))
        error = "Identifiants invalides"
    return render_template("login.html", error=error, app_version=APP_VERSION)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/parametres")
@login_required
def parametres():
    return render_template(
        "parametres.html",
        app_version=APP_VERSION,
        app_dir=str(APP_DIR),
        user=session.get("user"),
    )


# ── Restart ───────────────────────────────────────────────────────

def _schedule_restart(delay: float = 10.0):
    """Quitte avec exit code 42 → boucle du _run_serveur.bat relance.

    Si lancé hors .bat (dev direct), spawn un nouveau process puis exit 0.
    """
    def _do():
        time.sleep(float(delay))
        launcher = (os.environ.get("PORTFOLIO_LAUNCHER") or "").strip().upper()
        if launcher == "BAT":
            os._exit(42)
        try:
            args = [sys.executable] + sys.argv
            flags = 0
            if sys.platform == "win32":
                try:
                    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
                except AttributeError:
                    flags = subprocess.CREATE_NEW_PROCESS_GROUP
            subprocess.Popen(
                args,
                cwd=str(APP_DIR),
                creationflags=flags if sys.platform == "win32" else 0,
                start_new_session=(sys.platform != "win32"),
            )
            time.sleep(1.5)
        except Exception:
            pass
        os._exit(0)

    threading.Thread(target=_do, daemon=True).start()


# ── Deploy blueprint ──────────────────────────────────────────────

deploy_bp = Blueprint("deploy", __name__)


def _git(*args, timeout=10):
    return subprocess.run(
        ["git", *args], cwd=str(APP_DIR),
        capture_output=True, text=True, timeout=timeout,
    )


@deploy_bp.post("/api/deploy/pull")
@login_required
def api_deploy_pull():
    chk = _require_same_origin()
    if chk:
        return chk

    def gen():
        try:
            yield f"data: {json.dumps({'step': 'log', 'line': f'Dossier : {APP_DIR}'})}\n\n"
            cp = _git("rev-parse", "--git-dir", timeout=2)
            if cp.returncode != 0:
                yield f"data: {json.dumps({'step': 'error', 'error': 'Pas un dépôt git'})}\n\n"
                return

            remote = _git("remote", "get-url", "origin", timeout=2)
            if remote.returncode == 0:
                yield f"data: {json.dumps({'step': 'log', 'line': f'Remote : {remote.stdout.strip()}'})}\n\n"

            yield f"data: {json.dumps({'step': 'fetch', 'message': 'git fetch origin main…'})}\n\n"
            fetch = _git("fetch", "--prune", "origin", "main", timeout=20)
            if fetch.returncode != 0:
                yield f"data: {json.dumps({'step': 'error', 'error': fetch.stderr.strip() or 'fetch failed'})}\n\n"
                return

            local = _git("rev-parse", "HEAD", timeout=2).stdout.strip()
            remote_h = _git("rev-parse", "origin/main", timeout=2).stdout.strip()
            if local == remote_h:
                yield f"data: {json.dumps({'step': 'done', 'updated': False, 'message': 'Déjà à jour', 'local_hash': local[:7], 'remote_hash': remote_h[:7]})}\n\n"
                return

            try:
                (APP_DIR / ".last_commit_hash").write_text(local, encoding="utf-8")
                yield f"data: {json.dumps({'step': 'log', 'line': f'Commit actuel sauvegardé ({local[:7]})'})}\n\n"
            except Exception:
                pass

            # Stash si modifs locales
            status = _git("status", "--porcelain", timeout=5)
            if status.stdout.strip():
                yield f"data: {json.dumps({'step': 'log', 'line': 'Modifs locales → stash'})}\n\n"
                _git("stash", "push", "-m", f"auto-stash {remote_h[:7]}", timeout=5)

            # S'assurer d'être sur main
            cur = _git("branch", "--show-current", timeout=2).stdout.strip()
            if cur and cur != "main":
                co = _git("checkout", "main", timeout=5)
                if co.returncode != 0:
                    _git("checkout", "-B", "main", "origin/main", timeout=5)

            yield f"data: {json.dumps({'step': 'pull', 'message': 'git pull --ff-only…'})}\n\n"
            pull = _git("pull", "--ff-only", "origin", "main", timeout=20)
            if pull.returncode != 0:
                yield f"data: {json.dumps({'step': 'log', 'line': 'ff-only échoué → reset --hard origin/main'})}\n\n"
                reset = _git("reset", "--hard", "origin/main", timeout=10)
                if reset.returncode != 0:
                    yield f"data: {json.dumps({'step': 'error', 'error': reset.stderr.strip()})}\n\n"
                    return

            # pip install si requirements.txt
            req = APP_DIR / "requirements.txt"
            if req.exists():
                yield f"data: {json.dumps({'step': 'log', 'line': 'pip install -r requirements.txt…'})}\n\n"
                try:
                    subprocess.run(
                        [sys.executable, "-m", "pip", "install", "-r", str(req), "--quiet"],
                        cwd=str(APP_DIR), capture_output=True, text=True, timeout=120,
                    )
                except Exception:
                    pass

            new_hash = _git("rev-parse", "HEAD", timeout=2).stdout.strip()
            try:
                (APP_DIR / ".last_commit_hash").write_text(local, encoding="utf-8")
            except Exception:
                pass

            _schedule_restart(delay=10.0)
            yield f"data: {json.dumps({'step': 'done', 'updated': True, 'restarting': True, 'local_hash': local[:7], 'remote_hash': new_hash[:7], 'message': 'MAJ appliquée, redémarrage dans 10 s'})}\n\n"
        except subprocess.TimeoutExpired:
            yield f"data: {json.dumps({'step': 'error', 'error': 'Timeout'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'step': 'error', 'error': str(e)})}\n\n"

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@deploy_bp.post("/api/deploy/restart")
@login_required
def api_deploy_restart():
    _schedule_restart(delay=5.0)
    return jsonify(ok=True, message="Redémarrage dans 5 s")


@deploy_bp.post("/api/deploy/pull-from-404")
def api_deploy_pull_from_404():
    chk = _require_same_origin()
    if chk:
        return chk
    try:
        cur = _git("rev-parse", "HEAD", timeout=2).stdout.strip()
        if cur:
            try:
                (APP_DIR / ".last_commit_hash").write_text(cur, encoding="utf-8")
            except Exception:
                pass
        cur_b = _git("branch", "--show-current", timeout=2).stdout.strip()
        if cur_b and cur_b != "main":
            co = _git("checkout", "main", timeout=5)
            if co.returncode != 0:
                _git("checkout", "-B", "main", "origin/main", timeout=5)
        _git("fetch", "--prune", "origin", "main", timeout=20)
        pull = _git("pull", "--ff-only", "origin", "main", timeout=20)
        if pull.returncode != 0:
            reset = _git("reset", "--hard", "origin/main", timeout=10)
            if reset.returncode != 0:
                return jsonify(ok=False, error=reset.stderr.strip()), 500
        _schedule_restart(delay=5.0)
        return jsonify(ok=True, message="MAJ + redémarrage dans 5 s")
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@deploy_bp.post("/api/deploy/rollback")
def api_deploy_rollback():
    chk = _require_same_origin()
    if chk:
        return chk
    try:
        last = APP_DIR / ".last_commit_hash"
        if not last.exists():
            prev = _git("rev-parse", "HEAD~1", timeout=2)
            if prev.returncode != 0:
                return jsonify(ok=False, error="Aucun commit précédent"), 400
            target = prev.stdout.strip()
        else:
            target = last.read_text(encoding="utf-8").strip()
        if not target:
            return jsonify(ok=False, error="Hash invalide"), 400
        chk2 = _git("cat-file", "-e", target, timeout=2)
        if chk2.returncode != 0:
            return jsonify(ok=False, error=f"Commit {target[:7]} introuvable"), 400
        reset = _git("reset", "--hard", target, timeout=10)
        if reset.returncode != 0:
            return jsonify(ok=False, error=reset.stderr.strip()), 500
        _schedule_restart(delay=5.0)
        return jsonify(ok=True, message=f"Rollback vers {target[:7]} + redémarrage dans 5 s",
                       commit_hash=target[:7])
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@deploy_bp.get("/api/deploy/health")
def api_deploy_health():
    try:
        cur = _git("rev-parse", "HEAD", timeout=2).stdout.strip()[:7] or "unknown"
        last = APP_DIR / ".last_commit_hash"
        can_rollback = last.exists()
        rb = None
        if can_rollback:
            try:
                rb = last.read_text(encoding="utf-8").strip()[:7]
            except Exception:
                can_rollback = False
        return jsonify(ok=True, current_hash=cur, can_rollback=can_rollback,
                       rollback_hash=rb, version=APP_VERSION,
                       server_time=datetime.datetime.now().isoformat(timespec="seconds"))
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@deploy_bp.get("/api/deploy/remote")
@login_required
def api_deploy_remote_get():
    cp = _git("remote", "get-url", "origin", timeout=3)
    if cp.returncode != 0:
        return jsonify(ok=False, error="Pas de remote origin"), 400
    return jsonify(ok=True, url=cp.stdout.strip(), app_dir=str(APP_DIR))


app.register_blueprint(deploy_bp)


# ── 404 réparation ────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(_e):
    return render_template("parametres.html",
                           app_version=APP_VERSION, app_dir=str(APP_DIR),
                           user=session.get("user"), not_found=True), 404


# ── Main ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    is_prod = "--prod" in sys.argv
    print(f"[Portfolio] v{APP_VERSION} → http://127.0.0.1:{PORT}  (prod={is_prod})")
    if is_prod:
        from waitress import serve
        serve(app, host="0.0.0.0", port=PORT, threads=8)
    else:
        app.run(host="0.0.0.0", port=PORT, debug=True, use_reloader=False)
