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
from utils.files import _candidate_attachment_dir, _validate_upload

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
            gen_ids = {
                int(r[0]) for r in conn.execute(
                    "SELECT DISTINCT candidate_id FROM dc_generations WHERE owner_id=? AND deleted_at IS NULL AND candidate_id IS NOT NULL;",
                    (uid,),
                ).fetchall()
            }
        out = []
        for r in rows:
            d = dict(r)
            d["skills"] = _parse_json_str_list(d.get("skills"))
            d["company_ids"] = _parse_json_int_list(d.get("company_ids"))
            d["has_dc"] = _candidate_has_dc(uid, d, gen_ids)
            out.append(d)
        from math import ceil
        return jsonify(ok=True, candidates=out, pagination={"page": page, "limit": limit, "total": total, "pages": ceil(total / limit) if limit else 1})
    # Non-paginated (backward compatible)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM candidates WHERE owner_id=? AND deleted_at IS NULL ORDER BY COALESCE(updatedAt, createdAt) DESC, id DESC;",
            (uid,),
        ).fetchall()
        gen_ids = {
            int(r[0]) for r in conn.execute(
                "SELECT DISTINCT candidate_id FROM dc_generations WHERE owner_id=? AND deleted_at IS NULL AND candidate_id IS NOT NULL;",
                (uid,),
            ).fetchall()
        }
    out: List[Dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        d["skills"] = _parse_json_str_list(d.get("skills"))
        d["company_ids"] = _parse_json_int_list(d.get("company_ids"))
        d["has_dc"] = _candidate_has_dc(uid, d, gen_ids)
        out.append(d)
    return jsonify(out)


def _candidate_has_dc(uid: int, cand: dict, gen_ids: set) -> bool:
    """Vrai si le candidat a un DC: PDF uploadé (champ ou fichier sur disque)
    OU un DC généré via le générateur (table dc_generations)."""
    if cand.get("dossier_competence_pdf"):
        return True
    cid = cand.get("id")
    if cid in gen_ids:
        return True
    dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cid)
    return dc_dir.is_dir() and any(dc_dir.glob("*.pdf"))


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
    """Télécharge le modèle de fiche entretien Excel.

    Si un fichier modèle existe dans docs/sample/, on le sert. Sinon on
    génère un modèle minimal à la volée pour que l'endpoint réponde toujours."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    # Cherche un fichier modèle existant (peut être nommé différemment)
    candidates_paths = [
        APP_DIR / "docs" / "Fiche entretien NEW Prenom NOM - EC1 XXX  JJMMAAAA.xlsx",
        APP_DIR / "sample" / "fiche_entretien.xlsx",
    ]
    for p in candidates_paths:
        if p.exists():
            return send_file(str(p), as_attachment=True, download_name="fiche_entretien_Up.xlsx")

    # Fallback : génération à la volée d'un template minimal
    from io import BytesIO
    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Fiche entretien"

    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=12)
    section_fill = PatternFill(start_color="EFF2F8", end_color="EFF2F8", fill_type="solid")
    section_font = Font(bold=True, size=11)

    ws["A1"] = "Fiche entretien candidat — Up Technologies"
    ws["A1"].font = Font(bold=True, size=14, color="2563EB")
    ws.merge_cells("A1:B1")

    rows = [
        ("", ""),
        ("IDENTITÉ", ""),
        ("Prénom", ""),
        ("Nom", ""),
        ("Email", ""),
        ("Téléphone", ""),
        ("LinkedIn", ""),
        ("Localisation", ""),
        ("", ""),
        ("PROFIL PROFESSIONNEL", ""),
        ("Métier / Poste recherché", ""),
        ("Expérience (années)", ""),
        ("Compétences techniques principales", ""),
        ("Langues", ""),
        ("", ""),
        ("DISPONIBILITÉ & MOBILITÉ", ""),
        ("Disponibilité", ""),
        ("TJM / Salaire visé", ""),
        ("Mobilité géographique", ""),
        ("Type de contrat souhaité", ""),
        ("", ""),
        ("ENTRETIEN EC1", ""),
        ("Date d'entretien", ""),
        ("Recruteur", ""),
        ("Notes EC1", ""),
        ("Décision", ""),
    ]
    for i, (label, value) in enumerate(rows, start=2):
        ws.cell(row=i, column=1, value=label)
        ws.cell(row=i, column=2, value=value)
        if label and not value and label.isupper():
            ws.cell(row=i, column=1).fill = section_fill
            ws.cell(row=i, column=1).font = section_font

    ws.column_dimensions["A"].width = 36
    ws.column_dimensions["B"].width = 60

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)
    return send_file(bio, as_attachment=True, download_name="fiche_entretien_Up.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


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


# ═══════════════════════════════════════════════════════════════════
# v32.75 — Pièces jointes candidat (CV, fiche entretien, suivi…)
# ═══════════════════════════════════════════════════════════════════

_ALLOWED_ATT_KINDS = {"cv", "ec1", "suivi", "autre"}


@candidates_bp.post("/api/candidates/<int:cid>/attachments")
def api_candidate_attachment_upload(cid):
    """Upload d'une pièce jointe pour un candidat (autre que le DC).

    multipart/form-data : file (obligatoire), title, kind (cv|ec1|suivi|autre), description.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _candidate_owned(cid):
        return jsonify(ok=False, error="Accès refusé"), 403

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify(ok=False, error="Fichier manquant"), 400

    ok_upload, err_upload = _validate_upload(file, "prospect_attachment")
    if not ok_upload:
        msg, code = err_upload
        return jsonify(ok=False, error=msg), code

    title = (request.form.get("title") or "").strip()[:120] or None
    description = (request.form.get("description") or "").strip()[:500] or None
    kind_raw = (request.form.get("kind") or "autre").strip().lower()
    kind = kind_raw if kind_raw in _ALLOWED_ATT_KINDS else "autre"

    import uuid as _uuid
    ext = os.path.splitext(file.filename or "")[1].lower()
    safe_orig = os.path.basename(file.filename or "").strip() or "fichier"
    stored_name = f"{_uuid.uuid4().hex}{ext}"

    attach_dir = _candidate_attachment_dir(uid, cid)
    target = attach_dir / stored_name
    # Path traversal guard
    try:
        base = str((Path("data") / f"user_{uid}" / "candidate_attachments").resolve())
        if not str(target.resolve()).startswith(base):
            return jsonify(ok=False, error="Chemin invalide"), 403
    except Exception:
        return jsonify(ok=False, error="Chemin invalide"), 403

    data = file.read()
    target.write_bytes(data)

    now = _now_iso()
    mime = file.mimetype or ""

    with _conn() as conn:
        cur = conn.execute(
            """INSERT INTO candidate_attachments
               (candidate_id, owner_id, filename, original_name, size, mime_type,
                description, title, kind, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (cid, uid, stored_name, safe_orig, len(data), mime, description, title, kind, now),
        )
        att_id = cur.lastrowid

    logger.info("Pièce jointe candidat: user=%s cand=%s kind=%s file=%s", uid, cid, kind, safe_orig)
    return jsonify(ok=True, id=att_id, original_name=safe_orig, size=len(data),
                   createdAt=now, kind=kind, title=title)


@candidates_bp.get("/api/candidates/<int:cid>/attachments")
def api_candidate_attachment_list(cid):
    """Liste des pièces jointes (hors DC) d'un candidat."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _candidate_owned(cid):
        return jsonify(ok=False, error="Accès refusé"), 403
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, filename, original_name, size, mime_type, description, title, kind, createdAt "
            "FROM candidate_attachments WHERE candidate_id=? AND owner_id=? ORDER BY createdAt DESC;",
            (cid, uid),
        ).fetchall()
    out = [dict(r) for r in rows]
    return jsonify(ok=True, attachments=out)


