"""
Blueprint : /api/deploy/*
Extrait de app.py — routes de déploiement Git et redémarrage.

Inclut :
  POST /api/deploy/pull              (SSE, admin) — "Mettre à jour et redémarrer"
  POST /api/deploy/restart           (admin)
  POST /api/deploy/pull-from-404     (sans auth — réparation depuis 404)
  POST /api/deploy/rollback          (sans auth — réparation depuis 404)
  GET  /api/deploy/health            (sans auth)
  GET  /api/deploy/validation-status (sans auth)
  POST /api/deploy/confirm-validation (sans auth)
"""

import datetime
import json
import subprocess
import sys

from flask import Blueprint, Response, jsonify

from app import (
    APP_DIR,
    _cancel_validation_timer,
    _require_same_origin,
    _schedule_restart,
    _start_validation_timer,
    _VALIDATION_TIMEOUT_SECONDS,
    _write_pending_validation,
    create_snapshot,
    logger,
    login_required,
    role_required,
)

deploy_bp = Blueprint("deploy", __name__)


# ── Réparation sans auth (accessible depuis 404) ──────────────────

@deploy_bp.post("/api/deploy/pull-from-404")
def api_deploy_pull_from_404():
    """Pull Git simple depuis la page 404 (sans auth pour permettre réparation)."""
    chk = _require_same_origin()
    if chk:
        return chk

    try:
        # Vérifier que c'est un dépôt git
        cp = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp.returncode != 0:
            return jsonify(ok=False, error="Pas un dépôt git"), 400

        # SAFETY: Sauvegarder le commit actuel pour rollback
        cp2 = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        local_hash_full = (cp2.stdout or "").strip() if cp2.returncode == 0 else None
        if local_hash_full:
            try:
                last_commit_file = APP_DIR / ".last_commit_hash"
                last_commit_file.write_text(local_hash_full, encoding="utf-8")
            except Exception:
                pass

        # SAFETY: Créer snapshot DB avant mise à jour
        try:
            create_snapshot(label="before_update_404", is_auto=False)
        except Exception:
            pass

        # S'assurer d'être sur main
        branch_cp = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=str(APP_DIR), capture_output=True, text=True, timeout=2,
        )
        cur_branch = (branch_cp.stdout or "").strip() if branch_cp.returncode == 0 else ""
        if cur_branch and cur_branch != "main":
            co = subprocess.run(["git", "checkout", "main"],
                                cwd=str(APP_DIR), capture_output=True, text=True, timeout=5)
            if co.returncode != 0:
                subprocess.run(["git", "checkout", "-B", "main", "origin/main"],
                               cwd=str(APP_DIR), capture_output=True, text=True, timeout=5)

        # Fetch
        fetch = subprocess.run(
            ["git", "fetch", "--prune", "origin", "main"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=15,
        )
        if fetch.returncode != 0:
            return jsonify(ok=False, error=f"git fetch échoué: {fetch.stderr or fetch.stdout}"), 500

        # Pull (ff-only d'abord, puis reset --hard en fallback)
        pull = subprocess.run(
            ["git", "pull", "--ff-only", "origin", "main"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=30,
        )
        if pull.returncode != 0:
            logger.warning("Deploy pull-from-404: ff-only failed, falling back to git reset --hard origin/main")
            reset = subprocess.run(
                ["git", "reset", "--hard", "origin/main"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=10,
            )
            if reset.returncode != 0:
                return jsonify(ok=False, error=f"git reset --hard échoué: {reset.stderr or reset.stdout}"), 500

        logger.info("Deploy pull from 404: mise à jour appliquée, redémarrage dans 5s")
        _schedule_restart(delay=5.0)
        return jsonify(ok=True, message="Mise à jour appliquée. Redémarrage automatique dans 5 s…")

    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="Timeout lors du pull"), 500
    except Exception as e:
        logger.exception("Deploy pull from 404 error")
        return jsonify(ok=False, error=str(e)), 500


@deploy_bp.post("/api/deploy/rollback")
def api_deploy_rollback():
    """Rollback vers le commit précédent (sans auth pour permettre réparation depuis 404)."""
    chk = _require_same_origin()
    if chk:
        return chk

    try:
        # Vérifier que c'est un dépôt git
        cp = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp.returncode != 0:
            return jsonify(ok=False, error="Pas un dépôt git"), 400

        # Lire le hash du commit précédent sauvegardé
        last_commit_file = APP_DIR / ".last_commit_hash"
        if not last_commit_file.exists():
            # Essayer de récupérer le commit précédent via git
            cp2 = subprocess.run(
                ["git", "rev-parse", "HEAD~1"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            if cp2.returncode != 0:
                return jsonify(ok=False, error="Aucun commit précédent trouvé pour rollback"), 400
            rollback_hash = cp2.stdout.strip()
        else:
            rollback_hash = last_commit_file.read_text(encoding="utf-8").strip()

        if not rollback_hash:
            return jsonify(ok=False, error="Hash de commit invalide pour rollback"), 400

        # Vérifier que le commit existe
        cp3 = subprocess.run(
            ["git", "cat-file", "-e", rollback_hash],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if cp3.returncode != 0:
            return jsonify(ok=False, error=f"Commit {rollback_hash[:7]} introuvable"), 400

        # SAFETY: Créer snapshot DB avant rollback
        try:
            create_snapshot(label="before_rollback", is_auto=False)
        except Exception:
            pass

        # Reset hard vers le commit précédent
        reset = subprocess.run(
            ["git", "reset", "--hard", rollback_hash],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if reset.returncode != 0:
            err = (reset.stderr or reset.stdout or "Erreur reset").strip()
            return jsonify(ok=False, error=f"Rollback échoué: {err}"), 500

        logger.info("Deploy rollback: retour au commit %s, redémarrage dans 5s", rollback_hash[:7])
        _schedule_restart(delay=5.0)
        return jsonify(ok=True, message=f"Rollback effectué vers {rollback_hash[:7]}. Redémarrage automatique dans 5 s…", commit_hash=rollback_hash[:7])

    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="Timeout lors du rollback"), 500
    except Exception as e:
        logger.exception("Deploy rollback error")
        return jsonify(ok=False, error=str(e)), 500


# ── Routes admin (auth requise) ────────────────────────────────────

@deploy_bp.post("/api/deploy/pull")
@login_required
@role_required('admin')
def api_deploy_pull():
    """Streaming git pull depuis origin/main puis redémarrage (admin uniquement). Réponse SSE."""
    chk = _require_same_origin()
    if chk:
        return chk

    def generate():
        try:
            # v30.2 : log explicite du dossier cible pour éviter les confusions
            # (ancien vs nouveau répertoire quand plusieurs clones coexistent).
            yield f"data: {json.dumps({'step': 'log', 'line': f'Dossier cible : {APP_DIR}'}, ensure_ascii=False)}\n\n"

            cp = subprocess.run(
                ["git", "rev-parse", "--git-dir"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            if cp.returncode != 0:
                yield f"data: {json.dumps({'step': 'error', 'error': 'Pas un dépôt git'}, ensure_ascii=False)}\n\n"
                return

            # Récupère l'URL du remote pour confirmer qu'on pointe bien vers le bon repo
            remote_cp = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                cwd=str(APP_DIR), capture_output=True, text=True, timeout=2,
            )
            if remote_cp.returncode == 0:
                yield f"data: {json.dumps({'step': 'log', 'line': f'Remote origin : {remote_cp.stdout.strip()}'}, ensure_ascii=False)}\n\n"

            yield f"data: {json.dumps({'step': 'fetch', 'message': 'git fetch --prune origin main...'}, ensure_ascii=False)}\n\n"
            fetch = subprocess.run(
                ["git", "fetch", "--prune", "origin", "main"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=15,
            )
            if fetch.returncode != 0:
                err = (fetch.stderr or fetch.stdout or "Erreur inconnue").strip()
                yield f"data: {json.dumps({'step': 'error', 'error': f'git fetch échoué: {err}'}, ensure_ascii=False)}\n\n"
                return
            if fetch.stdout:
                for line in fetch.stdout.strip().splitlines():
                    if line.strip():
                        yield f"data: {json.dumps({'step': 'log', 'line': line.strip()}, ensure_ascii=False)}\n\n"
            if fetch.stderr:
                for line in fetch.stderr.strip().splitlines():
                    if line.strip():
                        yield f"data: {json.dumps({'step': 'log', 'line': line.strip()}, ensure_ascii=False)}\n\n"

            cp2 = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            local_hash = (cp2.stdout or "").strip()[:7] if cp2.returncode == 0 else "unknown"
            local_hash_full = (cp2.stdout or "").strip() if cp2.returncode == 0 else "unknown"
            cp3 = subprocess.run(
                ["git", "rev-parse", "origin/main"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            remote_hash = (cp3.stdout or "").strip()[:7] if cp3.returncode == 0 else "unknown"
            remote_hash_full = (cp3.stdout or "").strip() if cp3.returncode == 0 else "unknown"

            if local_hash == remote_hash:
                yield f"data: {json.dumps({'step': 'done', 'updated': False, 'restarting': False, 'local_hash': local_hash, 'remote_hash': remote_hash, 'message': 'Déjà à jour'}, ensure_ascii=False)}\n\n"
                return

            # ── SAFETY: Sauvegarder le commit actuel pour rollback possible ──
            if local_hash_full != "unknown":
                try:
                    last_commit_file = APP_DIR / ".last_commit_hash"
                    last_commit_file.write_text(local_hash_full, encoding="utf-8")
                    yield f"data: {json.dumps({'step': 'log', 'line': f'Commit actuel sauvegardé ({local_hash}) pour rollback possible'}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    logger.warning("Failed to save last commit hash: %s", e)

            # ── SAFETY: Créer un snapshot DB automatique avant mise à jour ──
            try:
                yield f"data: {json.dumps({'step': 'log', 'line': 'Création snapshot DB automatique avant mise à jour...'}, ensure_ascii=False)}\n\n"
                snapshot_file = create_snapshot(label="before_update", is_auto=False)
                yield f"data: {json.dumps({'step': 'log', 'line': f'Snapshot créé: {snapshot_file}'}, ensure_ascii=False)}\n\n"
            except Exception as e:
                logger.warning("Failed to create snapshot before update: %s", e)
                yield f"data: {json.dumps({'step': 'log', 'line': f'Impossible de créer snapshot: {e}'}, ensure_ascii=False)}\n\n"

            # Fichiers sous logs/ souvent verrouillés par l'app : on les ignore pour le pull
            log_paths = []
            ls_logs = subprocess.run(
                ["git", "ls-files", "logs/"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=5,
            )
            if ls_logs.returncode == 0 and ls_logs.stdout.strip():
                for p in ls_logs.stdout.strip().splitlines():
                    p = p.strip()
                    if p:
                        log_paths.append(p)
                for p in log_paths:
                    subprocess.run(
                        ["git", "update-index", "--assume-unchanged", p],
                        cwd=str(APP_DIR),
                        capture_output=True,
                        timeout=5,
                    )
                if log_paths:
                    yield f"data: {json.dumps({'step': 'log', 'line': 'Fichiers logs/ ignorés pour le pull (évite fichiers verrouillés)'}, ensure_ascii=False)}\n\n"

            status = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=5,
            )
            has_local_changes = status.returncode == 0 and bool(status.stdout.strip())
            if has_local_changes:
                yield f"data: {json.dumps({'step': 'log', 'line': 'Modifications locales détectées, stash...'}, ensure_ascii=False)}\n\n"
                stash = subprocess.run(
                    ["git", "stash", "push", "-m", f"Auto-stash avant pull {remote_hash}"],
                    cwd=str(APP_DIR),
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if stash.returncode != 0:
                    err = (stash.stderr or stash.stdout or "Erreur stash").strip()
                    yield f"data: {json.dumps({'step': 'error', 'error': f'Impossible de stasher: {err}'}, ensure_ascii=False)}\n\n"
                    # Restaurer assume-unchanged avant de quitter
                    for p in log_paths:
                        subprocess.run(
                            ["git", "update-index", "--no-assume-unchanged", p],
                            cwd=str(APP_DIR),
                            capture_output=True,
                            timeout=5,
                        )
                    return

            # ── S'assurer d'être sur la branche main ──
            branch_cp = subprocess.run(
                ["git", "branch", "--show-current"],
                cwd=str(APP_DIR), capture_output=True, text=True, timeout=2,
            )
            cur_branch = (branch_cp.stdout or "").strip() if branch_cp.returncode == 0 else ""
            if cur_branch and cur_branch != "main":
                yield f"data: {json.dumps({'step': 'log', 'line': f'Branche actuelle: {cur_branch} → checkout main'}, ensure_ascii=False)}\n\n"
                co = subprocess.run(
                    ["git", "checkout", "main"],
                    cwd=str(APP_DIR), capture_output=True, text=True, timeout=5,
                )
                if co.returncode != 0:
                    subprocess.run(["git", "checkout", "-B", "main", "origin/main"],
                                   cwd=str(APP_DIR), capture_output=True, text=True, timeout=5)

            yield f"data: {json.dumps({'step': 'pull', 'message': 'git pull --ff-only origin main...'}, ensure_ascii=False)}\n\n"
            pull = subprocess.run(
                ["git", "pull", "--ff-only", "origin", "main"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=15,
            )
            if pull.stdout:
                for line in pull.stdout.strip().splitlines():
                    if line.strip():
                        yield f"data: {json.dumps({'step': 'log', 'line': line.strip()}, ensure_ascii=False)}\n\n"
            if pull.stderr:
                for line in pull.stderr.strip().splitlines():
                    if line.strip():
                        yield f"data: {json.dumps({'step': 'log', 'line': line.strip()}, ensure_ascii=False)}\n\n"
            if pull.returncode != 0:
                yield f"data: {json.dumps({'step': 'log', 'line': 'Fast-forward impossible — forçage sync sur origin/main (git reset --hard)...'}, ensure_ascii=False)}\n\n"
                logger.warning("Deploy pull: ff-only failed, falling back to git reset --hard origin/main")
                reset = subprocess.run(
                    ["git", "reset", "--hard", "origin/main"],
                    cwd=str(APP_DIR),
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if reset.returncode != 0:
                    err = (reset.stderr or reset.stdout or "Erreur reset").strip()
                    yield f"data: {json.dumps({'step': 'error', 'error': f'git reset --hard échoué: {err}'}, ensure_ascii=False)}\n\n"
                    for p in log_paths:
                        subprocess.run(
                            ["git", "update-index", "--no-assume-unchanged", p],
                            cwd=str(APP_DIR), capture_output=True, timeout=5,
                        )
                    return
                yield f"data: {json.dumps({'step': 'log', 'line': 'Synchronisation forcée sur origin/main réussie'}, ensure_ascii=False)}\n\n"

            for p in log_paths:
                subprocess.run(
                    ["git", "update-index", "--no-assume-unchanged", p],
                    cwd=str(APP_DIR),
                    capture_output=True,
                    timeout=5,
                )

            # ── SAFETY: Sauvegarder le nouveau hash après pull réussi ──
            cp4 = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(APP_DIR),
                capture_output=True,
                text=True,
                timeout=2,
            )
            new_hash_full = (cp4.stdout or "").strip() if cp4.returncode == 0 else None
            if new_hash_full:
                try:
                    last_commit_file = APP_DIR / ".last_commit_hash"
                    last_commit_file.write_text(new_hash_full, encoding="utf-8")
                except Exception:
                    pass

            # ── SAFETY: Installer les nouvelles dépendances avant le redémarrage ──
            req_file = APP_DIR / "requirements.txt"
            if req_file.exists():
                yield f"data: {json.dumps({'step': 'log', 'line': 'Installation des dépendances (pip install)...'}, ensure_ascii=False)}\n\n"
                try:
                    pip_result = subprocess.run(
                        [sys.executable, "-m", "pip", "install", "-r", str(req_file),
                         "--quiet", "--no-warn-script-location"],
                        cwd=str(APP_DIR),
                        capture_output=True,
                        text=True,
                        timeout=120,
                    )
                    if pip_result.returncode == 0:
                        yield f"data: {json.dumps({'step': 'log', 'line': 'Dépendances à jour'}, ensure_ascii=False)}\n\n"
                    else:
                        err_pip = (pip_result.stderr or pip_result.stdout or "").strip()[:300]
                        yield f"data: {json.dumps({'step': 'log', 'line': f'pip install partiel (app redémarre quand même): {err_pip}'}, ensure_ascii=False)}\n\n"
                        logger.warning("Deploy pull: pip install partiel: %s", err_pip)
                except subprocess.TimeoutExpired:
                    yield f"data: {json.dumps({'step': 'log', 'line': 'pip install timeout — redémarrage quand même'}, ensure_ascii=False)}\n\n"
                    logger.warning("Deploy pull: pip install timeout")
                except Exception as e_pip:
                    yield f"data: {json.dumps({'step': 'log', 'line': f'pip install erreur: {e_pip}'}, ensure_ascii=False)}\n\n"
                    logger.warning("Deploy pull: pip install erreur: %s", e_pip)

            logger.info("Deploy pull: mise à jour appliquée, redémarrage demandé")
            _write_pending_validation(local_hash_full)
            _start_validation_timer()
            _schedule_restart(delay=10.0)
            yield f"data: {json.dumps({'step': 'done', 'updated': True, 'restarting': True, 'local_hash': local_hash, 'remote_hash': remote_hash, 'message': 'Mise à jour appliquée, redémarrage dans 10 s', 'restart_delay_s': 10, 'validation_required': True, 'validation_timeout_s': _VALIDATION_TIMEOUT_SECONDS}, ensure_ascii=False)}\n\n"
        except subprocess.TimeoutExpired:
            yield f"data: {json.dumps({'step': 'error', 'error': 'Timeout lors du pull'}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.exception("Deploy pull error")
            yield f"data: {json.dumps({'step': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Gestion du remote Git (admin) ─────────────────────────────────
# Permet de changer l'URL origin à distance, pratique quand on a
# migré vers un nouveau repo GitHub sans accès physique au PC hébergeur.

_ALLOWED_REMOTE_HOSTS = ("https://github.com/", "git@github.com:")


@deploy_bp.get("/api/deploy/remote")
@login_required
@role_required('admin')
def api_deploy_remote_get():
    """Retourne l'URL du remote `origin` actuel (admin)."""
    try:
        cp = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=str(APP_DIR), capture_output=True, text=True, timeout=3,
        )
        if cp.returncode != 0:
            return jsonify(ok=False, error=(cp.stderr or "Pas de remote origin").strip()), 400
        return jsonify(ok=True, url=cp.stdout.strip(), app_dir=str(APP_DIR))
    except Exception as e:
        logger.exception("Deploy remote get error")
        return jsonify(ok=False, error=str(e)), 500


@deploy_bp.post("/api/deploy/set-remote")
@login_required
@role_required('admin')
def api_deploy_set_remote():
    """Change l'URL du remote `origin` (admin).

    Body JSON : `{ "url": "https://github.com/<owner>/<repo>.git" }`
    Seules les URLs GitHub HTTPS/SSH sont autorisées (préfixe whitelist).
    """
    chk = _require_same_origin()
    if chk:
        return chk
    from flask import request
    payload = request.get_json(force=True, silent=True) or {}
    url = (payload.get("url") or "").strip()
    if not url:
        return jsonify(ok=False, error="url requis"), 400
    if not any(url.startswith(prefix) for prefix in _ALLOWED_REMOTE_HOSTS):
        return jsonify(ok=False, error=f"URL non autorisée. Préfixe attendu : {', '.join(_ALLOWED_REMOTE_HOSTS)}"), 400
    try:
        # set-url (origin doit exister — sinon fallback add)
        cp = subprocess.run(
            ["git", "remote", "set-url", "origin", url],
            cwd=str(APP_DIR), capture_output=True, text=True, timeout=5,
        )
        if cp.returncode != 0:
            # Tentative d'ajout si pas encore de remote
            cp2 = subprocess.run(
                ["git", "remote", "add", "origin", url],
                cwd=str(APP_DIR), capture_output=True, text=True, timeout=5,
            )
            if cp2.returncode != 0:
                return jsonify(ok=False, error=(cp.stderr or cp2.stderr or "set-url failed").strip()), 500
        # Vérifie la nouvelle URL
        verify = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=str(APP_DIR), capture_output=True, text=True, timeout=3,
        )
        new_url = verify.stdout.strip() if verify.returncode == 0 else url
        return jsonify(ok=True, url=new_url)
    except Exception as e:
        logger.exception("Deploy set-remote error")
        return jsonify(ok=False, error=str(e)), 500


@deploy_bp.post("/api/deploy/restart")
@login_required
@role_required('admin')
def api_deploy_restart():
    """Redémarre le serveur sans faire de pull (admin uniquement)."""
    try:
        logger.info("Restart demandé par admin (sans pull)")
        _schedule_restart(delay=5.0)
        return jsonify(ok=True, message="Redémarrage programmé dans 5 secondes")
    except Exception as e:
        logger.error("Erreur lors du redémarrage: %s", e)
        return jsonify(ok=False, error=str(e)), 500


# ── Santé et validation (sans auth) ───────────────────────────────

@deploy_bp.get("/api/deploy/check-deps")
@login_required
@role_required('admin')
def api_deploy_check_deps():
    """Compare requirements.txt aux paquets Python installés.

    Retourne un statut par dépendance :
      ok       — installé et version >= requise
      outdated — installé mais version < requise
      missing  — non installé / non importable
    """
    import importlib
    import re

    req_path = APP_DIR / "requirements.txt"
    if not req_path.exists():
        return jsonify(ok=False, error="requirements.txt introuvable"), 500

    # Mapping nom paquet pip -> nom module Python (quand differents)
    PIP_TO_MODULE = {
        "pymupdf": "fitz",
        "Pillow": "PIL",
        "python-docx": "docx",
        "apscheduler": "apscheduler",
        "reportlab": "reportlab",
        "openpyxl": "openpyxl",
        "waitress": "waitress",
        "pypdf": "pypdf",
        "rjsmin": "rjsmin",
        "csscompressor": "csscompressor",
        "flask": "flask",
    }

    def _parse_version(s: str):
        """Convertit '1.2.3' ou '1.2.3.dev1' en tuple comparable."""
        nums = []
        for part in re.split(r"[.\-+]", s or ""):
            m = re.match(r"^(\d+)", part)
            if m:
                nums.append(int(m.group(1)))
            else:
                break
        return tuple(nums) if nums else (0,)

    deps = []
    lines = req_path.read_text(encoding="utf-8").splitlines()
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Parse "name>=version" / "name==version" / "name"
        m = re.match(r"^([A-Za-z0-9_.\-]+)\s*(>=|==|<=|>|<|~=)?\s*([0-9A-Za-z._\-]+)?\s*$", line)
        if not m:
            continue
        pip_name = m.group(1)
        op = m.group(2) or ""
        req_ver = m.group(3) or ""

        module_name = PIP_TO_MODULE.get(pip_name, pip_name.lower().replace("-", "_"))

        installed_ver = None
        status = "missing"
        error_msg = None

        try:
            mod = importlib.import_module(module_name)
            installed_ver = (
                getattr(mod, "__version__", None)
                or getattr(mod, "VERSION", None)
                or getattr(mod, "version", None)
            )
            if isinstance(installed_ver, tuple):
                installed_ver = ".".join(str(x) for x in installed_ver)
            installed_ver = str(installed_ver) if installed_ver else "?"
            status = "ok"
            if req_ver and op in (">=", "=="):
                if _parse_version(installed_ver) < _parse_version(req_ver):
                    status = "outdated"
        except Exception as e:
            error_msg = str(e)[:120]

        deps.append({
            "name": pip_name,
            "required": (op + req_ver) if req_ver else "*",
            "installed": installed_ver,
            "status": status,
            "module": module_name,
            "error": error_msg,
        })

    summary = {
        "total": len(deps),
        "ok": sum(1 for d in deps if d["status"] == "ok"),
        "outdated": sum(1 for d in deps if d["status"] == "outdated"),
        "missing": sum(1 for d in deps if d["status"] == "missing"),
    }
    return jsonify(
        ok=True,
        deps=deps,
        summary=summary,
        python_version=sys.version.split()[0],
        requirements_file=str(req_path),
    )


@deploy_bp.post("/api/deploy/install-deps")
@login_required
@role_required('admin')
def api_deploy_install_deps():
    """Lance `pip install -r requirements.txt` et retourne la sortie.

    Utile quand le check-deps signale des manques sans avoir à redémarrer.
    """
    try:
        cp = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", str(APP_DIR / "requirements.txt"), "--upgrade"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=180,
        )
        return jsonify(
            ok=(cp.returncode == 0),
            returncode=cp.returncode,
            stdout=(cp.stdout or "")[-4000:],
            stderr=(cp.stderr or "")[-2000:],
        )
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="Timeout pip install (>180s)"), 504
    except Exception as e:
        logger.exception("install-deps failed")
        return jsonify(ok=False, error=str(e)), 500


@deploy_bp.get("/api/deploy/health")
def api_deploy_health():
    """Health check simple pour vérifier que l'app répond (accessible sans auth pour 404)."""
    try:
        cp = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(APP_DIR),
            capture_output=True,
            text=True,
            timeout=2,
        )
        current_hash = (cp.stdout or "").strip()[:7] if cp.returncode == 0 else "unknown"

        last_commit_file = APP_DIR / ".last_commit_hash"
        can_rollback = last_commit_file.exists()
        rollback_hash = None
        if can_rollback:
            try:
                rollback_hash = last_commit_file.read_text(encoding="utf-8").strip()[:7]
            except Exception:
                can_rollback = False

        return jsonify(ok=True, current_hash=current_hash, can_rollback=can_rollback, rollback_hash=rollback_hash)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@deploy_bp.get("/api/deploy/validation-status")
def api_deploy_validation_status():
    """Statut de validation post-mise à jour (sans auth — accessible juste après un restart)."""
    pv_file = APP_DIR / ".pending_validation"
    error_log_file = APP_DIR / ".validation_error_log"

    result: dict = {"pending": False}

    if pv_file.exists():
        try:
            pv_data = json.loads(pv_file.read_text(encoding="utf-8"))
            triggered_at = datetime.datetime.fromisoformat(pv_data["triggered_at"])
            timeout_s = int(pv_data.get("timeout_seconds", _VALIDATION_TIMEOUT_SECONDS))
            elapsed = (datetime.datetime.now() - triggered_at).total_seconds()
            remaining = max(0, timeout_s - int(elapsed))
            result = {
                "pending": True,
                "triggered_at": pv_data["triggered_at"],
                "timeout_seconds": timeout_s,
                "remaining_seconds": remaining,
                "previous_commit": (pv_data.get("previous_commit") or "")[:7],
            }
        except Exception as e:
            result = {"pending": False, "error": str(e)}

    if error_log_file.exists():
        try:
            result["last_error"] = json.loads(error_log_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    return jsonify(result)


@deploy_bp.post("/api/deploy/confirm-validation")
def api_deploy_confirm_validation():
    """Confirme que l'app fonctionne correctement après une mise à jour (sans auth requis)."""
    _cancel_validation_timer()
    try:
        (APP_DIR / ".pending_validation").unlink(missing_ok=True)
    except Exception:
        pass
    try:
        (APP_DIR / ".validation_error_log").unlink(missing_ok=True)
    except Exception:
        pass
    logger.info("Mise à jour post-pull validée par l'utilisateur")
    return jsonify(ok=True, message="Mise à jour validée")
