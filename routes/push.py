"""ProspUp — Blueprint Push (templates, catégories, génération emails)."""
from __future__ import annotations

import datetime
import json
import os
import re
import shutil
import unicodedata
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from werkzeug.utils import secure_filename

from app import _audit_log, _init_user_db, _parse_json_str_list, log_activity, logger
from config import APP_DIR, APP_VERSION, DATA_DIR, OUTLOOK_AVAILABLE
from utils.auth import _uid, login_required, role_required, validate_payload
from utils.candidates import _generate_candidate_description_ai, _resolve_dc_pdf_path
from utils.common import _now_iso, _row_to_dict
from utils.db import _conn
from utils.files import _validate_upload
from utils.push import _generate_eml_file, _resolve_dc_path, _save_to_outlook_drafts
from utils.validation import _safe_row_to_dict, _validate_optional_positive_int, _validate_positive_int

push_bp = Blueprint("push", __name__)


@push_bp.get("/api/templates")
def api_templates_list():
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM templates ORDER BY is_default DESC, updatedAt DESC, id DESC;"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@push_bp.post("/api/templates/save")
def api_templates_save():
    payload, err = validate_payload({'name': str})
    if err:
        return err
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400

    subject = (payload.get("subject") or "").rstrip("\n")
    body = (payload.get("body") or "").rstrip("\n")
    linkedin_body = (payload.get("linkedin_body") or payload.get("linkedinBody") or "").rstrip("\n")
    is_default = 1 if bool(payload.get("is_default")) else 0
    tid = payload.get("id")
    now = _now_iso()

    with _conn() as conn:
        cur = conn.cursor()
        if is_default:
            cur.execute("UPDATE templates SET is_default=0;")

        if tid:
            cur.execute(
                '''
                UPDATE templates
                SET name=?, subject=?, body=?, linkedin_body=?, is_default=?, updatedAt=?
                WHERE id=?;
                ''',
                (name, subject, body, linkedin_body, is_default, now, int(tid)),
            )
            if cur.rowcount == 0:
                tid = None

        if not tid:
            cur.execute(
                '''
                INSERT INTO templates (name, subject, body, linkedin_body, is_default, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                ''',
                (name, subject, body, linkedin_body, is_default, now, now),
            )
            tid = cur.lastrowid

    return jsonify({"ok": True, "id": tid})


@push_bp.post("/api/templates/delete")
def api_templates_delete():
    payload = request.get_json(force=True, silent=False) or {}
    tid = payload.get("id")
    if not tid:
        return jsonify({"ok": False, "error": "id is required"}), 400

    with _conn() as conn:
        # Prevent deleting the last default template: if it's default, we will reassign another
        row = conn.execute("SELECT is_default FROM templates WHERE id=?;", (int(tid),)).fetchone()
        if not row:
            return jsonify({"ok": True})
        was_default = int(row["is_default"] or 0) == 1

        conn.execute("DELETE FROM templates WHERE id=?;", (int(tid),))

        if was_default:
            r2 = conn.execute("SELECT id FROM templates ORDER BY id DESC LIMIT 1;").fetchone()
            if r2:
                conn.execute("UPDATE templates SET is_default=1 WHERE id=?;", (int(r2["id"]),))

    return jsonify({"ok": True})


# ====== Push Categories API ======

@push_bp.get("/api/push-categories")
def api_push_categories_list():
    """Liste les catégories push de l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute("""
            SELECT pc.*,
                   c1.name AS candidate1_name, c1.role AS candidate1_role,
                   c2.name AS candidate2_name, c2.role AS candidate2_role
            FROM push_categories pc
            LEFT JOIN candidates c1 ON pc.candidate1_id = c1.id AND c1.owner_id = pc.owner_id
            LEFT JOIN candidates c2 ON pc.candidate2_id = c2.id AND c2.owner_id = pc.owner_id
            WHERE pc.owner_id=? ORDER BY pc.name;
        """, (uid,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["keywords"] = _parse_json_str_list(d.get("keywords"))
        out.append(d)
    return jsonify(out)


@push_bp.post("/api/push-categories/scan")
def api_push_categories_scan():
    """Scan le dossier push_templates de l'utilisateur pour créer/mettre à jour les catégories."""
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    
    import pathlib
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates"
    if not user_push_dir.is_dir():
        user_push_dir.mkdir(parents=True, exist_ok=True)
        return jsonify({"ok": True, "found": [], "created": 0, "message": "Dossier créé, aucun template trouvé"})

    found = []
    for sub in sorted(user_push_dir.iterdir()):
        if sub.is_dir() and not sub.name.startswith('.'):
            found.append(sub.name)

    now = _now_iso()
    created = 0
    with _conn() as conn:
        for name in found:
            existing = conn.execute("SELECT id FROM push_categories WHERE name=? AND owner_id=?;", (name, uid)).fetchone()
            if not existing:
                # Auto-generate keywords from folder name
                keywords = [kw.strip().lower() for kw in name.replace('_', ' ').replace('-', ' ').split() if kw.strip()]
                conn.execute(
                    "INSERT INTO push_categories (name, keywords, auto_detected, owner_id, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?, ?);",
                    (name, json.dumps(keywords, ensure_ascii=False), uid, now, now)
                )
                created += 1

    return jsonify({"ok": True, "found": found, "created": created})