@candidates_bp.get("/api/candidate-attachments/<int:att_id>/file")
def api_candidate_attachment_file(att_id):
    """Sert le fichier d'une pièce jointe candidat (download)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM candidate_attachments WHERE id=? AND owner_id=?;",
            (att_id, uid),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Pièce jointe introuvable"), 404

    attach_dir = _candidate_attachment_dir(uid, row["candidate_id"])
    file_path = attach_dir / row["filename"]
    if not file_path.exists():
        return jsonify(ok=False, error="Fichier introuvable"), 404

    inline_mimes = {"application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"}
    disposition = "inline" if row["mime_type"] in inline_mimes else "attachment"
    return send_file(
        str(file_path),
        mimetype=row["mime_type"] or "application/octet-stream",
        as_attachment=(disposition == "attachment"),
        download_name=row["original_name"],
    )


@candidates_bp.patch("/api/candidate-attachments/<int:att_id>")
def api_candidate_attachment_update(att_id):
    """Met à jour les métadonnées d'une pièce jointe candidat (title, description, kind)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    body = request.get_json(force=True, silent=True) or {}
    sets, vals = [], []
    if "title" in body:
        v = (body.get("title") or "").strip()[:120] or None
        sets.append("title=?"); vals.append(v)
    if "description" in body:
        v = (body.get("description") or "").strip()[:500] or None
        sets.append("description=?"); vals.append(v)
    if "kind" in body:
        v = (body.get("kind") or "autre").strip().lower()
        if v not in _ALLOWED_ATT_KINDS:
            v = "autre"
        sets.append("kind=?"); vals.append(v)
    if not sets:
        return jsonify(ok=False, error="Aucun champ à modifier"), 400
    vals.extend([att_id, uid])
    with _conn() as conn:
        cur = conn.execute(
            f"UPDATE candidate_attachments SET {', '.join(sets)} WHERE id=? AND owner_id=?;",
            vals,
        )
        if cur.rowcount == 0:
            return jsonify(ok=False, error="Pièce jointe introuvable"), 404
    return jsonify(ok=True)


