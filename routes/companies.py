"""ProspUp — Blueprint Companies (entreprises).

Routes :
  GET  /api/companies/list                — Liste légère pour autocomplete
  POST /api/companies/create              — Création + dédupe (groupe+site+owner)
  POST /api/companies/delete              — Soft delete
  POST /api/companies/<id>/enrich         — Enrichissement IA (Tavily + Ollama)

File d'attente IA (v32.65) :
  POST /api/companies/enrich-queue              — Enqueue N entreprises pour scrapping différé
  GET  /api/companies/enrich-queue              — Liste des jobs (badge + revue)
  POST /api/companies/enrich-queue/<jid>/discard — Ignorer un job sans appliquer
  DELETE /api/companies/enrich-queue/<jid>       — Retirer un job après application
  POST /api/companies/enrich-queue/clear-done    — Nettoyer tous les jobs terminés
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


# ─── Helper d'enrichissement réutilisable (route synchrone + worker async) ──
def _build_enrich_prompt(company: dict) -> tuple[str, str]:
    """Construit le prompt IA + la query Tavily pour une entreprise."""
    groupe = (company.get("groupe") or "").strip()
    site = (company.get("site") or "").strip()
    city_hint = (company.get("city") or "").strip()
    country_hint = (company.get("country") or "").strip()
    website_hint = (company.get("website") or "").strip()

    query_parts = [groupe]
    if site:
        query_parts.append(site)
    if city_hint:
        query_parts.append(city_hint)
    if not city_hint:
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
    return prompt, search_query


def _parse_enrich_response(result_text: str) -> tuple[dict, str]:
    """Extrait fields normalisés + sources depuis la réponse brute de _call_ai_web."""
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
        raise ValueError("L'IA n'a pas retourné de JSON valide")
    fields = json.loads(json_match.group(0))

    locs = fields.get("locations")
    if isinstance(locs, list):
        fields["locations"] = "\n".join(str(x).strip() for x in locs if str(x).strip())
    elif locs is None:
        fields["locations"] = ""
    else:
        fields["locations"] = str(locs).strip()

    if "main_city" in fields:
        fields["city"] = fields.pop("main_city")
    if "main_address" in fields:
        fields["address"] = fields.pop("main_address")

    allowed_keys = {"website", "linkedin", "industry", "size", "phone",
                    "city", "address", "country", "locations", "careers_url"}
    fields = {k: v for k, v in fields.items() if k in allowed_keys}

    sources_text = ""
    if sources_idx > 0:
        sources_text = result_text[sources_idx + 2:].strip()
    return fields, sources_text


def run_company_enrich(company: dict, timeout: int = 180) -> dict:
    """Lance l'enrichissement IA pour une entreprise (dict company).

    Retourne {"ok": True, "fields": {...}, "sources": "..."} en cas de succès,
    {"ok": False, "error": "...", "status": 503|422|400} sinon.
    Utilisé par la route synchrone ET le worker de file d'attente.
    """
    groupe = (company.get("groupe") or "").strip()
    if not groupe:
        return {"ok": False, "error": "Le groupe de l'entreprise est vide", "status": 400}

    prompt, search_query = _build_enrich_prompt(company)
    try:
        result_text = _call_ai_web(prompt, timeout=timeout, search_query=search_query)
    except Exception as e:
        return {"ok": False, "error": f"IA indisponible : {e}", "status": 503}

    try:
        fields, sources_text = _parse_enrich_response(result_text)
    except (ValueError, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e) or "JSON invalide",
                "raw": result_text[:2000], "status": 422}

    return {"ok": True, "fields": fields, "sources": sources_text}


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

    result = run_company_enrich(dict(row))
    if not result.get("ok"):
        status = result.pop("status", 500)
        logger.warning("Company enrich error (cid=%s): %s", cid, result.get("error"))
        return jsonify(ok=False, **{k: v for k, v in result.items() if k != "ok"}), status

    return jsonify(ok=True, fields=result["fields"], sources=result.get("sources", ""))


# ─── File d'attente IA (v32.65) ─────────────────────────────────────────────
# La table companies_enrich_queue est créée par init_db() dans app.py.
# Status flow : pending → running → done (ou error)
# Le worker de fond (app.py) traite 1 job pending toutes les 5 s.

_QUEUE_TERMINAL = ("done", "error")


def _queue_row_to_dict(row) -> dict:
    d = dict(row)
    fj = d.pop("fields_json", None) or ""
    try:
        d["fields"] = json.loads(fj) if fj else None
    except (json.JSONDecodeError, ValueError):
        d["fields"] = None
    return d


@companies_bp.post("/api/companies/enrich-queue")
@role_required('editor')
def api_companies_enrich_queue_enqueue():
    """Met N entreprises en file d'attente pour scrapping IA asynchrone.

    Body: {"ids": [int]}
    Retourne {ok, enqueued, skipped, duplicates}.
    Évite les doublons : si un job pending/running existe déjà pour (owner, company), il est ignoré.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    raw_ids = payload.get("ids") or []
    if not isinstance(raw_ids, list):
        return jsonify(ok=False, error="ids must be a list"), 400
    try:
        ids = [int(x) for x in raw_ids if x is not None]
    except (TypeError, ValueError):
        return jsonify(ok=False, error="ids must be integers"), 400
    if not ids:
        return jsonify(ok=False, error="Aucune entreprise fournie"), 400

    enqueued = 0
    skipped = 0
    duplicates = 0
    now = _now_iso()
    with _conn() as conn:
        existing = conn.execute(
            "SELECT id FROM companies WHERE id IN (%s) AND owner_id=? AND deleted_at IS NULL;"
            % ",".join("?" * len(ids)),
            (*ids, uid)
        ).fetchall()
        valid_ids = {int(r["id"]) for r in existing}
        skipped = len(ids) - len(valid_ids)

        if valid_ids:
            already = conn.execute(
                "SELECT company_id FROM companies_enrich_queue "
                "WHERE owner_id=? AND status IN ('pending','running') "
                "AND company_id IN (%s);" % ",".join("?" * len(valid_ids)),
                (uid, *list(valid_ids))
            ).fetchall()
            dup_set = {int(r["company_id"]) for r in already}
            duplicates = len(dup_set)
            to_insert = [cid for cid in valid_ids if cid not in dup_set]
            for cid in to_insert:
                conn.execute(
                    "INSERT INTO companies_enrich_queue "
                    "(company_id, owner_id, status, created_at) "
                    "VALUES (?, ?, 'pending', ?);",
                    (cid, uid, now)
                )
                enqueued += 1
            if enqueued:
                _audit_log("enrich_enqueue", "company", new_value=str(enqueued))
    return jsonify(ok=True, enqueued=enqueued, skipped=skipped, duplicates=duplicates)