@push_bp.post("/api/push-categories/save")
def api_push_categories_save():
    """Crée ou met à jour une catégorie push pour l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    
    try:
        payload = request.get_json(force=True, silent=False) or {}
        name = (payload.get("name") or "").strip()
        if not name:
            return jsonify({"ok": False, "error": "name is required"}), 400

        keywords = payload.get("keywords", [])
        if isinstance(keywords, str):
            keywords = [k.strip() for k in keywords.split(",") if k.strip()]
        keywords_json = json.dumps(keywords, ensure_ascii=False)

        no_candidates = 1 if payload.get("no_candidates") else 0

        cid = payload.get("id")
        now = _now_iso()

        with _conn() as conn:
            # S'assurer que la table existe (migration pour DBs existantes)
            try:
                conn.execute("SELECT 1 FROM push_categories LIMIT 1;").fetchone()
            except sqlite3.OperationalError:
                # Table n'existe pas, l'initialiser
                _init_user_db(uid)

            # Auto-migration v32.3 : ajoute no_candidates si colonne manquante
            try:
                pc_cols = {r["name"] for r in conn.execute("PRAGMA table_info(push_categories);").fetchall()}
                for col, typ in (
                    ("candidate1_id", "INTEGER"),
                    ("candidate2_id", "INTEGER"),
                    ("no_candidates", "INTEGER DEFAULT 0"),
                ):
                    if col not in pc_cols:
                        conn.execute(f"ALTER TABLE push_categories ADD COLUMN {col} {typ};")
                conn.commit()
            except Exception as _e:
                app.logger.warning("Auto-migration push_categories: %s", _e)

            if cid:
                # Vérifier que la catégorie appartient à l'utilisateur
                try:
                    existing = conn.execute("SELECT id FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
                    if not existing:
                        return jsonify({"ok": False, "error": "Catégorie non trouvée ou accès refusé"}), 404
                    # Si no_candidates passe à true, on vide les slots candidats
                    if no_candidates:
                        conn.execute(
                            "UPDATE push_categories SET name=?, keywords=?, no_candidates=?, candidate1_id=NULL, candidate2_id=NULL, updatedAt=? WHERE id=? AND owner_id=?;",
                            (name, keywords_json, no_candidates, now, int(cid), uid)
                        )
                    else:
                        conn.execute(
                            "UPDATE push_categories SET name=?, keywords=?, no_candidates=?, updatedAt=? WHERE id=? AND owner_id=?;",
                            (name, keywords_json, no_candidates, now, int(cid), uid)
                        )
                except sqlite3.IntegrityError as e:
                    if "UNIQUE constraint" in str(e):
                        return jsonify({"ok": False, "error": "Une catégorie avec ce nom existe déjà"}), 400
                    raise
            else:
                try:
                    conn.execute(
                        "INSERT INTO push_categories (name, keywords, auto_detected, owner_id, no_candidates, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?, ?, ?);",
                        (name, keywords_json, uid, no_candidates, now, now)
                    )
                    row = conn.execute("SELECT last_insert_rowid() AS id;").fetchone()
                    if not row:
                        return jsonify({"ok": False, "error": "Erreur lors de la création de la catégorie"}), 500
                    cid = row["id"]
                except sqlite3.IntegrityError as e:
                    if "UNIQUE constraint" in str(e):
                        return jsonify({"ok": False, "error": "Une catégorie avec ce nom existe déjà"}), 400
                    raise
                except Exception as e:
                    app.logger.error(f"Erreur lors de la création de catégorie push: {e}", exc_info=True)
                    return jsonify({"ok": False, "error": f"Erreur serveur: {str(e)}"}), 500

        return jsonify({"ok": True, "id": cid})
    except Exception as e:
        app.logger.error(f"Erreur dans api_push_categories_save: {e}", exc_info=True)
        return jsonify({"ok": False, "error": f"Erreur serveur: {str(e)}"}), 500


@push_bp.post("/api/push-categories/delete")
def api_push_categories_delete():
    """Supprime une catégorie push de l'utilisateur connecté."""
    uid = _uid()
    if not uid:
        return jsonify({"ok": False, "error": "Non authentifié"}), 401
    
    payload = request.get_json(force=True, silent=False) or {}
    cid = payload.get("id")
    if not cid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    
    with _conn() as conn:
        # Vérifier que la catégorie appartient à l'utilisateur
        existing = conn.execute("SELECT id FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        if not existing:
            return jsonify({"ok": False, "error": "Catégorie non trouvée ou accès refusé"}), 404
        
        # Supprimer aussi le dossier de templates si il existe
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        if cat_row:
            user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_row["name"]
            if user_push_dir.exists():
                try:
                    shutil.rmtree(user_push_dir)
                except Exception as e:
                    logger.warning("Erreur suppression dossier templates %s: %s", user_push_dir, e)
        
        conn.execute("DELETE FROM push_categories WHERE id=? AND owner_id=?;", (int(cid), uid))
    return jsonify({"ok": True})


@push_bp.get("/api/push-categories/<int:cat_id>/match-candidates")
def api_push_categories_match(cat_id: int):
    """Find top candidates matching a push category's keywords. v11: weighted."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cat_row = conn.execute("SELECT * FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
        if not cat_row:
            return jsonify({"ok": False, "error": "category not found"}), 404

        keywords = _parse_json_str_list(cat_row["keywords"])
        if not keywords:
            keywords = [cat_row["name"].lower()]

        candidates = conn.execute(
            "SELECT * FROM candidates WHERE owner_id=? AND deleted_at IS NULL AND (is_archived IS NULL OR is_archived = 0);",
            (uid,)
        ).fetchall()

    # Score each candidate
    scored = []
    for c in candidates:
        c_dict = dict(c)
        if c_dict.get("is_archived"):
            continue
        skills = _parse_json_str_list(c_dict.get("skills"))
        role = (c_dict.get("role") or "").lower()
        tech = (c_dict.get("tech") or "").lower()
        c_sector = (c_dict.get("sector") or "").lower()
        c_years = c_dict.get("years_experience")
        skills_lower = [s.lower() for s in skills]

        # Build searchable text
        haystack = " ".join(skills_lower) + " " + role + " " + tech + " " + c_sector

        score = 0
        for kw in keywords:
            kw_l = kw.lower()
            # Exact skill match = 3 points
            if kw_l in skills_lower:
                score += 3
            # Partial match in role/tech = 1 point
            elif kw_l in haystack:
                score += 1

        # Bonus for experience
        if c_years and c_years > 0:
            score += min(c_years / 3, 3)

        if score > 0:
            scored.append({
                "id": c_dict["id"],
                "name": c_dict.get("name", ""),
                "role": c_dict.get("role", ""),
                "skills": skills,
                "tech": c_dict.get("tech", ""),
                "status": c_dict.get("status", ""),
                "phone": c_dict.get("phone", ""),
                "years_experience": c_years,
                "score": round(score, 1),
            })

    # Sort by score desc, return top 3
    scored.sort(key=lambda x: x["score"], reverse=True)
    return jsonify({"ok": True, "candidates": scored[:3], "keywords": keywords})


@push_bp.get("/api/push-categories/<int:cat_id>/match-prospects")
def api_push_categories_match_prospects(cat_id: int):
    """Trouve des prospects pertinents pour une catégorie push :
    - a un email, pas de téléphone, jamais pushé par email
    - scorés par matching tags + fonction avec les mots-clés de la catégorie
    - retourne 10 prospects aléatoires parmi les mieux scorés
    """
    import random as _random
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        cat_row = conn.execute(
            "SELECT * FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)
        ).fetchone()
        if not cat_row:
            return jsonify({"ok": False, "error": "Catégorie introuvable"}), 404

        keywords = _parse_json_str_list(cat_row["keywords"])
        if not keywords:
            keywords = [cat_row["name"].lower()]

        # Prospects avec email, sans téléphone, non supprimés, jamais pushés par email
        rows = conn.execute("""
            SELECT p.id, p.name, p.fonction, p.email, p.telephone, p.tags,
                   p.statut, p.pertinence, p.pushEmailSentAt,
                   c.groupe AS company_groupe, c.site AS company_site
            FROM prospects p
            LEFT JOIN companies c ON p.company_id = c.id
            WHERE p.owner_id = ?
              AND (p.deleted_at IS NULL OR p.deleted_at = '')
              AND (p.email IS NOT NULL AND p.email != '')
              AND (p.telephone IS NULL OR p.telephone = '')
              AND (p.pushEmailSentAt IS NULL OR p.pushEmailSentAt = '')
              AND p.id NOT IN (
                  SELECT DISTINCT prospect_id FROM push_logs
                  WHERE channel = 'email' OR channel IS NULL OR channel = ''
              )
        """, (uid,)).fetchall()

    # Scorer chaque prospect sur matching mots-clés ↔ tags + fonction
    scored = []
    unscored = []

    for row in rows:
        p = dict(row)
        tags = _parse_json_str_list(p.get("tags"))
        fonction = (p.get("fonction") or "").lower()
        tags_lower = [t.lower() for t in tags]
        haystack = " ".join(tags_lower) + " " + fonction

        score = 0
        matched = []
        for kw in keywords:
            kw_l = kw.lower()
            if kw_l in tags_lower:       # correspondance exacte tag → 3 pts
                score += 3
                matched.append(kw)
            elif kw_l in haystack:       # correspondance partielle fonction/tag → 1 pt
                score += 1
                matched.append(kw)

        company = p.get("company_groupe") or p.get("company_site") or ""
        entry = {
            "id": p["id"],
            "name": p.get("name", ""),
            "email": p.get("email", ""),
            "fonction": p.get("fonction") or "",
            "company": company,
            "tags": tags,
            "score": round(score, 1),
            "matched_keywords": matched,
        }
        if score > 0:
            scored.append(entry)
        else:
            unscored.append(entry)

    scored.sort(key=lambda x: x["score"], reverse=True)

    # Sélection aléatoire : 10 depuis le pool scoré, puis compléter avec non-scorés
    if len(scored) >= 10:
        result = _random.sample(scored, 10)
    else:
        result = scored[:]
        remaining = 10 - len(result)
        if unscored and remaining > 0:
            result += _random.sample(unscored, min(remaining, len(unscored)))

    _random.shuffle(result)

    return jsonify({
        "ok": True,
        "prospects": result,
        "total_scored": len(scored),
        "total_available": len(scored) + len(unscored),
        "keywords": keywords,
        "category_name": cat_row["name"],
    })


@push_bp.post("/api/push-categories/<int:cat_id>/set-candidates")
def api_push_categories_set_candidates(cat_id: int):
    """Enregistre les deux candidats par défaut d'une catégorie push. v27.3."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    c1 = payload.get("candidate1_id")
    c2 = payload.get("candidate2_id")
    # Accepter None ou int, rejeter autres types
    c1 = int(c1) if c1 else None
    c2 = int(c2) if c2 else None
    with _conn() as conn:
        existing = conn.execute(
            "SELECT id FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)
        ).fetchone()
        if not existing:
            return jsonify(ok=False, error="Catégorie introuvable"), 404
        conn.execute(
            "UPDATE push_categories SET candidate1_id=?, candidate2_id=?, updatedAt=? WHERE id=? AND owner_id=?;",
            (c1, c2, _now_iso(), cat_id, uid)
        )
    return jsonify(ok=True)


@push_bp.get("/api/push-categories/<int:cat_id>/files")
def api_push_category_files(cat_id: int):
    """List template files (.msg, .eml, .oft) in the push category folder (per-user)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    import pathlib
    with _conn() as conn:
        cat_row = conn.execute("SELECT * FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404

    cat_name = cat_row["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    user_push_dir.mkdir(parents=True, exist_ok=True)

    from urllib.parse import quote
    TEMPLATE_EXTS = ('.msg', '.eml', '.oft', '.htm', '.html')
    files = []

    if user_push_dir.is_dir():
        for f in sorted(user_push_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in TEMPLATE_EXTS:
                safe_url = f"/api/pushs/user/{uid}/{cat_id}/{quote(f.name, safe='')}"
                files.append({"name": f.name, "size": f.stat().st_size, "url": safe_url})

    # Fallback legacy : cherche dans pushs/<cat_name>/ si aucun fichier trouvé dans le dossier user
    if not files:
        pushs_root = Path(APP_DIR) / "pushs"
        legacy_dir = pushs_root / cat_name
        if not legacy_dir.is_dir() and pushs_root.is_dir():
            cat_norm = unicodedata.normalize("NFC", cat_name.lower().replace(" ", "_").replace("-", "_"))
            for sub in pushs_root.iterdir():
                if sub.is_dir():
                    sub_norm = unicodedata.normalize("NFC", sub.name.lower().replace(" ", "_").replace("-", "_"))
                    if sub_norm == cat_norm or cat_norm in sub_norm or sub_norm in cat_norm:
                        legacy_dir = sub
                        break
        if legacy_dir.is_dir():
            for f in sorted(legacy_dir.iterdir()):
                if f.is_file() and f.suffix.lower() in TEMPLATE_EXTS:
                    safe_url = f"/api/pushs/{quote(cat_name, safe='')}/{quote(f.name, safe='')}"
                    files.append({"name": f.name, "size": f.stat().st_size, "url": safe_url})

    return jsonify(ok=True, category=cat_name, files=files)


@push_bp.get("/api/pushs/<path:filepath>")
def api_serve_push_file(filepath: str):
    """Serve a push template file (.msg, .eml, etc.) for download/opening (per-user)."""
    uid = _uid()
    if not uid:
        return ("Non authentifié", 401)
    
    import pathlib
    # Nouveau format: user/<uid>/<cat_id>/filename ou ancien format: category/filename (backward compat)
    parts = filepath.split("/")
    
    if len(parts) >= 3 and parts[0] == "user":
        # Nouveau format: user/<uid>/<cat_id>/filename
        try:
            file_uid = int(parts[1])
            cat_id = int(parts[2])
            filename = "/".join(parts[3:])
        except (ValueError, IndexError):
            return ("Not found", 404)
        
        # Vérifier que l'utilisateur accède à ses propres fichiers
        if file_uid != uid:
            return ("Forbidden", 403)
        
        # Récupérer le nom de la catégorie
        with _conn() as conn:
            cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
        if not cat_row:
            return ("Not found", 404)
        
        cat_name = cat_row["name"]
        user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
        
        # Décoder le filename depuis l'URL (il peut être encodé)
        from urllib.parse import unquote
        decoded_filename = unquote(filename, encoding='utf-8', errors='replace')
        target = user_push_dir / decoded_filename
    else:
        # Ancien format (backward compat): category/filename
        if len(parts) != 2:
            return ("Not found", 404)
        cat_name, filename = parts
        
        # Fallback vers l'ancien système pushs/ pour compatibilité
        pushs_root = pathlib.Path(APP_DIR) / "pushs"
        pushs_dir = pushs_root / cat_name
        if not pushs_dir.is_dir() and pushs_root.is_dir():
            cat_norm = unicodedata.normalize("NFC", cat_name.lower().replace(" ", "_").replace("-", "_"))
            for sub in pushs_root.iterdir():
                if sub.is_dir():
                    sub_norm = unicodedata.normalize("NFC", sub.name.lower().replace(" ", "_").replace("-", "_"))
                    if sub_norm == cat_norm or cat_norm in sub_norm or sub_norm in cat_norm:
                        pushs_dir = sub
                        break
        target = pushs_dir / filename

    # Prevent directory traversal
    if ".." in str(target) or "\\" in filename or (len(parts) > 2 and "/" in filename):
        return ("Forbidden", 403)
    
    try:
        target_resolved = target.resolve()
        # Vérifier que le fichier est dans le bon répertoire
        if "user_" in str(target_resolved):
            user_dir = DATA_DIR / f"user_{uid}" / "push_templates"
            user_prefix = str(user_dir.resolve()).rstrip(os.sep) + os.sep
            if not str(target_resolved).startswith(user_prefix):
                return ("Forbidden", 403)
        else:
            # Ancien système
            pushs_root = pathlib.Path(APP_DIR) / "pushs"
            pushs_prefix = str(pushs_root.resolve()).rstrip(os.sep) + os.sep
            if not str(target_resolved).startswith(pushs_prefix):
                return ("Forbidden", 403)
    except Exception:
        return ("Forbidden", 403)
    
    if not target.is_file():
        return ("Not found", 404)

    mime_map = {
        '.msg': 'application/vnd.ms-outlook',
        '.eml': 'message/rfc822',
        '.oft': 'application/vnd.ms-outlook',
        '.htm': 'text/html',
        '.html': 'text/html',
    }
    mime = mime_map.get(target.suffix.lower(), 'application/octet-stream')
    
    # Encoder correctement le nom de fichier pour éviter les problèmes d'encodage Unicode
    # Flask gère automatiquement l'encodage RFC 2231, mais on s'assure que le nom est bien encodé
    from urllib.parse import quote
    safe_filename = filename.encode('utf-8', errors='replace').decode('utf-8')
    
    return send_file(
        str(target), 
        mimetype=mime, 
        as_attachment=False, 
        download_name=safe_filename
    )


@push_bp.post("/api/pushs/open")
def api_open_push_file():
    """Open a push template file (.msg) directly with the OS default handler (Outlook) - per-user."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    import pathlib, subprocess, platform
    payload = request.get_json(force=True, silent=True) or {}
    cat_id = payload.get("category_id")
    filename = payload.get("filename", "")

    if not cat_id or not filename:
        return jsonify(ok=False, error="category_id and filename required"), 400
    if ".." in filename:
        return jsonify(ok=False, error="Invalid filename"), 403

    with _conn() as conn:
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (int(cat_id), uid)).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404

    cat_name = cat_row["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    target = user_push_dir / filename
    
    # Vérifier le chemin pour éviter directory traversal
    try:
        target_resolved = target.resolve()
        user_dir = DATA_DIR / f"user_{uid}" / "push_templates"
        user_prefix = str(user_dir.resolve()).rstrip(os.sep) + os.sep
        if not str(target_resolved).startswith(user_prefix):
            return jsonify(ok=False, error="Chemin invalide"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin invalide"), 403
    
    if not target.is_file():
        return jsonify(ok=False, error=f"Fichier introuvable: {filename}"), 404

    # Open with OS default handler (Outlook for .msg)
    try:
        if platform.system() == "Windows":
            os.startfile(str(target))
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return jsonify(ok=True, opened=filename)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


# ═══════════════════════════════════════════════════════════════════
# v25.9: Upload de templates pour les catégories push (per-user)
# ═══════════════════════════════════════════════════════════════════
@push_bp.post("/api/push-categories/<int:cat_id>/upload-template")
def api_push_category_upload_template(cat_id: int):
    """Upload un template de mail pour une catégorie push (per-user)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    # Vérifier que la catégorie appartient à l'utilisateur
    with _conn() as conn:
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404
    
    if 'file' not in request.files:
        return jsonify(ok=False, error="Aucun fichier fourni"), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify(ok=False, error="Nom de fichier vide"), 400

    ok_upload, err_upload = _validate_upload(file, "mail_template")
    if not ok_upload:
        return jsonify(ok=False, error=err_upload[0]), err_upload[1]

    # Créer le dossier de la catégorie
    cat_name = cat_row["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    user_push_dir.mkdir(parents=True, exist_ok=True)
    
    # Sauvegarder le fichier
    filename = file.filename
    # Sécuriser le nom de fichier
    filename = "".join(c for c in filename if c.isalnum() or c in "._- ")
    target_path = user_push_dir / filename
    
    try:
        file.save(str(target_path))
        return jsonify(ok=True, filename=filename, url=f"/api/pushs/user/{uid}/{cat_id}/{filename}")
    except Exception as e:
        logger.error("Erreur upload template: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@push_bp.post("/api/push-categories/<int:cat_id>/delete-template")
def api_push_category_delete_template(cat_id: int):
    """Supprime un fichier template d'une catégorie push (per-user)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (cat_id, uid)).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404

    payload = request.get_json(force=True, silent=True) or {}
    filename = payload.get("filename", "")
    if not filename:
        return jsonify(ok=False, error="Nom de fichier manquant"), 400

    # Sécuriser le nom de fichier (pas de path traversal)
    safe_filename = "".join(c for c in filename if c.isalnum() or c in "._- ")
    if safe_filename != filename or ".." in filename or "/" in filename or "\\" in filename:
        return jsonify(ok=False, error="Nom de fichier invalide"), 400

    cat_name = cat_row["name"]
    target_path = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name / safe_filename
    try:
        if target_path.exists():
            target_path.unlink()
        return jsonify(ok=True)
    except Exception as e:
        logger.error("Erreur suppression template: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@push_bp.post("/api/push/generate")
def api_push_generate():
    """Génère un email personnalisé (.msg/.eml) avec PJ intégrées (DC candidats).

    Reçoit: {
        "prospect_id": int,
        "category_id": int,
        "template_filename": str,
        "candidate_id1": int (optionnel),
        "candidate_id2": int (optionnel),
        "ai_descriptions": bool (optionnel)
    }

    Retourne: fichier .msg (Outlook) ou .eml (fallback) avec PJ intégrées
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    payload = request.get_json(force=True, silent=True) or {}
    template_filename = payload.get("template_filename")
    
    # Validation des paramètres requis
    if not template_filename:
        return jsonify(ok=False, error="template_filename est requis"), 400
    
    try:
        prospect_id = _validate_positive_int(payload.get("prospect_id"), "prospect_id")
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    
    try:
        category_id = _validate_positive_int(payload.get("category_id"), "category_id")
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    
    candidate_id1 = _validate_optional_positive_int(payload.get("candidate_id1"), "candidate_id1")
    candidate_id2 = _validate_optional_positive_int(payload.get("candidate_id2"), "candidate_id2")
    call_note = (payload.get("call_note") or "").strip()

    # Récupérer les données du prospect
    with _conn() as conn:
        prospect = conn.execute(
            "SELECT name, email, fonction, company_id FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid)
        ).fetchone()
        if not prospect:
            return jsonify(ok=False, error="Prospect introuvable"), 404
        
        # Récupérer la catégorie (incl. flag no_candidates si colonne dispo)
        try:
            cat_row = conn.execute("SELECT name, no_candidates FROM push_categories WHERE id=? AND owner_id=?;", (category_id, uid)).fetchone()
            cat_no_candidates = bool(cat_row["no_candidates"]) if cat_row and "no_candidates" in cat_row.keys() else False
        except sqlite3.OperationalError:
            # Colonne no_candidates pas encore migrée (DB ancienne) — fallback sans le flag
            cat_row = conn.execute("SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (category_id, uid)).fetchone()
            cat_no_candidates = False
        if not cat_row:
            return jsonify(ok=False, error="Catégorie introuvable"), 404

        # Récupérer les candidats et leurs DC (skippé si la catégorie est en mode "sans consultant")
        candidates_data = []
        if not cat_no_candidates:
            for cand_id in [candidate_id1, candidate_id2]:
                if not cand_id:
                    continue
                try:
                    cand = conn.execute(
                        "SELECT id, name, dossier_competence_pdf, prenom, titre, annees_experience, domaine_principal, role, years_experience, sector, description_push FROM candidates WHERE id=? AND owner_id=?;",
                        (cand_id, uid)
                    ).fetchone()
                    if cand:
                        cand_dict = _safe_row_to_dict(cand)
                        if cand_dict:
                            candidates_data.append(cand_dict)
                except Exception as e:
                    logger.warning("Erreur récupération candidat %s: %s", cand_id, e)
                    continue
    
    # Convertir sqlite3.Row en dict pour accès sécurisé
    prospect_dict = _row_to_dict(prospect)
    cat_dict = _row_to_dict(cat_row)
    if not prospect_dict or not cat_dict:
        return jsonify(ok=False, error="Erreur lors de la récupération des données"), 500
    
    # Chemin du template — cherche d'abord dans le dossier user, puis dans pushs/ (legacy)
    cat_name = cat_dict["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    template_path = user_push_dir / template_filename

    if not template_path.is_file():
        # Fallback legacy : pushs/<cat_name>/<filename>
        pushs_root = Path(APP_DIR) / "pushs"
        legacy_path = pushs_root / cat_name / template_filename
        if not legacy_path.is_file() and pushs_root.is_dir():
            cat_norm = unicodedata.normalize("NFC", cat_name.lower().replace(" ", "_").replace("-", "_"))
            for sub in pushs_root.iterdir():
                if sub.is_dir():
                    sub_norm = unicodedata.normalize("NFC", sub.name.lower().replace(" ", "_").replace("-", "_"))
                    if sub_norm == cat_norm or cat_norm in sub_norm or sub_norm in cat_norm:
                        legacy_path = sub / template_filename
                        break
        if legacy_path.is_file():
            template_path = legacy_path
        else:
            return jsonify(ok=False, error="Template introuvable"), 404
    
    # v27.4: Descriptions IA des candidats (Ollama analyse le DC PDF)
    ai_descriptions = payload.get("ai_descriptions", False)
    if ai_descriptions and candidates_data:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        def _enrich_cand(cand):
            # Utiliser le cache description_push si disponible
            desc = (cand.get("description_push") or "").strip()
            if not desc:
                desc = _generate_candidate_description_ai(cand, uid)
            if desc:
                cand["description_ai"] = desc
        # Paralléliser pour 2 candidats (~15s au lieu de ~30s)
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(_enrich_cand, c) for c in candidates_data]
            for f in as_completed(futures):
                try:
                    f.result()
                except Exception as e:
                    logger.warning("Erreur enrichissement IA candidat: %s", e)

    try:
        # Résoudre les chemins des dossiers de compétences (PJ)
        attachment_paths = []
        for cand in candidates_data:
            dc_path = _resolve_dc_path(cand, uid)
            if dc_path:
                attachment_paths.append(dc_path)
                logger.info("DC résolu pour %s: %s", cand.get('name', '?'), dc_path)
            else:
                logger.info("Pas de DC pour %s (dossier_competence_pdf=%s)",
                           cand.get('name', '?'), cand.get('dossier_competence_pdf', 'None'))

        missing_email = not prospect_dict.get("email", "").strip()

        # Méthode 1 : Outlook disponible → brouillon dans Outlook (sync Exchange/M365)
        # Fonctionne depuis n'importe quel appareil : le brouillon apparaît partout
        if OUTLOOK_AVAILABLE:
            try:
                result = _save_to_outlook_drafts(template_path, prospect_dict, candidates_data, attachment_paths, call_note=call_note)
                msg = f"Brouillon créé dans Outlook ({result['pj_count']} PJ) — vérifiez vos Brouillons"
                if missing_email:
                    msg += " — Email prospect manquant"
                if result.get("pj_errors"):
                    msg += f" — PJ en erreur: {', '.join(result['pj_errors'])}"
                return jsonify(ok=True, method="outlook_drafts", message=msg, **result)
            except Exception as e:
                logger.warning("Échec création brouillon Outlook (%s), fallback .eml", e)

        # Méthode 2 : Pas d'Outlook → .eml avec PJ intégrées (téléchargement)
        email_bytes = _generate_eml_file(template_path, prospect_dict, candidates_data, attachment_paths, call_note=call_note)
        email_filename = template_path.stem + "_personnalise.eml"

        import io
        response = send_file(
            io.BytesIO(email_bytes),
            mimetype='application/octet-stream',
            as_attachment=True,
            download_name=email_filename
        )
        if missing_email:
            response.headers['X-Warning'] = 'prospect-email-missing'
        response.headers['X-PJ-Count'] = str(len(attachment_paths))
        response.headers['X-Candidate-Count'] = str(len(candidates_data))
        return response
    except Exception as e:
        logger.exception("Erreur génération push")
        return jsonify(ok=False, error=str(e)), 500


# ═══════════════════════════════════════════════════════════════════
# v27.x PARTIE 2: Route upload template (alias simple)
# ═══════════════════════════════════════════════════════════════════
@push_bp.post("/api/push/templates/upload")
def api_push_templates_upload():
    """Upload un template .msg/eml pour une catégorie push.
    Attend multipart/form-data avec: 'template' (fichier) + 'category_id' (int).
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if 'template' not in request.files:
        return jsonify(ok=False, error="Champ 'template' manquant"), 400

    category_id = request.form.get("category_id")
    if not category_id:
        return jsonify(ok=False, error="category_id manquant"), 400

    try:
        cat_id_int = int(category_id)
    except ValueError:
        return jsonify(ok=False, error="category_id invalide"), 400

    with _conn() as conn:
        cat_row = conn.execute(
            "SELECT name FROM push_categories WHERE id=? AND owner_id=?;", (cat_id_int, uid)
        ).fetchone()
    if not cat_row:
        return jsonify(ok=False, error="Catégorie introuvable"), 404

    file = request.files['template']
    if not file.filename:
        return jsonify(ok=False, error="Nom de fichier vide"), 400

    # Sécuriser le nom de fichier
    filename = "".join(c for c in file.filename if c.isalnum() or c in "._- ")
    suffix = Path(filename).suffix.lower()
    if suffix not in ('.msg', '.eml', '.oft'):
        return jsonify(ok=False, error="Format non supporté (accepté: .msg, .eml, .oft)"), 400

    cat_name = cat_row["name"]
    user_push_dir = DATA_DIR / f"user_{uid}" / "push_templates" / cat_name
    user_push_dir.mkdir(parents=True, exist_ok=True)
    target_path = user_push_dir / filename

    try:
        file.save(str(target_path))
        logger.info("Template push uploadé: user=%s cat=%s file=%s", uid, cat_name, filename)
        return jsonify(ok=True, filename=filename)
    except Exception as e:
        logger.error("Erreur upload template push: %s", e)
        return jsonify(ok=False, error=str(e)), 500


# Description IA candidat + résolution DC PDF — voir utils/candidates.py


@push_bp.post("/api/candidates/<int:cand_id>/save-description")
def api_candidate_save_description(cand_id):
    """Sauvegarde manuellement la description push d'un candidat (édition manuelle dans l'onglet Push).
    Retourne: { ok }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    description = payload.get("description", "")
    if description is not None:
        description = str(description).strip() or None
    with _conn() as conn:
        rows_affected = conn.execute(
            "UPDATE candidates SET description_push=? WHERE id=? AND owner_id=?;",
            (description, cand_id, uid)
        ).rowcount
        conn.commit()
    if rows_affected == 0:
        return jsonify(ok=False, error="Candidat introuvable"), 404
    return jsonify(ok=True)


@push_bp.post("/api/candidates/<int:cand_id>/generate-description")
def api_candidate_generate_description(cand_id):
    """Génère ou régénère la description push IA d'un candidat.
    Retourne: { ok, description }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        cand = conn.execute(
            "SELECT id, name, dossier_competence_pdf, prenom, titre, annees_experience, domaine_principal, role, years_experience, sector FROM candidates WHERE id=? AND owner_id=?;",
            (cand_id, uid)
        ).fetchone()
    if not cand:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    cand_dict = _safe_row_to_dict(cand) or {}
    if not cand_dict:
        return jsonify(ok=False, error="Erreur données candidat"), 500

    desc = _generate_candidate_description_ai(cand_dict, uid)
    if not desc:
        return jsonify(ok=False, error="Impossible de générer la description (pas de DC PDF ou IA indisponible)"), 422

    return jsonify(ok=True, description=desc)
