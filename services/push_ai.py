"""ProspUp — Assistant IA du push : secteur, catégorie et candidats.

Pipeline transparent diffusé en SSE pour la modale « Pousser ». Au lieu d'un
spinner opaque, l'utilisateur voit chaque étape du raisonnement de l'IA :

    profil → recherche web (Tavily) → secteur + catégorie (Ollama)
           → scoring candidats (déterministe) → classement + justifications (Ollama)

Découpage du contexte Flask :
  - `gather_plan_input()` lit la DB ; il DOIT tourner dans le contexte de
    requête (sinon `_conn()` retombe sur la DB principale au lieu de la DB
    per-user — voir utils/db.py).
  - `stream_push_ai_plan()` est un générateur PUR (Tavily + Ollama + calcul) :
    il ne touche ni la base ni `request`, ce qui le rend sûr à itérer pendant
    le streaming de la réponse, hors contexte de requête.

Powered route : GET /api/prospect/<id>/push-ai-plan (routes/push.py).
"""
from __future__ import annotations

import json
import logging
import re

from app import _keywords_from_fixed_metier, _keywords_from_notes, _parse_json_str_list
from utils.ai_helpers import (
    _call_ai,
    _call_tavily_search,
    _compute_semantic_similarity,
    _load_ai_config,
)
from utils.db import _conn

logger = logging.getLogger("prospup")

# Secteurs reconnus pour le bonus de matching candidat (×2 dans le scoring).
SECTOR_KEYWORDS = {
    "automobile", "auto", "aéronautique", "aeronautique", "aero", "ferroviaire",
    "défense", "defense", "spatial", "médical", "medical", "énergie", "energie",
    "nucléaire", "nucleaire", "iot", "telecom", "télécom", "telecom", "robotique",
    "naval", "industriel", "consumer", "domotique", "transport", "btp", "oil", "gas",
}

# Référence de score pour normaliser le pourcentage de pertinence (0-100).
SCORE_MAX_REF = 35.0  # ~ tag 15 + secteur 6 + exp 7.5 + geo 3


# ── Helpers SSE / JSON ───────────────────────────────────────────────
def _sse(payload: dict) -> str:
    """Sérialise un événement au format Server-Sent Events."""
    return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


def _extract_json(raw: str, kind: str = "object"):
    """Extrait le 1er objet/tableau JSON d'une réponse IA. None si introuvable."""
    if not raw:
        return None
    pattern = r"\{[\s\S]*\}" if kind == "object" else r"\[[\s\S]*\]"
    m = re.search(pattern, raw)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except (json.JSONDecodeError, ValueError):
        return None


def _as_str_list(v) -> list:
    """Coerce une valeur IA (str | list | None) en liste de chaînes nettoyées."""
    if v is None:
        return []
    if isinstance(v, str):
        return [p.strip() for p in re.split(r"[,;\n]", v) if p.strip()]
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    return []


def _norm(s) -> str:
    return (str(s) if s is not None else "").strip().lower()


# ── Collecte DB (contexte de requête requis) ─────────────────────────
def gather_plan_input(uid: int, prospect_id: int, preset_category_id=None):
    """Charge prospect + entreprise + catégories + candidats depuis la DB.

    À appeler DANS le contexte de requête Flask (DB per-user). Retourne
    `(plan_input, error_message)` — `error_message` non-nul si introuvable.
    """
    with _conn() as conn:
        p_row = conn.execute(
            "SELECT id, name, fonction, tags, company_id, notes, fixedMetier, pertinence "
            "FROM prospects WHERE id=? AND owner_id=?;",
            (prospect_id, uid),
        ).fetchone()
        if not p_row:
            return None, "Prospect introuvable"
        prospect = dict(p_row)

        company = {}
        if prospect.get("company_id"):
            c_row = conn.execute(
                "SELECT * FROM companies WHERE id=? AND owner_id=?;",
                (prospect["company_id"], uid),
            ).fetchone()
            if c_row:
                company = dict(c_row)

        categories = [dict(r) for r in conn.execute(
            "SELECT * FROM push_categories WHERE owner_id=? ORDER BY name;", (uid,)
        ).fetchall()]

        candidates = [dict(r) for r in conn.execute(
            "SELECT * FROM candidates WHERE owner_id=?;", (uid,)
        ).fetchall()]

    return {
        "uid": uid,
        "prospect": prospect,
        "company": company,
        "categories": categories,
        "candidates": candidates,
        "preset_category_id": int(preset_category_id) if preset_category_id else None,
    }, None