@companies_bp.get("/api/companies/enrich-queue")
def api_companies_enrich_queue_list():
    """Liste les jobs de l'utilisateur courant + counts.

    Query: ?status=pending|running|done|error (optionnel, défaut: tous)
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    status_filter = (request.args.get("status") or "").strip()
    where = "q.owner_id=?"
    params: list = [uid]
    if status_filter in ("pending", "running", "done", "error"):
        where += " AND q.status=?"
        params.append(status_filter)
    with _conn() as conn:
        rows = conn.execute(
            f"""
            SELECT q.id, q.company_id, q.status, q.fields_json, q.sources, q.error,
                   q.created_at, q.processed_at,
                   c.groupe, c.site, c.deleted_at AS company_deleted_at
              FROM companies_enrich_queue q
              LEFT JOIN companies c ON c.id = q.company_id
             WHERE {where}
             ORDER BY q.created_at DESC, q.id DESC
             LIMIT 500;
            """,
            params
        ).fetchall()
        counts_rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM companies_enrich_queue "
            "WHERE owner_id=? GROUP BY status;",
            (uid,)
        ).fetchall()
    items = [_queue_row_to_dict(r) for r in rows]
    counts = {"pending": 0, "running": 0, "done": 0, "error": 0, "total": 0}
    for r in counts_rows:
        s = r["status"]
        if s in counts:
            counts[s] = int(r["n"])
        counts["total"] += int(r["n"])
    return jsonify(ok=True, items=items, counts=counts)


@companies_bp.post("/api/companies/enrich-queue/<int:jid>/discard")
@role_required('editor')
def api_companies_enrich_queue_discard(jid):
    """Supprime un job (utilisé quand l'utilisateur ignore une suggestion sans appliquer)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cur = conn.execute(
            "DELETE FROM companies_enrich_queue WHERE id=? AND owner_id=?;",
            (jid, uid)
        )
        if cur.rowcount == 0:
            return jsonify(ok=False, error="Job introuvable"), 404
    return jsonify(ok=True)


@companies_bp.delete("/api/companies/enrich-queue/<int:jid>")
@role_required('editor')
def api_companies_enrich_queue_delete(jid):
    """Supprime un job (utilisé après application réussie des champs)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cur = conn.execute(
            "DELETE FROM companies_enrich_queue WHERE id=? AND owner_id=?;",
            (jid, uid)
        )
        if cur.rowcount == 0:
            return jsonify(ok=False, error="Job introuvable"), 404
    return jsonify(ok=True)


@companies_bp.post("/api/companies/enrich-queue/clear-done")
@role_required('editor')
def api_companies_enrich_queue_clear_done():
    """Nettoie tous les jobs terminés (done + error) de l'utilisateur."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        cur = conn.execute(
            "DELETE FROM companies_enrich_queue "
            "WHERE owner_id=? AND status IN ('done', 'error');",
            (uid,)
        )
    return jsonify(ok=True, deleted=cur.rowcount)
