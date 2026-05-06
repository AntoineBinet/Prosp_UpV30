"""ProspUp — Blueprint Companies (entreprises).

Routes :
  GET  /api/companies/list   — Liste légère pour autocomplete
  POST /api/companies/create — Création + dédupe (groupe+site+owner)
  POST /api/companies/delete — Soft delete

Phase B de la modularisation. Ces 3 routes étaient contigües dans app.py
(lignes 6716-6803) et ne dépendent que de helpers déjà extraits en utils/.
"""
from __future__ import annotations

import json

from flask import Blueprint, jsonify, request

from app import _audit_log, log_activity
from utils.auth import _uid, role_required
from utils.common import _now_iso
from utils.db import _conn

companies_bp = Blueprint("companies", __name__)


@companies_bp.get("/api/companies/list")
def api_companies_list():
    """v30.2 : liste allégée des entreprises de l'utilisateur pour alimenter
    l'autocomplete « entreprise » (picker) sur toutes les pages."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, groupe, site FROM companies "
            "WHERE owner_id=? AND deleted_at IS NULL "
            "ORDER BY LOWER(groupe), LOWER(COALESCE(site,''));",
            (uid,)
        ).fetchall()
    companies = [
        {"id": int(r["id"]), "groupe": r["groupe"] or "", "site": r["site"] or ""}
        for r in rows
    ]
    return jsonify(ok=True, companies=companies)


@companies_bp.post("/api/companies/create")
@role_required('editor')
def api_companies_create():
    """v30.4 : créer une entreprise (sans prospect attaché). Retourne l'ID assigné.

    Dédupe strict : même groupe + site + owner → renvoie l'existant.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    groupe = (payload.get("groupe") or "").strip()
    if not groupe:
        return jsonify(ok=False, error="groupe est requis"), 400
    site = (payload.get("site") or "").strip()
    phone = (payload.get("phone") or "").strip()
    notes = (payload.get("notes") or "").strip()
    website = (payload.get("website") or "").strip()
    linkedin = (payload.get("linkedin") or "").strip()
    industry = (payload.get("industry") or "").strip()

    tags_raw = payload.get("tags")
    if isinstance(tags_raw, list):
        tags_json = json.dumps([str(t).strip() for t in tags_raw if str(t).strip()], ensure_ascii=False)
    elif isinstance(tags_raw, str) and tags_raw.strip():
        s = tags_raw.strip()
        if s.startswith("["):
            tags_json = s
        else:
            tags_json = json.dumps([t.strip() for t in s.split(",") if t.strip()], ensure_ascii=False)
    else:
        tags_json = "[]"

    with _conn() as conn:
        # Dedupe strict : même groupe + site + owner → on renvoie l'existant
        row = conn.execute(
            "SELECT id FROM companies WHERE owner_id=? AND LOWER(groupe)=LOWER(?) AND LOWER(COALESCE(site,''))=LOWER(?) AND deleted_at IS NULL;",
            (uid, groupe, site)
        ).fetchone()
        if row:
            return jsonify(ok=True, id=int(row["id"]), deduped=True)
        # MAX global (id est PRIMARY KEY) — un filtre owner_id provoquerait des
        # collisions UNIQUE quand plusieurs users partagent la DB principale
        # (cas d'un user nouveau dont la per-user DB est encore vide).
        max_id = conn.execute("SELECT COALESCE(MAX(id),0) as m FROM companies;").fetchone()["m"]
        new_id = int(max_id) + 1
        conn.execute(
            """INSERT INTO companies (id, groupe, site, phone, notes, tags, website, linkedin, industry, owner_id)
               VALUES (?,?,?,?,?,?,?,?,?,?);""",
            (new_id, groupe, site, phone, notes, tags_json, website, linkedin, industry, uid)
        )
    return jsonify(ok=True, id=new_id)


@companies_bp.post("/api/companies/delete")
def api_companies_delete():
    """v27.10 : soft delete une entreprise (fenêtre d'annulation 10s via /api/soft-deleted/restore)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    cid = payload.get("id")
    if not cid:
        return jsonify(ok=False, error="id is required"), 400
    _name = None
    with _conn() as conn:
        _row = conn.execute("SELECT groupe FROM companies WHERE id=? AND owner_id=?;", (int(cid), uid)).fetchone()
        _name = _row["groupe"] if _row else None
        conn.execute("UPDATE companies SET deleted_at=? WHERE id=? AND owner_id=?;", (_now_iso(), int(cid), uid))
    _audit_log("soft_delete", "company", int(cid))
    log_activity('delete', 'entreprise', int(cid), _name)
    return jsonify(ok=True)