# ── Construction des mots-clés de recherche ──────────────────────────
def _build_keyword_sources(prospect: dict, company: dict, ai_keywords: list, category) -> dict:
    """Agrège toutes les sources de mots-clés + métadonnées de scoring.

    Sources « fortes » (match exact ×3) : tags, tags entreprise, mots-clés
    catégorie, mots-clés métier déduits par l'IA. Sources « douces » (×1) :
    fonction, notes, secteur CRM — plus génériques, on évite qu'elles dominent.
    """
    company = company or {}
    prospect_tags = _parse_json_str_list(prospect.get("tags"))
    fixed_kw = _keywords_from_fixed_metier(prospect.get("fixedMetier"))
    notes_kw = _keywords_from_notes(prospect.get("notes"))
    fonction_kw = _keywords_from_notes(prospect.get("fonction"))
    company_tags = _parse_json_str_list(company.get("tags"))
    industry = _norm(company.get("industry"))
    industry_kw = _keywords_from_notes(company.get("industry"))
    category_kw = _parse_json_str_list(category.get("keywords")) if category else []

    # tags effectifs = tags + fixedMetier (fixedMetier seul si pas de tags)
    effective_tags = list(prospect_tags)
    seen = {t.lower() for t in effective_tags}
    for kw in fixed_kw:
        if kw.lower() not in seen:
            effective_tags.append(kw)
            seen.add(kw.lower())

    all_sources = (
        [_norm(t) for t in effective_tags]
        + [_norm(t) for t in company_tags]
        + [_norm(t) for t in category_kw]
        + [_norm(k) for k in ai_keywords]
        + [_norm(k) for k in notes_kw]
        + [_norm(k) for k in fonction_kw]
        + [_norm(k) for k in industry_kw]
    )
    search_tags = [t for t in dict.fromkeys(all_sources) if t]

    # Mots-clés « doux » → poids ×1 au lieu de ×3 sur un match exact.
    notes_set = {_norm(k) for k in (notes_kw + fonction_kw + industry_kw)}

    # Secteurs entreprise → bonus ×2 si le candidat évolue dans le même secteur.
    company_sectors = set()
    for t in company_tags:
        if t.lower() in SECTOR_KEYWORDS:
            company_sectors.add(t.lower())
    for kw in ai_keywords:
        if kw.lower() in SECTOR_KEYWORDS:
            company_sectors.add(kw.lower())
    if industry:
        for s in SECTOR_KEYWORDS:
            if s in industry:
                company_sectors.add(s)

    company_city = _norm(company.get("city") or company.get("site"))

    pertinence = _norm(prospect.get("pertinence"))
    pertinence_cap = None
    if "faible" in pertinence or "low" in pertinence:
        pertinence_cap = 50
    elif "modér" in pertinence or "moder" in pertinence:
        pertinence_cap = 70

    return {
        "search_tags": search_tags,
        "notes_set": notes_set,
        "company_sectors": company_sectors,
        "company_city": company_city,
        "pertinence_cap": pertinence_cap,
    }