@candidates_bp.delete("/api/candidate-attachments/<int:att_id>")
def api_candidate_attachment_delete(att_id):
    """Supprime une pièce jointe candidat (fichier + DB)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT candidate_id, filename FROM candidate_attachments WHERE id=? AND owner_id=?;",
            (att_id, uid),
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Pièce jointe introuvable"), 404
        attach_dir = _candidate_attachment_dir(uid, row["candidate_id"])
        file_path = attach_dir / row["filename"]
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception as e:
            logger.warning("[candidate-attachment] delete file error att=%s: %s", att_id, e)
        conn.execute("DELETE FROM candidate_attachments WHERE id=? AND owner_id=?;", (att_id, uid))
    return jsonify(ok=True)


# ═══════════════════════════════════════════════════════════════════
# v32.75 — Fiche entretien EC1 — export Excel pré-rempli
# ═══════════════════════════════════════════════════════════════════

def _ec1_template_path() -> Path | None:
    """Localise le template Excel de fiche entretien EC1."""
    for p in (
        APP_DIR / "exemples" / "Fiche entretien NEW Prenom NOM - EC1 XXX  JJMMAAAA.xlsx",
        APP_DIR / "sample" / "fiche_entretien.xlsx",
        APP_DIR / "docs" / "Fiche entretien NEW Prenom NOM - EC1 XXX  JJMMAAAA.xlsx",
    ):
        if p.exists():
            return p
    return None


def _slugify_for_filename(s: str) -> str:
    """Convertit une chaîne en nom de fichier Excel safe."""
    s = re.sub(r"[^A-Za-z0-9_\-\. ]+", "", s or "").strip()
    return re.sub(r"\s+", "_", s) or "candidat"


def _ec1_apply_to_cell(ws, cell_ref: str, value):
    """Écrit `value` dans `cell_ref` en respectant les merges (on cible
    toujours la cellule top-left de la plage)."""
    try:
        from openpyxl.utils import range_boundaries  # type: ignore
    except Exception:
        ws[cell_ref] = value
        return
    target = cell_ref
    for rng in list(ws.merged_cells.ranges):
        try:
            min_col, min_row, max_col, max_row = range_boundaries(str(rng))
            tl = ws.cell(row=min_row, column=min_col).coordinate
            cell = ws[cell_ref]
            if (cell.row >= min_row and cell.row <= max_row
                    and cell.column >= min_col and cell.column <= max_col):
                target = tl
                break
        except Exception:
            continue
    try:
        ws[target] = value
    except Exception as e:
        logger.warning("[ec1] write cell %s failed: %s", target, e)


@candidates_bp.get("/api/candidates/<int:cid>/ec1-export.xlsx")
def api_candidate_ec1_export(cid):
    """Génère et télécharge la fiche entretien EC1 pré-remplie pour ce candidat."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _candidate_owned(cid):
        return jsonify(ok=False, error="Accès refusé"), 403

    with _conn() as conn:
        cand = conn.execute(
            "SELECT * FROM candidates WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid),
        ).fetchone()
        if not cand:
            return jsonify(ok=False, error="Candidat introuvable"), 404
        ec1_row = conn.execute(
            "SELECT interviewAt, data FROM candidate_ec1_checklists WHERE candidate_id=?;",
            (cid,),
        ).fetchone()

    from utils.db import _auth_conn
    try:
        with _auth_conn() as aconn:
            user = aconn.execute(
                "SELECT username, display_name FROM users WHERE id=?;", (uid,),
            ).fetchone()
    except Exception:
        user = None

    c = dict(cand)
    ec1_data = {}
    if ec1_row and ec1_row["data"]:
        try:
            ec1_data = json.loads(ec1_row["data"]) or {}
        except Exception:
            ec1_data = {}
    interview_at = ec1_row["interviewAt"] if ec1_row else None

    template = _ec1_template_path()
    if not template:
        return jsonify(ok=False, error="Template Excel introuvable"), 500

    try:
        import openpyxl  # type: ignore
    except ImportError:
        return jsonify(ok=False, error="openpyxl non installé"), 500

    try:
        wb = openpyxl.load_workbook(str(template))
        ws = wb["Dossier candidat"] if "Dossier candidat" in wb.sheetnames else wb.active

        # Recruteur — trigramme déduit du username ou des initiales du nom
        recruteur_user = (user["username"] if user else "") or ""
        trigramme = recruteur_user[:3].upper() if recruteur_user else "XXX"
        ec1_date_fmt = ""
        if interview_at:
            try:
                d = datetime.datetime.fromisoformat(interview_at)
                ec1_date_fmt = d.strftime("%d/%m/%Y")
            except Exception:
                ec1_date_fmt = interview_at[:10]
        elif c.get("entretien_date"):
            try:
                d = datetime.datetime.fromisoformat(c["entretien_date"])
                ec1_date_fmt = d.strftime("%d/%m/%Y")
            except Exception:
                ec1_date_fmt = (c.get("entretien_date") or "")[:10]

        nom_complet = c.get("name") or ""
        if c.get("prenom") and c.get("prenom") not in nom_complet:
            nom_complet = f"{c['prenom']} {nom_complet}".strip()

        # Identité — page 1
        _ec1_apply_to_cell(ws, "A3", "Prénom Nom : " + nom_complet)
        _ec1_apply_to_cell(ws, "A4", "Téléphone : " + (c.get("phone") or ""))
        _ec1_apply_to_cell(ws, "A5", "Mail : " + (c.get("email") or ""))

        diplomes = c.get("titre") or c.get("role") or ""
        annees = c.get("annees_experience") or c.get("years_experience") or c.get("seniority") or ""
        ligne_dip = "Dîplomes et expérience : " + str(diplomes)
        if annees:
            ligne_dip += f" — {annees} ans"
        _ec1_apply_to_cell(ws, "A6", ligne_dip)

        _ec1_apply_to_cell(ws, "C7", c.get("source") or "")
        _ec1_apply_to_cell(ws, "G6", trigramme)
        _ec1_apply_to_cell(ws, "H6", "OK" if (interview_at or c.get("entretien_date")) else "")
        _ec1_apply_to_cell(ws, "J6", ec1_date_fmt)

        # Permis / disponibilité / mobilité
        _ec1_apply_to_cell(ws, "B9", "Oui" if c.get("permis_conduire") else "Non")
        _ec1_apply_to_cell(ws, "D9", "Oui" if c.get("vehicule") else "Non")
        _ec1_apply_to_cell(ws, "G9", c.get("disponibilite") or "")
        _ec1_apply_to_cell(ws, "B10", c.get("permis_travail") or "")
        _ec1_apply_to_cell(ws, "B11", c.get("notes") or "")
        _ec1_apply_to_cell(ws, "I11", c.get("mobilite") or "")

        # Fonctions recherchées
        _ec1_apply_to_cell(ws, "A15", c.get("fonctions_recherchees") or "")

        # Motivations
        _ec1_apply_to_cell(ws, "A18", c.get("motif_recherche") or "")

        # Rémunération
        _ec1_apply_to_cell(ws, "B20", c.get("remuneration_actuelle") or "")
        _ec1_apply_to_cell(ws, "B21", c.get("pretentions_salariales") or "")
        _ec1_apply_to_cell(ws, "B22", c.get("propal_a") or "")
        _ec1_apply_to_cell(ws, "F20", c.get("avancement_recherches") or "")

        # Évaluation
        _ec1_apply_to_cell(ws, "B26", c.get("eval_technique") or "")
        _ec1_apply_to_cell(ws, "B27", c.get("eval_personnalite") or "")
        _ec1_apply_to_cell(ws, "B28", c.get("eval_communication") or "")
        _ec1_apply_to_cell(ws, "B29", c.get("status") or "")
        # Détails / commentaire libre = avis_perso
        if c.get("avis_perso"):
            _ec1_apply_to_cell(ws, "D25", c.get("avis_perso"))

        # Langues
        _ec1_apply_to_cell(ws, "B36", c.get("langues") or "")

        # Références
        _ec1_apply_to_cell(ws, "A45", c.get("references_candidat") or "")

        # Checklist EC1 (cases A48-A51) — annoter avec ✓ si coché
        ec1_items = [
            ("A48", "mobilite_dispo_souhaits"),
            ("A49", "fourchette_salaire"),
            ("A50", None),  # "Check dossier de compétences" — info de présence DC
            ("A51", None),  # "Prise de références"
        ]
        for cell_ref, key in ec1_items:
            checked = False
            note = ""
            if key and isinstance(ec1_data.get(key), dict):
                checked = bool(ec1_data[key].get("checked"))
                note = str(ec1_data[key].get("note") or "")
            cell_val = ws[cell_ref].value or ""
            prefix = "[X] " if checked else "[ ] "
            new_val = prefix + str(cell_val).lstrip(" ✓✗-")
            if note:
                new_val += f"  — {note}"
            _ec1_apply_to_cell(ws, cell_ref, new_val)

        # Note libre EC1 globale → ajoutée dans A52 si vide
        free_note = (ec1_data.get("__note") if isinstance(ec1_data, dict) else "") or (c.get("entretien_notes") or "")
        if free_note:
            _ec1_apply_to_cell(ws, "A52", "Notes : " + free_note[:400])

        from io import BytesIO
        bio = BytesIO()
        wb.save(bio)
        bio.seek(0)

        safe_name = _slugify_for_filename(c.get("name") or "candidat")
        today = datetime.datetime.now().strftime("%d%m%Y")
        download_name = f"Fiche_entretien_{safe_name}_EC1_{trigramme}_{today}.xlsx"

        return send_file(
            bio,
            as_attachment=True,
            download_name=download_name,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except Exception as e:
        logger.error("EC1 export failed: %s", e)
        return jsonify(ok=False, error=f"Erreur génération Excel : {e}"), 500


@candidates_bp.post("/api/candidates/<int:cid>/ec1-from-transcript")
def api_candidate_ec1_from_transcript(cid):
    """Analyse une transcription d'entretien EC1 via IA pour pré-remplir la
    fiche candidat + cocher les cases de la checklist EC1.

    Body JSON : { transcript: "...", apply: bool (false par défaut) }
    Retour : { ok, fields: { eval_technique, eval_personnalite, ... }, checklist: {...}, notes: "..." }
    Si apply=true, applique directement les champs en DB.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    if not _candidate_owned(cid):
        return jsonify(ok=False, error="Accès refusé"), 403

    body = request.get_json(force=True, silent=True) or {}
    transcript = (body.get("transcript") or "").strip()
    apply_now = bool(body.get("apply"))
    if not transcript:
        return jsonify(ok=False, error="Transcription vide"), 400
    if len(transcript) > 40000:
        transcript = transcript[:40000]

    prompt = f"""Tu es un assistant RH expert. Voici la transcription d'un entretien EC1 (entretien de qualification candidat) chez Up Technologies.

---
{transcript}
---

Extrait les informations suivantes et retourne UNIQUEMENT un objet JSON valide, sans texte avant ni après, sans balises markdown :
{{
  "fields": {{
    "disponibilite": "date ou délai de disponibilité (ex: Immédiate, 3 mois)",
    "mobilite": "zones géographiques (ex: Lyon, Paris, Nationale)",
    "fonctions_recherchees": "postes et secteurs visés",
    "motif_recherche": "motif de départ / motivations principales",
    "remuneration_actuelle": "rémunération actuelle (fixe + variable + avantages)",
    "pretentions_salariales": "prétentions salariales",
    "avancement_recherches": "avancement des autres pistes (ED/EP/Std By/discret)",
    "eval_technique": "évaluation technique (1-2 phrases)",
    "eval_personnalite": "évaluation personnalité (1-2 phrases)",
    "eval_communication": "évaluation communication (1-2 phrases)",
    "langues": "langues et niveaux (ex: Anglais B2 testé)",
    "references_candidat": "références transmises (nom, fonction, société, contact)",
    "avis_perso": "synthèse personnelle / avis du recruteur (3-4 phrases)",
    "entretien_notes": "compte-rendu structuré (notes EC1 : points clés, prochaines étapes)"
  }},
  "checklist": {{
    "mobilite_dispo_souhaits": {{"checked": true|false, "note": ""}},
    "impression_generale": {{"checked": true|false, "note": ""}},
    "evaluation_technique": {{"checked": true|false, "note": ""}},
    "evaluation_personnalite": {{"checked": true|false, "note": ""}},
    "evaluation_communication": {{"checked": true|false, "note": ""}},
    "rappel_valeurs_up": {{"checked": true|false, "note": ""}},
    "fourchette_salaire": {{"checked": true|false, "note": ""}},
    "reponse_questions_craintes": {{"checked": true|false, "note": ""}},
    "process_prochaines_etapes": {{"checked": true|false, "note": ""}}
  }}
}}

Mets les champs absents à la chaîne vide. Pour la checklist, mets `checked` à true si le sujet a été abordé pendant l'entretien."""

    try:
        config = _load_ai_config()
        timeout = int(config.get("ollama_timeout", 120))
        raw = _call_ollama_direct(prompt, config, timeout)
        clean = raw.strip()
        if clean.startswith("```"):
            clean = re.sub(r'^```[^\n]*\n?', '', clean)
            clean = re.sub(r'\n?```$', '', clean)
        json_match = re.search(r'\{[\s\S]*\}', clean)
        if not json_match:
            return jsonify(ok=False, error="L'IA n'a pas retourné de JSON valide", raw=raw[:500]), 422
        parsed = json.loads(json_match.group(0))
        fields = parsed.get("fields") or {}
        checklist = parsed.get("checklist") or {}
    except json.JSONDecodeError as e:
        return jsonify(ok=False, error=f"JSON invalide : {e}"), 422
    except Exception as e:
        logger.warning("EC1 from-transcript IA error: %s", e)
        return jsonify(ok=False, error=f"IA indisponible : {e}"), 503

    if apply_now:
        # Met à jour les champs candidat (fusion non destructive : ignore si vide)
        sets, vals = [], []
        for k in ("disponibilite", "mobilite", "fonctions_recherchees", "motif_recherche",
                  "remuneration_actuelle", "pretentions_salariales", "avancement_recherches",
                  "eval_technique", "eval_personnalite", "eval_communication", "langues",
                  "references_candidat", "avis_perso", "entretien_notes"):
            v = fields.get(k)
            if v not in (None, ""):
                sets.append(f"{k}=?"); vals.append(str(v).strip())
        if sets:
            vals.extend([_now_iso(), cid, uid])
            with _conn() as conn:
                conn.execute(
                    f"UPDATE candidates SET {', '.join(sets)}, updatedAt=? WHERE id=? AND owner_id=?;",
                    vals,
                )

        # Sauvegarde la checklist EC1
        if isinstance(checklist, dict) and checklist:
            now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            ec1_keys = {
                "mobilite_dispo_souhaits", "impression_generale", "evaluation_technique",
                "evaluation_personnalite", "evaluation_communication", "rappel_valeurs_up",
                "fourchette_salaire", "reponse_questions_craintes", "process_prochaines_etapes",
            }
            merged = {k: {"checked": False, "note": ""} for k in ec1_keys}
            merged["__note"] = ""
            for k, v in checklist.items():
                if k in ec1_keys and isinstance(v, dict):
                    merged[k] = {
                        "checked": bool(v.get("checked", False)),
                        "note": str(v.get("note") or "").strip(),
                    }
            with _conn() as conn:
                row = conn.execute(
                    "SELECT interviewAt FROM candidate_ec1_checklists WHERE candidate_id=?;",
                    (cid,),
                ).fetchone()
                interview_at = (row["interviewAt"] if row else None) or _today_iso()
                conn.execute(
                    """INSERT INTO candidate_ec1_checklists (candidate_id, interviewAt, data, updatedAt)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(candidate_id)
                       DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt""",
                    (cid, interview_at, json.dumps(merged, ensure_ascii=False), now),
                )

    return jsonify(ok=True, fields=fields, checklist=checklist, applied=apply_now)
