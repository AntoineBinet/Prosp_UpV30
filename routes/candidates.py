"""ProspUp — Blueprint Candidates (CRUD + sous-ressources : experiences,
educations, certifications, skills, availability, dossier de compétence,
DC upload/extract/rename/delete)."""
from __future__ import annotations

import datetime
import json
import os
import re
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from werkzeug.utils import secure_filename

from app import _audit_log, _dump_json_list, _maybe_log_candidate_events, _parse_json_int_list, _parse_json_str_list, log_activity, logger
from config import APP_DIR, DATA_DIR, APP_VERSION
from utils.ai_helpers import _call_ai, _call_ollama_direct, _load_ai_config
from utils.auth import _candidate_owned, _require_same_origin, _uid, login_required, role_required, validate_payload
from utils.common import _now_iso, _today_iso
from utils.db import _conn
from utils.files import _validate_upload

candidates_bp = Blueprint("candidates", __name__)


@candidates_bp.get("/api/candidates")
def api_candidates_list():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    # v23.5: optional pagination via ?page=&limit=
    page_param = request.args.get("page")
    if page_param is not None:
        try:
            page = max(1, int(page_param))
            limit = min(500, max(1, int(request.args.get("limit") or 100)))
        except (TypeError, ValueError):
            page, limit = 1, 100
        offset = (page - 1) * limit
        with _conn() as conn:
            total = int(conn.execute("SELECT COUNT(*) FROM candidates WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchone()[0])
            rows = conn.execute(
                "SELECT * FROM candidates WHERE owner_id=? AND deleted_at IS NULL ORDER BY COALESCE(updatedAt, createdAt) DESC, id DESC LIMIT ? OFFSET ?;",
                (uid, limit, offset),
            ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["skills"] = _parse_json_str_list(d.get("skills"))
            d["company_ids"] = _parse_json_int_list(d.get("company_ids"))
            # v27.26: flag has_dc
            if not d.get("dossier_competence_pdf"):
                dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(d["id"])
                d["has_dc"] = dc_dir.is_dir() and any(dc_dir.glob("*.pdf"))
            else:
                d["has_dc"] = True
            out.append(d)
        from math import ceil
        return jsonify(ok=True, candidates=out, pagination={"page": page, "limit": limit, "total": total, "pages": ceil(total / limit) if limit else 1})
    # Non-paginated (backward compatible)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM candidates WHERE owner_id=? AND deleted_at IS NULL ORDER BY COALESCE(updatedAt, createdAt) DESC, id DESC;",
            (uid,),
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        d["skills"] = _parse_json_str_list(d.get("skills"))
        d["company_ids"] = _parse_json_int_list(d.get("company_ids"))
        # v27.26: flag has_dc pour savoir si un DC existe (DB ou dossier)
        if not d.get("dossier_competence_pdf"):
            dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(d["id"])
            d["has_dc"] = dc_dir.is_dir() and any(dc_dir.glob("*.pdf"))
        else:
            d["has_dc"] = True
        out.append(d)
    return jsonify(out)


@candidates_bp.get("/api/candidates/<int:candidate_id>")
def api_candidate_get(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute("SELECT * FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "not_found"}), 404
        cand = dict(row)

        cand["skills"] = _parse_json_str_list(cand.get("skills"))
        cand["company_ids"] = _parse_json_int_list(cand.get("company_ids"))

        companies: List[Dict[str, Any]] = []
        if cand["company_ids"]:
            placeholders = ",".join(["?"] * len(cand["company_ids"]))
            rows2 = conn.execute(
                f"SELECT * FROM companies WHERE owner_id=? AND id IN ({placeholders}) ORDER BY groupe, site;",
                (uid, *cand["company_ids"]),
            ).fetchall()
            companies = [dict(r) for r in rows2]

    return jsonify({"ok": True, "candidate": cand, "companies": companies})


@candidates_bp.put("/api/candidates/<int:candidate_id>")
def api_candidate_put(candidate_id: int):
    """Partial-update a candidate (inline edit from v30 fiche candidat)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _candidate_owned(candidate_id):
        return jsonify(ok=False, error="Accès refusé"), 403
    body = request.get_json(force=True, silent=True) or {}
    if not body:
        return jsonify(ok=False, error="Body vide"), 400

    ALLOWED = {
        "name", "role", "location", "seniority", "tech", "linkedin", "source", "status", "notes",
        "phone", "email", "sector", "prenom", "titre", "years_experience", "annees_experience",
        "domaine_principal", "description_push", "disponibilite", "mobilite", "permis_travail",
        "fonctions_recherchees", "motif_recherche", "avancement_recherches",
        "remuneration_actuelle", "pretentions_salariales", "propal_a", "langues",
        "eval_technique", "eval_personnalite", "eval_communication",
        "references_candidat", "avis_perso",
        "entretien_date", "entretien_lieu", "entretien_notes",
        "vsa_url", "onenote_url",
    }
    updates = {k: v for k, v in body.items() if k in ALLOWED}
    if not updates:
        return jsonify(ok=True)

    now = datetime.datetime.now().isoformat(timespec="seconds")
    set_clause = ", ".join(k + "=?" for k in updates) + ", updatedAt=?"
    params = list(updates.values()) + [now, candidate_id, uid]

    with _conn() as conn:
        cur = conn.execute(
            "UPDATE candidates SET " + set_clause + " WHERE id=? AND owner_id=?;",
            params,
        )
        if cur.rowcount == 0:
            return jsonify(ok=False, error="Candidat introuvable"), 404
        conn.commit()

    return jsonify(ok=True)


@candidates_bp.get("/api/candidates/<int:candidate_id>/experiences")
def api_candidate_experiences_get(candidate_id: int):
    """Get all experiences for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        rows = conn.execute(
            "SELECT * FROM candidate_experiences WHERE candidate_id=? AND owner_id=? ORDER BY start_date DESC, id DESC;",
            (candidate_id, uid)
        ).fetchall()
        experiences = []
        for row in rows:
            exp = dict(row)
            # Parse technologies JSON if present
            if exp.get("technologies"):
                try:
                    exp["technologies"] = json.loads(exp["technologies"])
                except:
                    exp["technologies"] = []
            else:
                exp["technologies"] = []
            experiences.append(exp)
    return jsonify({"ok": True, "experiences": experiences})


@candidates_bp.post("/api/candidates/<int:candidate_id>/experiences")
def api_candidate_experiences_post(candidate_id: int):
    """Create a new experience for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    company_name = (payload.get("company_name") or "").strip()
    if not company_name:
        return jsonify({"ok": False, "error": "company_name is required"}), 400
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        now = datetime.datetime.now().isoformat()
        technologies = payload.get("technologies")
        if isinstance(technologies, (list, dict)):
            technologies = json.dumps(technologies, ensure_ascii=False)
        elif not isinstance(technologies, str):
            technologies = ""
        cur = conn.execute(
            """INSERT INTO candidate_experiences
               (candidate_id, company_name, role, start_date, end_date, description, technologies, owner_id, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);""",
            (
                candidate_id,
                company_name,
                (payload.get("role") or "").strip() or None,
                (payload.get("start_date") or "").strip() or None,
                (payload.get("end_date") or "").strip() or None,
                (payload.get("description") or "").strip() or None,
                technologies,
                uid,
                now,
                now,
            ),
        )
        exp_id = cur.lastrowid
    return jsonify({"ok": True, "id": exp_id})


@candidates_bp.get("/api/candidates/<int:candidate_id>/educations")
def api_candidate_educations_get(candidate_id: int):
    """Get all educations for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        rows = conn.execute(
            "SELECT * FROM candidate_educations WHERE candidate_id=? AND owner_id=? ORDER BY year DESC, id DESC;",
            (candidate_id, uid)
        ).fetchall()
        educations = [dict(row) for row in rows]
    return jsonify({"ok": True, "educations": educations})


@candidates_bp.post("/api/candidates/<int:candidate_id>/educations")
def api_candidate_educations_post(candidate_id: int):
    """Create a new education for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    school = (payload.get("school") or "").strip()
    if not school:
        return jsonify({"ok": False, "error": "school is required"}), 400
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        now = datetime.datetime.now().isoformat()
        cur = conn.execute(
            """INSERT INTO candidate_educations
               (candidate_id, degree, school, year, specialization, owner_id, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?);""",
            (
                candidate_id,
                (payload.get("degree") or "").strip() or None,
                school,
                (payload.get("year") or "").strip() or None,
                (payload.get("specialization") or "").strip() or None,
                uid,
                now,
                now,
            ),
        )
        edu_id = cur.lastrowid
    return jsonify({"ok": True, "id": edu_id})


@candidates_bp.get("/api/candidates/<int:candidate_id>/certifications")
def api_candidate_certifications_get(candidate_id: int):
    """Get all certifications for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        rows = conn.execute(
            "SELECT * FROM candidate_certifications WHERE candidate_id=? AND owner_id=? ORDER BY obtained_date DESC, id DESC;",
            (candidate_id, uid)
        ).fetchall()
        certifications = [dict(row) for row in rows]
    return jsonify({"ok": True, "certifications": certifications})


@candidates_bp.post("/api/candidates/<int:candidate_id>/certifications")
def api_candidate_certifications_post(candidate_id: int):
    """Create a new certification for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400
    with _conn() as conn:
        # Verify candidate exists and belongs to user
        cand = conn.execute("SELECT id FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not cand:
            return jsonify({"ok": False, "error": "not_found"}), 404
        now = datetime.datetime.now().isoformat()
        cur = conn.execute(
            """INSERT INTO candidate_certifications
               (candidate_id, name, issuer, obtained_date, expiry_date, owner_id, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?);""",
            (
                candidate_id,
                name,
                (payload.get("issuer") or "").strip() or None,
                (payload.get("obtained_date") or "").strip() or None,
                (payload.get("expiry_date") or "").strip() or None,
                uid,
                now,
                now,
            ),
        )
        cert_id = cur.lastrowid
    return jsonify({"ok": True, "id": cert_id})


# ════════════════════════════════════════════════════════════
# v30 — Candidate skills + availability (granularité fine)
# ════════════════════════════════════════════════════════════

def _cand_owned_row(conn, candidate_id: int, uid: int):
    return conn.execute(
        "SELECT id, tech FROM candidates WHERE id=? AND owner_id=?;",
        (candidate_id, uid),
    ).fetchone()


@candidates_bp.get("/api/candidates/<int:candidate_id>/skills")
def api_cand_skills_get(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        rows = conn.execute(
            "SELECT id, name, category, level FROM candidate_skills "
            "WHERE candidate_id=? ORDER BY category, name;",
            (candidate_id,),
        ).fetchall()
        skills = [dict(r) for r in rows]
        # Backfill depuis candidates.tech si aucune skill enregistrée
        cand_tech = cand["tech"] if "tech" in cand.keys() else None
        if not skills and cand_tech:
            tech_list = [t.strip() for t in str(cand_tech).split(",") if t.strip()]
            for name in tech_list[:40]:
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO candidate_skills (candidate_id, name, category, level) "
                        "VALUES (?,?,?,?);",
                        (candidate_id, name, "Compétences", 3),
                    )
                except Exception:
                    pass
            skills = [dict(r) for r in conn.execute(
                "SELECT id, name, category, level FROM candidate_skills "
                "WHERE candidate_id=? ORDER BY category, name;", (candidate_id,)
            ).fetchall()]
    return jsonify(ok=True, skills=skills)


@candidates_bp.post("/api/candidates/<int:candidate_id>/skills")
def api_cand_skills_post(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify(ok=False, error="name is required"), 400
    category = (payload.get("category") or "").strip() or None
    level = max(1, min(5, int(payload.get("level") or 3)))
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        try:
            conn.execute(
                "INSERT INTO candidate_skills (candidate_id, name, category, level) "
                "VALUES (?,?,?,?) "
                "ON CONFLICT(candidate_id, name) DO UPDATE SET "
                "  category=excluded.category, level=excluded.level;",
                (candidate_id, name, category, level),
            )
        except Exception as e:
            return jsonify(ok=False, error=str(e)), 400
        row = conn.execute(
            "SELECT id, name, category, level FROM candidate_skills "
            "WHERE candidate_id=? AND name=?;",
            (candidate_id, name),
        ).fetchone()
    return jsonify(ok=True, skill=dict(row) if row else None)


@candidates_bp.delete("/api/candidates/<int:candidate_id>/skills/<int:skill_id>")
def api_cand_skills_delete(candidate_id: int, skill_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        conn.execute(
            "DELETE FROM candidate_skills WHERE id=? AND candidate_id=?;",
            (skill_id, candidate_id),
        )
    return jsonify(ok=True)


@candidates_bp.get("/api/candidates/<int:candidate_id>/availability")
def api_cand_avail_get(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        rows = conn.execute(
            "SELECT week_iso, status FROM candidate_availability "
            "WHERE candidate_id=? ORDER BY week_iso;",
            (candidate_id,),
        ).fetchall()
    return jsonify(ok=True, availability=[dict(r) for r in rows])


@candidates_bp.post("/api/candidates/<int:candidate_id>/availability")
def api_cand_avail_post(candidate_id: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    err = _require_same_origin()
    if err:
        return err
    payload = request.get_json(force=True, silent=True) or {}
    week_iso = (payload.get("week_iso") or "").strip()
    status = (payload.get("status") or "").strip().lower()
    if not week_iso or status not in ("libre", "busy", "placed"):
        return jsonify(ok=False, error="week_iso + status (libre|busy|placed) requis"), 400
    with _conn() as conn:
        cand = _cand_owned_row(conn, candidate_id, uid)
        if not cand:
            return jsonify(ok=False, error="not_found"), 404
        conn.execute(
            "INSERT INTO candidate_availability (candidate_id, week_iso, status) "
            "VALUES (?,?,?) "
            "ON CONFLICT(candidate_id, week_iso) DO UPDATE SET status=excluded.status;",
            (candidate_id, week_iso, status),
        )
    return jsonify(ok=True)


@candidates_bp.get("/api/candidates/<int:candidate_id>/dossier-competence")
def api_candidate_dossier_competence(candidate_id: int):
    """Serve the competence dossier PDF for a candidate."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    with _conn() as conn:
        row = conn.execute("SELECT dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=?;", (candidate_id, uid)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "not_found"}), 404
        
        pdf_path = row["dossier_competence_pdf"]
        if not pdf_path or not pdf_path.strip():
            return jsonify({"ok": False, "error": "Aucun dossier de compétence renseigné"}), 404
        
        # Chemin du PDF (peut être relatif ou absolu)
        pdf_file = Path(pdf_path)
        if not pdf_file.is_absolute():
            # Si relatif, chercher dans le dossier dossiers_competence à la racine
            pdf_file = APP_DIR / "dossiers_competence" / pdf_file
        
        if not pdf_file.exists() or not pdf_file.is_file():
            return jsonify({"ok": False, "error": "Fichier PDF introuvable"}), 404
        
        # Vérifier que c'est bien un PDF
        if pdf_file.suffix.lower() != ".pdf":
            return jsonify({"ok": False, "error": "Le fichier n'est pas un PDF"}), 400
        
        try:
            return send_file(str(pdf_file), mimetype="application/pdf", as_attachment=True, download_name=pdf_file.name)
        except Exception as e:
            logger.error(f"Error serving PDF: {e}")
            return jsonify({"ok": False, "error": f"Erreur lors du chargement du PDF: {str(e)}"}), 500


@candidates_bp.post("/api/candidates/save")
def api_candidates_save():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload, err = validate_payload({'name': str})
    if err:
        return err
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400

    # Normalize fields
    def _t(k): 
        v = payload.get(k)
        return (str(v).strip() if v is not None else None) or None

    cid = payload.get("id")
    _candidate_action = 'update' if cid else 'create'
    template_id = payload.get("template_id")
    template_name = (payload.get("template_name") or "").strip() or None
    try:
        template_id = int(template_id) if template_id not in (None, "", "null") else None
    except Exception:
        template_id = None

    now = datetime.datetime.now().isoformat(timespec="seconds")
    event_date = now[:10]

    skills_json = _dump_json_list(payload.get("skills"), as_int=False)
    company_ids_json = _dump_json_list(payload.get("company_ids"), as_int=True)

    is_archived = 0
    try:
        is_archived = int(payload.get("is_archived") or 0)
    except Exception:
        is_archived = 0

    years_experience = None
    try:
        ye = payload.get("years_experience")
        years_experience = int(ye) if ye not in (None, "", "null") else None
    except Exception:
        years_experience = None

    with _conn() as conn:
        cur = conn.cursor()
        old_status = None
        existing_dc_path = None
        if cid:
            try:
                r0 = conn.execute("SELECT status, dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
                old_status = r0["status"] if r0 else None
                existing_dc_path = r0["dossier_competence_pdf"] if r0 else None
            except Exception:
                old_status = None
        # v27.x: champs prenom, titre, annees_experience, domaine_principal
        annees_exp_v = None
        try:
            ae = payload.get("annees_experience")
            annees_exp_v = int(ae) if ae not in (None, "", "null") else None
        except Exception:
            annees_exp_v = None

        # v28.1: champs fiche entretien
        permis_conduire_v = None
        try:
            pc = payload.get("permis_conduire")
            permis_conduire_v = int(pc) if pc not in (None, "", "null") else None
        except Exception:
            permis_conduire_v = None
        vehicule_v = None
        try:
            vh = payload.get("vehicule")
            vehicule_v = int(vh) if vh not in (None, "", "null") else None
        except Exception:
            vehicule_v = None

        if cid:
            cur.execute(
                '''
                UPDATE candidates
                SET name=?, role=?, location=?, seniority=?, tech=?, linkedin=?, source=?, status=?, notes=?,
                    onenote_url=?, vsa_url=?, skills=?, company_ids=?, is_archived=?,
                    years_experience=?, sector=?, phone=?, email=?, dossier_competence_pdf=?,
                    prenom=?, titre=?, annees_experience=?, domaine_principal=?,
                    description_push=?,
                    disponibilite=?, mobilite=?, permis_conduire=?, vehicule=?, permis_travail=?,
                    fonctions_recherchees=?, motif_recherche=?, avancement_recherches=?,
                    remuneration_actuelle=?, pretentions_salariales=?, propal_a=?,
                    eval_technique=?, eval_personnalite=?, eval_communication=?,
                    langues=?, references_candidat=?, avis_perso=?,
                    entretien_date=?, entretien_lieu=?, entretien_notes=?,
                    updatedAt=?
                WHERE id=? AND owner_id=?;
                ''',
                (
                    name,
                    _t("role"),
                    _t("location"),
                    _t("seniority"),
                    _t("tech"),
                    _t("linkedin"),
                    _t("source"),
                    _t("status"),
                    _t("notes"),
                    _t("onenote_url"),
                    _t("vsa_url"),
                    skills_json,
                    company_ids_json,
                    is_archived,
                    years_experience,
                    _t("sector"),
                    _t("phone"),
                    _t("email"),
                    _t("dossier_competence_pdf") or existing_dc_path,
                    _t("prenom"),
                    _t("titre"),
                    annees_exp_v,
                    _t("domaine_principal"),
                    _t("description_push"),
                    _t("disponibilite"),
                    _t("mobilite"),
                    permis_conduire_v,
                    vehicule_v,
                    _t("permis_travail"),
                    _t("fonctions_recherchees"),
                    _t("motif_recherche"),
                    _t("avancement_recherches"),
                    _t("remuneration_actuelle"),
                    _t("pretentions_salariales"),
                    _t("propal_a"),
                    _t("eval_technique"),
                    _t("eval_personnalite"),
                    _t("eval_communication"),
                    _t("langues"),
                    _t("references_candidat"),
                    _t("avis_perso"),
                    _t("entretien_date"),
                    _t("entretien_lieu"),
                    _t("entretien_notes"),
                    now,
                    int(cid),
                    uid,
                ),
            )
            if cur.rowcount == 0:
                cid = None  # fallback to insert
        if not cid:
            cur.execute(
                '''
                INSERT INTO candidates (
                    name, role, location, seniority, tech, linkedin, source, status, notes,
                    onenote_url, vsa_url, skills, company_ids, is_archived,
                    years_experience, sector, phone, email, dossier_competence_pdf,
                    prenom, titre, annees_experience, domaine_principal,
                    description_push,
                    disponibilite, mobilite, permis_conduire, vehicule, permis_travail,
                    fonctions_recherchees, motif_recherche, avancement_recherches,
                    remuneration_actuelle, pretentions_salariales, propal_a,
                    eval_technique, eval_personnalite, eval_communication,
                    langues, references_candidat, avis_perso,
                    entretien_date, entretien_lieu, entretien_notes,
                    createdAt, updatedAt, owner_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                ''',
                (
                    name,
                    _t("role"),
                    _t("location"),
                    _t("seniority"),
                    _t("tech"),
                    _t("linkedin"),
                    _t("source"),
                    _t("status"),
                    _t("notes"),
                    _t("onenote_url"),
                    _t("vsa_url"),
                    skills_json,
                    company_ids_json,
                    is_archived,
                    years_experience,
                    _t("sector"),
                    _t("phone"),
                    _t("email"),
                    _t("dossier_competence_pdf"),
                    _t("prenom"),
                    _t("titre"),
                    annees_exp_v,
                    _t("domaine_principal"),
                    _t("description_push"),
                    _t("disponibilite"),
                    _t("mobilite"),
                    permis_conduire_v,
                    vehicule_v,
                    _t("permis_travail"),
                    _t("fonctions_recherchees"),
                    _t("motif_recherche"),
                    _t("avancement_recherches"),
                    _t("remuneration_actuelle"),
                    _t("pretentions_salariales"),
                    _t("propal_a"),
                    _t("eval_technique"),
                    _t("eval_personnalite"),
                    _t("eval_communication"),
                    _t("langues"),
                    _t("references_candidat"),
                    _t("avis_perso"),
                    _t("entretien_date"),
                    _t("entretien_lieu"),
                    _t("entretien_notes"),
                    now,
                    now,
                    uid,
                ),
            )
            cid = cur.lastrowid

        # Candidate KPI events (contacted / solid) based on status transition
        try:
            _maybe_log_candidate_events(conn, int(cid), old_status, _t("status"), event_date)
        except Exception:
            pass

    log_activity(_candidate_action, 'candidat', cid, name)
    return jsonify({"ok": True, "id": cid})


@candidates_bp.get("/api/candidates/fiche-entretien-template")
def api_candidates_fiche_entretien_template():
    """Télécharge le modèle de fiche entretien Excel."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    template_path = APP_DIR / "docs" / "Fiche entretien NEW Prenom NOM - EC1 XXX  JJMMAAAA.xlsx"
    if not template_path.exists():
        return jsonify(ok=False, error="Modèle non trouvé"), 404
    return send_file(str(template_path), as_attachment=True, download_name="fiche_entretien_Up.xlsx")


@candidates_bp.post("/api/candidates/parse-fiche-entretien")
def api_candidates_parse_fiche_entretien():
    """Parse une fiche entretien Excel (format Up Technologies) via Ollama.
    Retourne un JSON avec les champs extraits pour pré-remplir la fiche candidat.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify(ok=False, error="Fichier manquant"), 400
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify(ok=False, error="Format non supporté (xlsx/xls requis)"), 400

    try:
        import openpyxl
        wb = openpyxl.load_workbook(BytesIO(file.read()), data_only=True)
        lines = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            for row in ws.iter_rows(values_only=True):
                non_none = [str(v).strip() for v in row if v is not None and str(v).strip()]
                if non_none:
                    lines.append(" | ".join(non_none))
        excel_text = "\n".join(lines[:150])  # limiter à 150 lignes
    except Exception as e:
        return jsonify(ok=False, error=f"Erreur lecture Excel : {e}"), 400

    prompt = f"""Tu es un assistant RH expert. Voici le contenu brut d'une fiche d'entretien candidat extraite d'un fichier Excel :

---
{excel_text}
---

Extrait les informations suivantes et retourne UNIQUEMENT un objet JSON valide, sans texte avant ni après, sans balises markdown :
{{
  "disponibilite": "date ou délai de disponibilité du candidat (ex: Immédiate, 1 mois de préavis, 3 mois)",
  "mobilite": "zones géographiques acceptées (ex: Lyon, Paris, Grenoble, Nationale, Internationale)",
  "permis_conduire": 1 ou 0,
  "vehicule": 1 ou 0,
  "permis_travail": "type de permis de travail si mentionné (ex: Salarié, CDI, indépendant)",
  "fonctions_recherchees": "postes et secteurs recherchés",
  "motif_recherche": "motif de départ / motivations",
  "avancement_recherches": "avancement des autres pistes (ex: ED, EP, Std By, actif discret)",
  "remuneration_actuelle": "rémunération actuelle (fixe + variable + avantages)",
  "pretentions_salariales": "prétentions salariales souhaitées",
  "propal_a": "salaire proposé par l'entreprise si mentionné",
  "eval_technique": "évaluation technique (note ou commentaire)",
  "eval_personnalite": "évaluation personnalité",
  "eval_communication": "évaluation communication",
  "langues": "langues et niveaux (ex: Anglais B2 testé, Espagnol A1)",
  "references_candidat": "références transmises (nom, fonction, société, contact)",
  "avis_perso": "avis personnel du consultant sur le candidat — texte libre de la case Détails / commentaires de la section Évaluation"
}}

Si une information est absente, mets null pour les champs numériques et \"\" pour les champs texte."""

    try:
        config = _load_ai_config()
        timeout = int(config.get("ollama_timeout", 120))
        raw = _call_ollama_direct(prompt, config, timeout)
        # Extraire le JSON de la réponse
        json_match = re.search(r'\{[\s\S]*\}', raw)
        if not json_match:
            return jsonify(ok=False, error="L'IA n'a pas retourné de JSON valide", raw=raw[:500]), 422
        parsed = json.loads(json_match.group(0))
        return jsonify(ok=True, fields=parsed)
    except json.JSONDecodeError as e:
        return jsonify(ok=False, error=f"JSON invalide retourné par l'IA : {e}", raw=raw[:500] if 'raw' in dir() else ""), 422
    except Exception as e:
        return jsonify(ok=False, error=f"Erreur IA : {e}"), 500


@candidates_bp.post("/api/candidates/delete")
def api_candidates_delete():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=False) or {}
    cid = payload.get("id")
    if not cid:
        return jsonify({"ok": False, "error": "id is required"}), 400
    _cand_name = None
    with _conn() as conn:
        _cand_row = conn.execute("SELECT name FROM candidates WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        _cand_name = _cand_row["name"] if _cand_row else None
        # v23.5: soft delete instead of hard delete
        conn.execute("UPDATE candidates SET deleted_at=? WHERE id=? AND owner_id=?;", (_now_iso(), int(cid), uid))
    _audit_log("soft_delete", "candidate", int(cid))
    log_activity('delete', 'candidat', int(cid), _cand_name)
    return jsonify({"ok": True})


# ═══════════════════════════════════════════════════════════════════
# v27.4: Helper extraction texte PDF — voir utils/files.py (doublon supprimé en phase A3)
# ═══════════════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════════════
# v27.x PARTIE 3: Extraction DC PDF + upload DC
# ═══════════════════════════════════════════════════════════════════

@candidates_bp.post("/api/candidates/extract-dc")
def api_candidates_extract_dc():
    """Extrait les champs d'un DC PDF via Ollama (local, données confidentielles).
    Retourne: { ok, fields: { name, prenom, titre, annees_experience, domaine_principal, tags, role } }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if 'dc' not in request.files:
        return jsonify(ok=False, error="Champ 'dc' manquant"), 400

    pdf_file = request.files['dc']
    if not pdf_file.filename:
        return jsonify(ok=False, error="Nom de fichier vide"), 400

    # Lire le PDF et extraire le texte
    pdf_text = ""
    try:
        import io
        pdf_bytes = pdf_file.read()

        # Tenter avec pdfminer (souvent disponible)
        try:
            from pdfminer.high_level import extract_text as _extract_pdf  # type: ignore
            pdf_text = _extract_pdf(io.BytesIO(pdf_bytes), maxpages=5) or ""
        except ImportError:
            pass

        # Fallback: pypdf
        if not pdf_text:
            try:
                import pypdf  # type: ignore
                reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
                for page in reader.pages[:5]:
                    pdf_text += page.extract_text() or ""
            except ImportError:
                pass

        if not pdf_text.strip():
            return jsonify(ok=False, error="Impossible d'extraire le texte du PDF (bibliothèque PDF manquante)"), 422
    except Exception as e:
        return jsonify(ok=False, error=f"Erreur lecture PDF: {e}"), 500

    # Limiter le texte pour Ollama
    pdf_text_short = pdf_text[:4000]

    prompt = f"""Tu es un assistant qui extrait des informations d'un dossier de compétences (CV) d'un ingénieur.
Dossier de compétences (extrait) :
{pdf_text_short}

Extrait les informations suivantes au format JSON strict (sans commentaire, sans markdown) :
{{
  "name": "Prénom NOM",
  "prenom": "Prénom",
  "titre": "Titre ou poste principal",
  "annees_experience": <nombre entier d'années d'expérience ou null>,
  "domaine_principal": "domaine principal (ex: Systèmes embarqués, Automotive, Défense...)",
  "tags": ["tag1", "tag2", ...],
  "role": "rôle court pour la liste (ex: Embedded Software Engineer)"
}}
Réponds uniquement avec le JSON, sans aucun texte autour."""

    try:
        result_text = _call_ai(prompt, timeout=60)
        # Parser le JSON
        # Nettoyer les éventuels marqueurs markdown
        clean = result_text.strip()
        if clean.startswith("```"):
            clean = re.sub(r'^```[^\n]*\n?', '', clean)
            clean = re.sub(r'\n?```$', '', clean)
        fields = json.loads(clean)
        return jsonify(ok=True, fields=fields)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("DC extraction JSON parse error: %s — response: %s", e, result_text[:200] if 'result_text' in dir() else '')
        return jsonify(ok=False, error="L'IA n'a pas retourné un JSON valide"), 422
    except Exception as e:
        logger.warning("DC extraction error: %s", e)
        return jsonify(ok=False, error=f"IA indisponible: {e}"), 503


@candidates_bp.post("/api/candidates/<int:cid>/dc-enrich")
def api_candidate_dc_enrich(cid):
    """Lit le DC existant sur disque et l'analyse via IA pour pré-remplir la fiche candidat.
    Retourne: { ok, fields: { name, prenom, role, location, years_experience, sector, tech, phone, email, linkedin, domaine_principal } }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT name FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid)
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid)
    pdf_files = sorted(dc_dir.glob("*.pdf")) if dc_dir.is_dir() else []
    if not pdf_files:
        return jsonify(ok=False, error="Aucun DC trouvé pour ce candidat. Chargez un PDF d'abord."), 404

    pdf_path = pdf_files[0]
    pdf_text = ""
    try:
        import io as _io
        with open(str(pdf_path), "rb") as f:
            pdf_bytes = f.read()
        try:
            from pdfminer.high_level import extract_text as _extract_pdf  # type: ignore
            pdf_text = _extract_pdf(_io.BytesIO(pdf_bytes), maxpages=10) or ""
        except ImportError:
            pass
        if not pdf_text:
            try:
                import pypdf  # type: ignore
                reader = pypdf.PdfReader(_io.BytesIO(pdf_bytes))
                for page in reader.pages[:10]:
                    pdf_text += page.extract_text() or ""
            except ImportError:
                pass
        if not pdf_text.strip():
            return jsonify(ok=False, error="Impossible d'extraire le texte du PDF (bibliothèque PDF manquante ou PDF scanné)."), 422
    except Exception as e:
        return jsonify(ok=False, error=f"Erreur lecture PDF : {e}"), 500

    pdf_text_short = pdf_text[:6000]
    prompt = f"""Tu es un assistant RH expert. Voici le contenu d'un dossier de compétences (DC) d'un candidat :

---
{pdf_text_short}
---

Extrais les informations suivantes et retourne UNIQUEMENT un objet JSON valide, sans texte avant ni après, sans balises markdown :
{{
  "name": "Prénom NOM du candidat",
  "prenom": "Prénom seul",
  "role": "Poste ou titre principal (ex: Consultant Automatisme, Ingénieur Systèmes Embarqués)",
  "location": "Ville ou région (ex: Lyon, Paris, Mobile France)",
  "years_experience": <nombre entier d'années d'expérience professionnelle, ou null>,
  "sector": "Secteur d'activité principal (ex: Industrie, Défense, Automotive, IT)",
  "tech": "Compétences techniques principales, séparées par des virgules (ex: Python, Java, AUTOSAR)",
  "phone": "Numéro de téléphone (null si absent)",
  "email": "Adresse email (null si absente)",
  "linkedin": "URL LinkedIn complète (null si absente)",
  "domaine_principal": "Domaine principal détaillé (ex: Systèmes embarqués, Automatisme industriel)"
}}

Si une information est absente, mets null."""

    try:
        result_text = _call_ai(prompt, timeout=90)
        clean = result_text.strip()
        if clean.startswith("```"):
            clean = re.sub(r'^```[^\n]*\n?', '', clean)
            clean = re.sub(r'\n?```$', '', clean)
        json_match = re.search(r'\{[\s\S]*\}', clean)
        if not json_match:
            return jsonify(ok=False, error="L'IA n'a pas retourné de JSON valide"), 422
        fields = json.loads(json_match.group(0))
        # Convertir years_experience en string pour l'affichage
        if fields.get("years_experience") is not None:
            fields["years_experience"] = str(fields["years_experience"])
        return jsonify(ok=True, fields=fields)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("DC enrich JSON parse error: %s", e)
        return jsonify(ok=False, error="L'IA n'a pas retourné un JSON valide"), 422
    except Exception as e:
        logger.warning("DC enrich error: %s", e)
        return jsonify(ok=False, error=f"IA indisponible : {e}"), 503


@candidates_bp.post("/api/candidates/upload-dc")
def api_candidates_upload_dc():
    """Sauvegarde le DC PDF d'un candidat dans data/dossiers_candidats/{uid}/{cid}/.
    Attend multipart/form-data: 'dc' (PDF) + 'candidate_id' (int).
    Sécurisé : un user ne peut uploader que pour ses propres candidats.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if 'dc' not in request.files:
        return jsonify(ok=False, error="Champ 'dc' manquant"), 400

    candidate_id = request.form.get("candidate_id")
    if not candidate_id:
        return jsonify(ok=False, error="candidate_id manquant"), 400

    try:
        cid_int = int(candidate_id)
    except ValueError:
        return jsonify(ok=False, error="candidate_id invalide"), 400

    # Vérifier que le candidat appartient à l'utilisateur
    with _conn() as conn:
        cand_row = conn.execute(
            "SELECT id, name FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid_int, uid)
        ).fetchone()
    if not cand_row:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    pdf_file = request.files['dc']
    if not pdf_file.filename:
        return jsonify(ok=False, error="Nom de fichier vide"), 400

    filename = "".join(c for c in pdf_file.filename if c.isalnum() or c in "._- ")
    if not filename.lower().endswith('.pdf'):
        return jsonify(ok=False, error="Seuls les fichiers PDF sont acceptés"), 400

    # Dossier sécurisé par user + candidat
    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid_int)
    dc_dir.mkdir(parents=True, exist_ok=True)
    target = dc_dir / filename

    # Vérification path traversal
    try:
        if not str(target.resolve()).startswith(str((DATA_DIR / "dossiers_candidats" / str(uid)).resolve())):
            return jsonify(ok=False, error="Chemin invalide"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin invalide"), 403

    try:
        pdf_file.save(str(target))
        # Mettre à jour le champ dossier_competence_pdf du candidat
        with _conn() as conn:
            conn.execute(
                "UPDATE candidates SET dossier_competence_pdf=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (str(target), _now_iso(), cid_int, uid)
            )
        logger.info("DC uploadé: user=%s cand=%s file=%s", uid, cid_int, filename)
        return jsonify(ok=True, filename=filename, path=str(target))
    except Exception as e:
        logger.error("Erreur upload DC: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@candidates_bp.get("/api/candidates/<int:cid>/dc-status")
def api_candidate_dc_status(cid):
    """Vérifie si un DC est présent pour le candidat.
    Retourne: { ok, has_dc, files: [filename], generated: [{id, filename, generated_at, download_url}] }
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid)
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Candidat introuvable"), 404
        # DC générés via le générateur (table dc_generations)
        gen_rows = conn.execute(
            "SELECT id, filename, generated_at, used_ollama FROM dc_generations "
            "WHERE candidate_id=? AND owner_id=? AND deleted_at IS NULL "
            "ORDER BY generated_at DESC LIMIT 5;",
            (cid, uid)
        ).fetchall()

    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid)
    files = sorted([f.name for f in dc_dir.glob("*.pdf")]) if dc_dir.is_dir() else []
    # Fallback: ancien champ texte
    if not files and row["dossier_competence_pdf"]:
        files = [Path(row["dossier_competence_pdf"]).name]

    generated = []
    for g in (gen_rows or []):
        try:
            gen_dt = datetime.datetime.fromisoformat(g["generated_at"])
            gen_label = gen_dt.strftime('%d/%m/%Y à %H:%M')
        except Exception:
            gen_label = g["generated_at"] or ''
        generated.append({
            'id':           g["id"],
            'filename':     g["filename"] or '',
            'generated_at': gen_label,
            'used_ollama':  bool(g["used_ollama"]),
            'download_url': f'/api/dc/{g["id"]}/download',
        })

    has_dc = bool(files) or bool(generated)
    return jsonify(ok=True, has_dc=has_dc, files=files, generated=generated)


@candidates_bp.post("/api/candidates/<int:cid>/dc-rename")
def api_candidate_dc_rename(cid):
    """Renomme le fichier DC d'un candidat sur le disque et met à jour la DB."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    new_name = (payload.get("new_name") or "").strip()
    if not new_name:
        return jsonify(ok=False, error="Nouveau nom manquant"), 400
    # Sécurité : nom de fichier simple, sans chemin
    new_name = "".join(c for c in new_name if c.isalnum() or c in "._- ")
    if not new_name.lower().endswith(".pdf"):
        new_name += ".pdf"

    with _conn() as conn:
        row = conn.execute(
            "SELECT dossier_competence_pdf FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid)
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid)
    # Trouver le fichier existant
    existing_files = sorted(dc_dir.glob("*.pdf")) if dc_dir.is_dir() else []
    if not existing_files:
        return jsonify(ok=False, error="Aucun fichier DC trouvé"), 404

    old_file = existing_files[0]
    new_file = dc_dir / new_name

    # Vérification path traversal
    try:
        base = str((DATA_DIR / "dossiers_candidats" / str(uid)).resolve())
        if not str(new_file.resolve()).startswith(base):
            return jsonify(ok=False, error="Chemin invalide"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin invalide"), 403

    try:
        old_file.rename(new_file)
        with _conn() as conn:
            conn.execute(
                "UPDATE candidates SET dossier_competence_pdf=?, updatedAt=? WHERE id=? AND owner_id=?;",
                (str(new_file), _now_iso(), cid, uid)
            )
        logger.info("DC renommé: user=%s cand=%s %s→%s", uid, cid, old_file.name, new_name)
        return jsonify(ok=True, filename=new_name)
    except Exception as e:
        logger.error("Erreur renommage DC: %s", e)
        return jsonify(ok=False, error=str(e)), 500


@candidates_bp.post("/api/candidates/<int:cid>/dc-delete")
def api_candidate_dc_delete(cid):
    """Supprime le(s) fichier(s) DC d'un candidat du disque et efface le champ en DB."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid)
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Candidat introuvable"), 404

    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid)
    deleted = []
    if dc_dir.is_dir():
        for f in dc_dir.glob("*.pdf"):
            try:
                f.unlink()
                deleted.append(f.name)
            except Exception as e:
                logger.error("Erreur suppression DC %s: %s", f, e)

    with _conn() as conn:
        conn.execute(
            "UPDATE candidates SET dossier_competence_pdf=NULL, updatedAt=? WHERE id=? AND owner_id=?;",
            (_now_iso(), cid, uid)
        )
    logger.info("DC supprimé: user=%s cand=%s files=%s", uid, cid, deleted)
    return jsonify(ok=True, deleted=deleted)