# ── Scoring déterministe des candidats ───────────────────────────────
def _score_candidates(candidates: list, search_tags: list, notes_set: set,
                      company_sectors: set, company_city: str, pertinence_cap) -> list:
    """Score chaque candidat : tags(×3/×1), secteur(×2), expérience(×1.5), géo(×1)."""
    scored = []
    for c in candidates:
        if c.get("is_archived") or c.get("deleted_at"):
            continue
        skills = _parse_json_str_list(c.get("skills"))
        role = _norm(c.get("role"))
        tech = _norm(c.get("tech"))
        c_location = _norm(c.get("location"))
        c_sector = _norm(c.get("sector"))
        c_notes = _norm(c.get("notes"))
        c_years = c.get("years_experience")
        skills_lower = [s.lower() for s in skills]
        haystack = " ".join(skills_lower) + " " + role + " " + tech + " " + c_notes

        # 1. Mots-clés : match exact (skill) > match partiel (haystack) > sémantique.
        matched_tags = []
        tag_score = 0
        semantic_matches = []
        for tag_l in search_tags:
            exact = False
            if tag_l in skills_lower:
                tag_score += 1 if tag_l in notes_set else 3
                matched_tags.append(tag_l)
                exact = True
            elif tag_l in haystack:
                tag_score += 1
                matched_tags.append(tag_l)
                exact = True
            if not exact:
                best_sim, best_skill = 0.0, None
                for skill in skills_lower:
                    sim = _compute_semantic_similarity(tag_l, skill, "tag")
                    if sim > 0.7 and sim > best_sim:
                        best_sim, best_skill = sim, skill
                if best_skill:
                    tag_score += 1 if tag_l in notes_set else 2
                    matched_tags.append(tag_l)
                    semantic_matches.append(tag_l + "≈" + best_skill)

        # 2. Secteur (×2)
        sector_score = 0
        if company_sectors:
            c_sectors_text = c_sector + " " + c_notes + " " + role
            for sec in company_sectors:
                if sec in c_sectors_text:
                    sector_score += 2

        # 3. Expérience (×1.5, plafonnée)
        exp_score = 0
        if c_years is not None and c_years > 0:
            exp_score = min(c_years / 2, 5) * 1.5

        # 4. Proximité géographique (×1)
        geo_score = 0
        if company_city and c_location:
            if company_city in c_location or c_location in company_city:
                geo_score = 3
            elif any(w in c_location for w in company_city.split() if len(w) > 3):
                geo_score = 1

        total = tag_score + sector_score + exp_score + geo_score
        if total <= 0:
            continue

        total_prospect = len(search_tags) or 1
        pct = round(len(set(matched_tags)) / total_prospect * 100)
        if total_prospect < 4:
            pct = min(pct, 85)
        relevance_pct = min(100, round(total / SCORE_MAX_REF * 100))
        if pertinence_cap is not None:
            pct = min(pct, pertinence_cap)
            relevance_pct = min(relevance_pct, pertinence_cap)

        scored.append({
            "id": c["id"],
            "name": c.get("name", ""),
            "role": c.get("role", ""),
            "skills": skills,
            "tech": c.get("tech", ""),
            "status": c.get("status", ""),
            "linkedin": c.get("linkedin", ""),
            "phone": c.get("phone", ""),
            "years_experience": c_years,
            "location": c.get("location", ""),
            "score": round(total, 1),
            "pct": pct,
            "relevance_pct": relevance_pct,
            "matched_tags": list(set(matched_tags)),
            "semantic_matches": semantic_matches,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored


def _score_categories(categories: list, prospect_keywords: set) -> list:
    """Classe les catégories par recouvrement de mots-clés. Retourne [(cat, score)]."""
    out = []
    for cat in categories:
        cat_kws = [k.lower() for k in _parse_json_str_list(cat.get("keywords"))]
        name_words = [w.lower() for w in re.split(r"[\s_\-/]+", cat.get("name") or "") if len(w) > 2]
        terms = set(cat_kws + name_words)
        if not terms:
            continue
        score = 0
        for t in terms:
            if t in prospect_keywords:
                score += 2
            elif len(t) > 3:
                for pk in prospect_keywords:
                    if t in pk or pk in t:
                        score += 1
                        break
        if score > 0:
            out.append((cat, score))
    out.sort(key=lambda x: x[1], reverse=True)
    return out


# ── Prompts IA ───────────────────────────────────────────────────────
def _detect_sector_category(prospect: dict, company: dict, categories: list, web_block: str) -> dict:
    """1 appel Ollama : secteur d'activité + mots-clés métier + meilleure catégorie."""
    company = company or {}
    cat_lines = []
    for c in categories:
        kws = ", ".join(_parse_json_str_list(c.get("keywords"))[:10])
        cat_lines.append(str(c["id"]) + " · " + (c.get("name") or "")
                         + (" · mots-clés: " + kws if kws else ""))
    cats_text = "\n".join(cat_lines) if cat_lines else "Aucune catégorie configurée."
    notes = (prospect.get("notes") or "—")
    if len(notes) > 400:
        notes = notes[:400] + "…"

    prompt = (
        "Tu es analyste secteur dans un cabinet de conseil en ingénierie B2B "
        "(placement de consultants).\n\n"
        "OBJECTIF : à partir du profil ci-dessous, déterminer (1) le SECTEUR "
        "d'activité réel du prospect, (2) le TYPE DE CONSULTANT à lui proposer, "
        "(3) la CATÉGORIE DE PUSH la plus adaptée parmi la liste fournie.\n\n"
        "── PROSPECT ──────────────────────────────\n"
        "Nom        : " + (prospect.get("name") or "—") + "\n"
        "Fonction   : " + (prospect.get("fonction") or "—") + "\n"
        "Entreprise : " + (company.get("groupe") or "—") + "\n"
        "Secteur CRM: " + (company.get("industry") or "—") + "\n"
        "Notes      : " + notes + "\n\n"
        "── INFOS WEB (recherche Tavily) ──────────\n"
        + (web_block or "Aucune information web disponible.") + "\n\n"
        "── CATÉGORIES DE PUSH DISPONIBLES ────────\n"
        + cats_text + "\n\n"
        "── CONSIGNES ─────────────────────────────\n"
        "- Le secteur doit refléter l'activité RÉELLE du poste : un poste de "
        "maintenance caténaire relève du « Transport ferroviaire » même si "
        "l'employeur est un énergéticien.\n"
        "- \"mots_cles\" = 5 à 8 mots-clés décrivant les COMPÉTENCES et MÉTIERS "
        "des consultants pertinents à proposer à ce prospect — surtout PAS le "
        "simple intitulé de poste du prospect.\n"
        "- \"category_id\" = l'id EXACT d'une catégorie de la liste, ou null si "
        "aucune ne correspond vraiment.\n\n"
        "Réponds UNIQUEMENT avec cet objet JSON, sans aucun texte autour :\n"
        '{"secteur": "...", "activite": "...", "mots_cles": ["...", "..."], '
        '"category_id": null, "category_nom": "...", '
        '"confiance": "élevée|moyenne|faible", "raison": "..."}'
    )
    raw = _call_ai(prompt, timeout=75)
    data = _extract_json(raw, "object") or {}
    return {
        "secteur": str(data.get("secteur") or "").strip(),
        "activite": str(data.get("activite") or "").strip(),
        "mots_cles": _as_str_list(data.get("mots_cles"))[:10],
        "category_id": data.get("category_id"),
        "category_nom": str(data.get("category_nom") or "").strip(),
        "confiance": str(data.get("confiance") or "").strip().lower(),
        "raison": str(data.get("raison") or "").strip(),
    }


def _resolve_category(ai_cat_id, ai_cat_nom: str, categories: list, det_scored: list):
    """Choisit la catégorie : id IA validé > nom IA > meilleur score déterministe."""
    by_id = {str(c["id"]): c for c in categories}
    if ai_cat_id is not None and str(ai_cat_id) in by_id:
        return by_id[str(ai_cat_id)], "ia"
    if ai_cat_nom:
        nom = ai_cat_nom.strip().lower()
        for c in categories:
            if (c.get("name") or "").strip().lower() == nom:
                return c, "ia"
    if det_scored:
        return det_scored[0][0], "auto"
    return None, None


def _build_prospect_ctx(prospect: dict, company: dict, sector: str, category) -> str:
    """Bloc de contexte texte injecté dans le prompt de classement des candidats."""
    company = company or {}
    lines = []
    if prospect.get("name"):
        lines.append("Prospect : " + prospect["name"])
    if prospect.get("fonction"):
        lines.append("Fonction : " + prospect["fonction"])
    if company.get("groupe"):
        line = "Entreprise : " + company["groupe"]
        if company.get("industry"):
            line += " (" + company["industry"] + ")"
        lines.append(line)
    if sector:
        lines.append("Secteur identifié : " + sector)
    if company.get("pain_points"):
        lines.append("Enjeux : " + str(company["pain_points"])[:200])
    tags = _parse_json_str_list(prospect.get("tags"))
    if tags:
        lines.append("Tags : " + ", ".join(tags[:12]))
    notes = (prospect.get("notes") or "").strip()
    if notes:
        lines.append("Notes : " + (notes[:280] + "…" if len(notes) > 280 else notes))
    if category:
        lines.append("Catégorie de push ciblée : " + (category.get("name") or ""))
    return "── PROSPECT ──────────────────────────────\n" + "\n".join(lines)


def _rerank_explain(top: list, ctx_block: str) -> list:
    """1 appel Ollama : reclasse le top candidats et justifie chacun en 1 phrase."""
    if not top:
        return top
    lines = []
    for i, c in enumerate(top, 1):
        role = c.get("role") or "—"
        years = c.get("years_experience")
        yr = ", " + str(years) + " ans" if isinstance(years, int) and years > 0 else ""
        skills = ", ".join((c.get("skills") or [])[:8])
        matched = ", ".join((c.get("matched_tags") or [])[:6])
        lines.append(str(i) + ". " + (c.get("name") or "?") + " (" + role + yr + ")"
                     + " — compétences: " + (skills or "—")
                     + " — en lien avec: " + (matched or "—"))
    prompt = (
        "Tu es un commercial senior dans une société de conseil en ingénierie.\n"
        "Classe les consultants ci-dessous du PLUS au MOINS pertinent pour CE "
        "prospect, et justifie chacun en UNE phrase concrète et orientée valeur "
        "(techno, expérience secteur, mission passée — jamais de blabla "
        "générique du type « bon profil »).\n\n"
        + ctx_block + "\n\n"
        "── CONSULTANTS À CLASSER ─────────────────\n"
        + "\n".join(lines) + "\n\n"
        "Réponds UNIQUEMENT avec un tableau JSON, du meilleur au moins bon :\n"
        '[{"n": <numéro du consultant>, "raison": "<une phrase>"}]\n'
        "Aucun texte hors du JSON."
    )
    raw = _call_ai(prompt, timeout=45)
    arr = _extract_json(raw, "array")
    if not isinstance(arr, list):
        return top
    reordered, used = [], set()
    for item in arr:
        if not isinstance(item, dict):
            continue
        try:
            n = int(item.get("n"))
        except (TypeError, ValueError):
            continue
        if n < 1 or n > len(top) or n in used:
            continue
        cand = top[n - 1]
        raison = str(item.get("raison") or "").strip()
        if raison:
            cand["ai_explanation"] = raison
        reordered.append(cand)
        used.add(n)
    for i, c in enumerate(top, 1):
        if i not in used:
            reordered.append(c)
    return reordered


# ── Générateur SSE principal ─────────────────────────────────────────
def stream_push_ai_plan(plan_input: dict):
    """Générateur SSE : pipeline IA transparent pour la modale « Pousser »."""
    try:
        yield from _run_plan(plan_input)
    except Exception as e:  # noqa: BLE001 — on veut toujours clore proprement le flux
        logger.exception("Plan IA push : échec global")
        yield _sse({"type": "error", "message": "Analyse IA interrompue : " + str(e)})
        yield _sse({"type": "done"})


def _run_plan(plan_input: dict):
    prospect = plan_input["prospect"]
    company = plan_input.get("company") or {}
    categories = plan_input.get("categories") or []
    candidates = plan_input.get("candidates") or []
    preset_id = plan_input.get("preset_category_id")

    name = prospect.get("name") or "—"
    fonction = prospect.get("fonction") or ""
    company_name = company.get("groupe") or ""

    # ── Étape 1 : profil (instantané) ────────────────────────────────
    profil_bits = [b for b in (name, fonction, company_name) if b]
    yield _sse({"type": "step", "key": "profil", "status": "done",
                "label": "Profil du prospect analysé",
                "detail": " · ".join(profil_bits)})

    config = _load_ai_config()

    # ── Étape 2 : recherche web (Tavily) ─────────────────────────────
    web_block, web_sources = "", []
    has_tavily = bool(config.get("tavily_api_key"))
    if not has_tavily:
        yield _sse({"type": "step", "key": "web", "status": "skipped",
                    "label": "Recherche web non configurée",
                    "detail": "Ajoutez une clé Tavily dans Paramètres › Configuration IA "
                              "pour que l'IA recherche le secteur sur internet."})
    elif not (company_name or fonction):
        yield _sse({"type": "step", "key": "web", "status": "skipped",
                    "label": "Recherche web ignorée",
                    "detail": "Ni entreprise ni fonction renseignée pour ce prospect."})
    else:
        query = " ".join(x for x in (company_name, fonction) if x) + " secteur d'activité métier"
        yield _sse({"type": "step", "key": "web", "status": "running",
                    "label": "Recherche web sur l'entreprise et le poste…",
                    "detail": query})
        try:
            res = _call_tavily_search(query, config, timeout=25)
            answer = (res.get("answer") or "").strip()
            web_sources = [{"title": s.get("title", ""), "url": s.get("url", "")}
                           for s in res.get("sources", [])[:4] if s.get("url")]
            parts = []
            if answer:
                parts.append("Résumé : " + answer)
            for s in res.get("sources", [])[:3]:
                if s.get("content"):
                    parts.append("- " + (s.get("title") or "") + " : " + s["content"][:300])
            web_block = "\n".join(parts)
            yield _sse({"type": "step", "key": "web", "status": "done",
                        "label": str(len(web_sources)) + " source(s) web analysée(s)",
                        "detail": answer[:240] or "Informations récupérées sur internet.",
                        "sources": web_sources})
        except Exception as e:  # noqa: BLE001
            logger.info("Plan IA push : Tavily indisponible (%s)", e)
            yield _sse({"type": "step", "key": "web", "status": "skipped",
                        "label": "Recherche web indisponible",
                        "detail": str(e)[:160]})

    # ── Étapes 3 + 4 : secteur + catégorie (1 appel Ollama) ──────────
    yield _sse({"type": "step", "key": "secteur", "status": "running",
                "label": "Analyse du secteur d'activité par l'IA…"})
    yield _sse({"type": "step", "key": "categorie", "status": "running",
                "label": "Choix de la catégorie de push…"})

    ai, ai_failed = {}, False
    try:
        ai = _detect_sector_category(prospect, company, categories, web_block)
    except Exception as e:  # noqa: BLE001
        ai_failed = True
        logger.info("Plan IA push : détection secteur échouée (%s)", e)

    sector = ai.get("secteur", "")
    ai_keywords = ai.get("mots_cles", [])

    if ai_failed:
        yield _sse({"type": "step", "key": "secteur", "status": "skipped",
                    "label": "IA locale indisponible",
                    "detail": "Le secteur n'a pas pu être déduit — classement limité "
                              "aux données du CRM."})
    elif sector:
        detail = ai.get("activite", "")
        if ai_keywords:
            detail = (detail + " " if detail else "") \
                + "Profils ciblés : " + ", ".join(ai_keywords[:6]) + "."
        yield _sse({"type": "step", "key": "secteur", "status": "done",
                    "label": "Secteur identifié : " + sector,
                    "detail": detail.strip()})
    else:
        yield _sse({"type": "step", "key": "secteur", "status": "warn",
                    "label": "Secteur non déterminé",
                    "detail": "L'IA n'a pas pu identifier de secteur précis."})

    # Résolution de la catégorie.
    base_kw = _build_keyword_sources(prospect, company, ai_keywords, None)
    det_cat_scored = _score_categories(categories, set(base_kw["search_tags"]))

    chosen_cat, cat_origin = None, None
    if preset_id is not None:
        for c in categories:
            if c["id"] == preset_id:
                chosen_cat, cat_origin = c, "preset"
                break
    if chosen_cat is None:
        chosen_cat, cat_origin = _resolve_category(
            ai.get("category_id"), ai.get("category_nom"), categories, det_cat_scored)

    if chosen_cat is not None:
        cat_id = chosen_cat["id"]
        cat_name = chosen_cat.get("name", "")
        if cat_origin == "preset":
            detail = "Catégorie déjà sélectionnée dans la modale."
            ai_id = ai.get("category_id")
            if ai_id is not None and str(ai_id) != str(cat_id):
                for c in categories:
                    if str(c["id"]) == str(ai_id):
                        detail += " (l'IA aurait plutôt suggéré « " + (c.get("name") or "") + " »)"
                        break
        elif cat_origin == "ia":
            detail = ai.get("raison") or "Catégorie la plus cohérente avec le secteur détecté."
        else:
            detail = "Meilleure correspondance par mots-clés (IA secteur indisponible)."
        yield _sse({"type": "step", "key": "categorie", "status": "done",
                    "label": "Catégorie de push : " + cat_name, "detail": detail,
                    "category_id": cat_id, "category_name": cat_name,
                    "category_origin": cat_origin, "confidence": ai.get("confiance", "")})
    else:
        if categories:
            detail = "Aucune catégorie ne correspond"
            detail += (" au secteur « " + sector + " » — pensez à en créer une adaptée."
                       if sector else " — choisissez-en une manuellement.")
        else:
            detail = "Aucune catégorie de push configurée. Créez-en depuis la page Push."
        yield _sse({"type": "step", "key": "categorie", "status": "warn",
                    "label": "Catégorie non déterminée", "detail": detail,
                    "category_id": None})

    # ── Étape 5 : candidats ──────────────────────────────────────────
    if chosen_cat and chosen_cat.get("no_candidates"):
        yield _sse({"type": "step", "key": "candidats", "status": "skipped",
                    "label": "Catégorie « sans consultant »",
                    "detail": "Cette catégorie n'attache aucun candidat — le push "
                              "utilisera uniquement le template email."})
        yield _sse({"type": "result", "sector": sector,
                    "category": {"id": chosen_cat["id"], "name": chosen_cat.get("name", ""),
                                 "no_candidates": True},
                    "category_origin": cat_origin, "candidates": [], "keywords": [],
                    "web_sources": web_sources})
        yield _sse({"type": "done"})
        return

    yield _sse({"type": "step", "key": "candidats", "status": "running",
                "label": "Recherche et classement des consultants…"})

    kw = _build_keyword_sources(prospect, company, ai_keywords, chosen_cat)
    search_tags = kw["search_tags"]
    scored = _score_candidates(candidates, search_tags, kw["notes_set"],
                               kw["company_sectors"], kw["company_city"],
                               kw["pertinence_cap"])
    top = scored[:8]

    if top:
        try:
            top = _rerank_explain(top, _build_prospect_ctx(prospect, company, sector, chosen_cat))
        except Exception as e:  # noqa: BLE001
            logger.info("Plan IA push : reclassement/explications ignorés (%s)", e)

    if top:
        n_explained = sum(1 for c in top if c.get("ai_explanation"))
        detail = "Classés sur : " + (", ".join(search_tags[:6]) if search_tags else "—")
        if n_explained:
            detail += " · " + str(n_explained) + " justification(s) IA"
        yield _sse({"type": "step", "key": "candidats", "status": "done",
                    "label": str(len(top)) + " consultant(s) pertinent(s) trouvé(s)",
                    "detail": detail})
    else:
        detail = ("Peu de critères exploitables — enrichissez la fiche prospect "
                  "(fonction, tags, notes)." if len(search_tags) < 3 else
                  "Aucun consultant du vivier ne couvre ces compétences.")
        yield _sse({"type": "step", "key": "candidats", "status": "warn",
                    "label": "Aucun consultant pertinent", "detail": detail})

    yield _sse({"type": "result", "sector": sector,
                "category": ({"id": chosen_cat["id"], "name": chosen_cat.get("name", ""),
                              "no_candidates": False} if chosen_cat else None),
                "category_origin": cat_origin, "candidates": top,
                "keywords": search_tags[:12], "web_sources": web_sources})
    yield _sse({"type": "done"})
