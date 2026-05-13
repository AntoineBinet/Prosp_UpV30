"""ProspUp — Blueprint Companies (entreprises).

Routes :
  GET  /api/companies/list                — Liste légère pour autocomplete
  POST /api/companies/create              — Création + dédupe (groupe+site+owner)
  POST /api/companies/delete              — Soft delete
  POST /api/companies/<id>/enrich         — Enrichissement IA (Tavily + Ollama)

Phase B de la modularisation. Ces routes étaient contigües dans app.py
(lignes 6716-6803) et ne dépendent que de helpers déjà extraits en utils/.
"""
from __future__ import annotations

import json
import logging
import re

from flask import Blueprint, jsonify, request

from app import _audit_log, log_activity
from utils.ai_helpers import _call_ai_web
from utils.auth import _uid, role_required
from utils.common import _now_iso
from utils.db import _conn

logger = logging.getLogger("prospup")

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


@companies_bp.post("/api/companies/<int:cid>/enrich")
@role_required('editor')
def api_companies_enrich(cid):
    """Enrichit une fiche entreprise via Tavily (recherche web) + Ollama (extraction JSON).

    Récupère : website, linkedin, industry, size, phone (standard), country,
    main_city/main_address (priorité Lyon si possible), locations (sites),
    careers_url (lien annonces).
    Retourne { ok, fields: {...} } pour pré-remplissage côté front (preview + apply).
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM companies WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (cid, uid)
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Entreprise introuvable"), 404

    company = dict(row)
    groupe = (company.get("groupe") or "").strip()
    if not groupe:
        return jsonify(ok=False, error="Le groupe de l'entreprise est vide"), 400

    site = (company.get("site") or "").strip()
    city_hint = (company.get("city") or "").strip()
    country_hint = (company.get("country") or "").strip()
    website_hint = (company.get("website") or "").strip()

    # Query Tavily : utiliser le groupe + ville si présente pour éviter les homonymes
    query_parts = [groupe]
    if site:
        query_parts.append(site)
    if city_hint:
        query_parts.append(city_hint)
    if not city_hint:
        # Pas de ville connue : on biaise vers Lyon en priorité
        query_parts.append("Lyon France")
    search_query = " ".join(query_parts)[:200]

    prompt = f"""Tu es un assistant B2B expert en sourcing d'entreprises françaises.

Voici les infos déjà connues sur l'entreprise :
- Groupe / nom : {groupe}
- Site / établissement actuel : {site or '(non renseigné)'}
- Ville actuelle : {city_hint or '(non renseigné)'}
- Pays actuel : {country_hint or '(non renseigné)'}
- Site web actuel : {website_hint or '(non renseigné)'}

À partir des informations web fournies, extrais les données vérifiées sur CETTE entreprise.

Règles critiques :
1. **Localisation prioritaire** : si l'entreprise a un site/bureau en région lyonnaise
   (Lyon, Villeurbanne, Vénissieux, Bron, Villefranche, Saint-Étienne, Limonest, Écully, Dardilly, Caluire, Meyzieu, Décines, Vaulx-en-Velin, Rhône, Métropole de Lyon, Auvergne-Rhône-Alpes), c'est ce site qu'il faut renvoyer en priorité dans `main_city`, `main_address`, `phone`.
2. Si la ville actuelle est déjà renseignée, vérifie que les résultats correspondent à cette ville (pas un homonyme dans un autre pays/région).
3. Si aucun site en région lyonnaise, élargis à la France entière puis à l'international.
4. **Numéro de standard** : numéro de téléphone du standard principal du site retenu (format français +33 ou 0X XX XX XX XX si possible).
5. **Locations** : liste de TOUS les sites/bureaux connus de l'entreprise (au moins la ville, idéalement "Ville (Pays)"). Mets le site lyonnais en premier si présent.
6. **Careers URL** : lien direct vers la page de recrutement / liste d'offres d'emploi du site officiel de l'entreprise (PAS un lien LinkedIn jobs ni Welcome to the Jungle si la page interne existe). Privilégie l'URL de leur ATS interne (ex. /carrieres, /jobs, /recrutement, /emplois, /careers).
7. Si une information n'est pas vérifiable dans les sources web, renvoie null pour ce champ (ne devine pas).

Retourne UNIQUEMENT un objet JSON valide, sans texte avant ni après, sans balises markdown :
{{
  "website": "URL du site officiel (https://…) ou null",
  "linkedin": "URL LinkedIn de l'entreprise (https://linkedin.com/company/…) ou null",
  "industry": "Secteur d'activité court (ex: SaaS B2B, Industrie pharmaceutique, Cabinet de conseil) ou null",
  "size": "Nombre d'employés (texte court : ex '50-200', '500+', '12 000 collaborateurs') ou null",
  "phone": "Numéro de standard du site retenu, format français lisible, ou null",
  "main_city": "Ville du site retenu (priorité Lyon) ou null",
  "main_address": "Adresse postale complète du site retenu ou null",
  "country": "Pays du site retenu (France si Lyon) ou null",
  "locations": ["Ville (Pays)", "Ville (Pays)", "…"],
  "careers_url": "URL directe de la page d'offres d'emploi du site officiel, ou null"
}}

Si `locations` est vide, mets [].
"""

    try:
        result_text = _call_ai_web(prompt, timeout=180, search_query=search_query)
    except Exception as e:
        logger.warning("Company enrich AI error (cid=%s): %s", cid, e)
        return jsonify(ok=False, error=f"IA indisponible : {e}"), 503

    # Strip "Sources :" footer appended by _call_ai_web
    cleaned = result_text
    sources_idx = cleaned.find("\n\nSources :")
    if sources_idx > 0:
        cleaned = cleaned[:sources_idx]
    cleaned = cleaned.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r'^```[^\n]*\n?', '', cleaned)
        cleaned = re.sub(r'\n?```$', '', cleaned)

    json_match = re.search(r'\{[\s\S]*\}', cleaned)
    if not json_match:
        logger.warning("Company enrich: no JSON found in response (cid=%s, %d chars)", cid, len(cleaned))
        return jsonify(ok=False, error="L'IA n'a pas retourné de JSON valide", raw=result_text[:2000]), 422
    try:
        fields = json.loads(json_match.group(0))
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Company enrich JSON parse error (cid=%s): %s", cid, e)
        return jsonify(ok=False, error="L'IA n'a pas retourné un JSON valide", raw=result_text[:2000]), 422

    # Normalisation : on met locations en texte multi-ligne pour l'affichage côté UI
    locs = fields.get("locations")
    if isinstance(locs, list):
        fields["locations"] = "\n".join(str(x).strip() for x in locs if str(x).strip())
    elif locs is None:
        fields["locations"] = ""
    else:
        fields["locations"] = str(locs).strip()

    # Mapping vers les colonnes DB : main_city/main_address → city/address
    if "main_city" in fields:
        fields["city"] = fields.pop("main_city")
    if "main_address" in fields:
        fields["address"] = fields.pop("main_address")

    # Conserver uniquement les champs whitelist DB pour éviter qu'un champ exotique
    # remonté par l'IA pollue le preview front
    allowed_keys = {"website", "linkedin", "industry", "size", "phone",
                    "city", "address", "country", "locations", "careers_url"}
    fields = {k: v for k, v in fields.items() if k in allowed_keys}

    # Extraire sources Tavily pour traçabilité côté UI
    sources_text = ""
    if sources_idx > 0:
        sources_text = result_text[sources_idx + 2:].strip()

    return jsonify(ok=True, fields=fields, sources=sources_text)
