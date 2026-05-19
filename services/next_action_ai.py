"""ProspUp — Service Next Action IA (Phase 2 productivité v32.x).

Génère une suggestion d'action prochaine pour chaque prospect actif via
l'IA locale (Ollama). Suggestion passive : badge affiché sur la fiche
prospect et dans /v30/focus, l'utilisateur décide quoi en faire.

Schéma de la suggestion (stockée dans prospects.next_action_ai en JSON) :
    {
      "action":      str  (1 ligne max, recommandation concrète),
      "action_type": str  (email | call | linkedin | rdv | wait | other),
      "when":        str  (date ISO YYYY-MM-DD ou null),
      "why":         str  (1-2 phrases : justification/contexte),
      "confidence":  int  (0-100),
      "generated_at": str (ISO timestamp UTC),
      "model":       str  (nom du modèle Ollama utilisé)
    }
"""
from __future__ import annotations

import datetime
import json
import logging
from typing import Any

from utils.ai_helpers import _call_ai, _load_ai_config
from utils.common import _now_iso, _today_iso
from utils.db import _conn

logger = logging.getLogger("prospup")

# Durée maximale avant de rafraîchir une suggestion en cache.
SUGGESTION_TTL_DAYS = 7

# Statuts ignorés (le prospect n'a plus besoin d'une suggestion).
IGNORED_STATUTS = {"Pas intéressé"}

VALID_ACTION_TYPES = {"email", "call", "linkedin", "rdv", "wait", "other"}


def _parse_cache(raw: str | None) -> dict | None:
    """Parse la suggestion stockée en JSON. Retourne None si invalide."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and data.get("action"):
            return data
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def is_suggestion_stale(suggestion: dict | None) -> bool:
    """True si la suggestion doit être régénérée (absente ou trop vieille)."""
    if not suggestion:
        return True
    generated_at = suggestion.get("generated_at") or ""
    if not generated_at:
        return True
    try:
        gen = datetime.datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        age = datetime.datetime.now(datetime.timezone.utc) - gen
        return age.days >= SUGGESTION_TTL_DAYS
    except (ValueError, TypeError):
        return True


def _gather_context(conn, prospect_id: int, uid: int) -> dict:
    """Récupère le contexte autour d'un prospect pour alimenter l'IA."""
    p_row = conn.execute(
        """SELECT p.id, p.name, p.fonction, p.email, p.telephone, p.linkedin,
                  p.statut, p.lastContact, p.nextFollowUp, p.nextAction,
                  p.rdvDate, p.rdv_outcome, p.rdv_reviewed_at, p.notes, p.tags,
                  c.groupe AS company_groupe, c.site AS company_site,
                  c.industry AS company_industry, c.size AS company_size
           FROM prospects p
           LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = ?
           WHERE p.id = ? AND p.owner_id = ?
             AND (p.deleted_at IS NULL OR p.deleted_at = '')
             AND (p.is_archived IS NULL OR p.is_archived = 0)""",
        (uid, prospect_id, uid),
    ).fetchone()
    if not p_row:
        return {}
    prospect = dict(p_row)

    pushes = conn.execute(
        """SELECT channel, sentAt, opened_at, replied_at, subject
           FROM push_logs
           WHERE prospect_id = ?
           ORDER BY sentAt DESC LIMIT 5""",
        (prospect_id,),
    ).fetchall()

    events = conn.execute(
        """SELECT type, title, date FROM prospect_events
           WHERE prospect_id = ?
           ORDER BY date DESC LIMIT 5""",
        (prospect_id,),
    ).fetchall()

    return {
        "prospect": prospect,
        "push_logs": [dict(r) for r in pushes],
        "events": [dict(r) for r in events],
    }


def _build_prompt(ctx: dict, today: str) -> str:
    p = ctx.get("prospect", {})
    pushes = ctx.get("push_logs", [])
    events = ctx.get("events", [])

    name = p.get("name") or "?"
    fonction = p.get("fonction") or "—"
    company = p.get("company_groupe") or p.get("company_site") or "—"
    industry = p.get("company_industry") or ""
    statut = p.get("statut") or "—"
    last_contact = (p.get("lastContact") or "")[:10] or "jamais"
    next_followup = (p.get("nextFollowUp") or "")[:10] or "aucune"
    next_action_txt = (p.get("nextAction") or "").strip()
    rdv_date = (p.get("rdvDate") or "")[:10]
    rdv_outcome = p.get("rdv_outcome") or ""
    notes = (p.get("notes") or "").strip()[:500]
    tags = (p.get("tags") or "").strip()

    push_lines = []
    for pl in pushes:
        sent = (pl.get("sentAt") or "")[:10]
        ch = pl.get("channel") or "?"
        status_bits = []
        if pl.get("opened_at"):
            status_bits.append("ouvert")
        if pl.get("replied_at"):
            status_bits.append("RÉPONDU")
        sm = (", " + ", ".join(status_bits)) if status_bits else ""
        push_lines.append(f"- {sent} {ch}{sm}")
    push_block = "\n".join(push_lines) if push_lines else "(aucun push enregistré)"

    event_lines = [
        f"- {(e.get('date') or '')[:10]} {e.get('type') or '?'} : {(e.get('title') or '')[:60]}"
        for e in events
    ]
    event_block = "\n".join(event_lines) if event_lines else "(aucun événement)"

    rdv_block = ""
    if rdv_date:
        rdv_block = f"- RDV : {rdv_date}"
        if rdv_outcome:
            rdv_block += f" (statué : {rdv_outcome})"
    else:
        rdv_block = "- Aucun RDV planifié"

    return (
        "Tu es un coach commercial B2B. Pour ce prospect, recommande UNE seule "
        "action concrète à effectuer, en français.\n\n"
        f"Aujourd'hui : {today}\n\n"
        "Prospect :\n"
        f"- Nom : {name}\n"
        f"- Fonction : {fonction}\n"
        f"- Entreprise : {company}{f' ({industry})' if industry else ''}\n"
        f"- Statut actuel : {statut}\n"
        f"- Tags : {tags or '(aucun)'}\n"
        f"- Dernier contact : {last_contact}\n"
        f"- Prochaine relance prévue : {next_followup}\n"
        f"- Note d'action manuelle : {next_action_txt or '(aucune)'}\n"
        f"{rdv_block}\n\n"
        "Historique push (5 derniers) :\n"
        f"{push_block}\n\n"
        "Événements récents :\n"
        f"{event_block}\n\n"
        f"Notes : {notes or '(aucune)'}\n\n"
        "Réponds UNIQUEMENT en JSON strict (sans markdown, sans préfixe), "
        "avec ces champs exacts :\n"
        "{\n"
        '  "action": "Action précise en 1 phrase (max 100 caractères)",\n'
        '  "action_type": "email" | "call" | "linkedin" | "rdv" | "wait" | "other",\n'
        '  "when": "YYYY-MM-DD ou null si pas de date claire",\n'
        '  "why": "1 ou 2 phrases courtes justifiant le timing/canal",\n'
        '  "confidence": entier 0-100\n'
        "}\n\n"
        "Règles :\n"
        "- Si le prospect a répondu récemment : action = répondre par email ou planifier RDV\n"
        "- Si push email non-ouvert >5j : action = relance par téléphone (call)\n"
        "- Si push email ouvert mais sans réponse : action = relance LinkedIn ou email court\n"
        "- Si RDV à venir (rdvDate future) : action = préparer le RDV (wait)\n"
        "- Si statut À rappeler ou Messagerie : action = appel téléphonique (call)\n"
        "- Si aucun contact depuis 30j : action = email de réveil\n"
        "- Privilégie un canal différent du dernier essayé\n"
        "- Sois concret : pas de 'envisager', 'éventuellement', 'pourquoi pas'\n"
    )


def _validate_and_normalize(raw_json: dict, model_name: str) -> dict:
    action = (raw_json.get("action") or "").strip()
    if not action:
        raise ValueError("Champ 'action' manquant")
    if len(action) > 200:
        action = action[:197] + "..."

    action_type = (raw_json.get("action_type") or "other").strip().lower()
    if action_type not in VALID_ACTION_TYPES:
        action_type = "other"

    when_raw = raw_json.get("when")
    when_iso = None
    if when_raw and str(when_raw).strip().lower() not in ("null", "none", ""):
        try:
            d = datetime.date.fromisoformat(str(when_raw)[:10])
            when_iso = d.isoformat()
        except (ValueError, TypeError):
            when_iso = None

    why = (raw_json.get("why") or "").strip()[:300]
    try:
        confidence = int(raw_json.get("confidence", 50))
    except (ValueError, TypeError):
        confidence = 50
    confidence = max(0, min(100, confidence))

    return {
        "action": action,
        "action_type": action_type,
        "when": when_iso,
        "why": why,
        "confidence": confidence,
        "generated_at": _now_iso(),
        "model": model_name,
    }


def _extract_json(raw: str) -> dict | None:
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return None


def generate_for_prospect(prospect_id: int, uid: int) -> dict:
    """Génère et persiste une suggestion pour un prospect.

    Retourne dict avec keys {ok, suggestion?, error?}.
    """
    today = _today_iso()
    config = _load_ai_config()
    model_name = config.get("ollama_model") or "ollama"

    with _conn() as conn:
        ctx = _gather_context(conn, prospect_id, uid)
        if not ctx.get("prospect"):
            return {"ok": False, "error": "Prospect introuvable"}

        statut = (ctx["prospect"].get("statut") or "").strip()
        if statut in IGNORED_STATUTS:
            return {"ok": False, "error": f"Statut '{statut}' — pas de suggestion"}

        prompt = _build_prompt(ctx, today)

    try:
        raw = _call_ai(prompt, timeout=60)
    except Exception as e:
        logger.warning("[next_action_ai] _call_ai failed for prospect=%s: %s", prospect_id, e)
        return {"ok": False, "error": "IA indisponible"}

    parsed = _extract_json(raw)
    if not parsed:
        logger.warning("[next_action_ai] JSON parse failed for prospect=%s, raw=%r", prospect_id, raw[:200])
        return {"ok": False, "error": "Réponse IA non parsable"}

    try:
        suggestion = _validate_and_normalize(parsed, model_name)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    now = _now_iso()
    with _conn() as conn:
        conn.execute(
            "UPDATE prospects SET next_action_ai=?, next_action_ai_at=? WHERE id=? AND owner_id=?",
            (json.dumps(suggestion, ensure_ascii=False), now, prospect_id, uid),
        )
        conn.commit()

    return {"ok": True, "suggestion": suggestion}


def get_cached(prospect_id: int, uid: int) -> dict | None:
    """Lit la suggestion en cache pour un prospect (sans regen)."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT next_action_ai, next_action_ai_at FROM prospects "
            "WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at = '')",
            (prospect_id, uid),
        ).fetchone()
    if not row:
        return None
    return _parse_cache(row["next_action_ai"])


def list_today_suggestions(uid: int, limit: int = 10) -> list[dict]:
    """Retourne les top suggestions actives (today's recommended actions).

    Tri : `when` ≤ today d'abord, puis par confidence DESC. Exclut les
    suggestions périmées (TTL) et les statuts ignorés.
    """
    today = _today_iso()
    items: list[dict] = []
    with _conn() as conn:
        rows = conn.execute(
            """SELECT p.id, p.name, p.fonction, p.statut,
                      p.next_action_ai, p.next_action_ai_at,
                      c.groupe AS company_groupe, c.site AS company_site
               FROM prospects p
               LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = ?
               WHERE p.owner_id = ?
                 AND (p.deleted_at IS NULL OR p.deleted_at = '')
                 AND (p.is_archived IS NULL OR p.is_archived = 0)
                 AND p.next_action_ai IS NOT NULL
                 AND p.next_action_ai != ''""",
            (uid, uid),
        ).fetchall()

    for r in rows:
        d = dict(r)
        suggestion = _parse_cache(d.get("next_action_ai"))
        if not suggestion or is_suggestion_stale(suggestion):
            continue
        if (d.get("statut") or "") in IGNORED_STATUTS:
            continue
        items.append({
            "id": d["id"],
            "name": d.get("name"),
            "fonction": d.get("fonction") or "",
            "statut": d.get("statut") or "",
            "company_name": d.get("company_groupe") or d.get("company_site") or "",
            "suggestion": suggestion,
        })

    def _sort_key(it):
        sug = it["suggestion"]
        when = sug.get("when") or ""
        is_due = 0 if when and when <= today else 1
        conf = -int(sug.get("confidence") or 0)
        return (is_due, when or "9999", conf)

    items.sort(key=_sort_key)
    return items[:limit]


def list_active_prospect_ids(uid: int) -> list[int]:
    """IDs des prospects pour lesquels une suggestion serait pertinente.

    Critères : non archivé, non supprimé, statut hors IGNORED_STATUTS.
    Au moins une activité dans les 60 derniers jours (lastContact, push,
    event) — sinon le prospect est trop vieux/inactif.
    """
    cutoff = (datetime.date.today() - datetime.timedelta(days=60)).isoformat()
    statuts_list = sorted(IGNORED_STATUTS)
    statuts_filter_in = ",".join("?" * len(statuts_list))
    params: list = [uid] + statuts_list + [cutoff, cutoff, cutoff]
    with _conn() as conn:
        rows = conn.execute(
            f"""SELECT DISTINCT p.id FROM prospects p
               WHERE p.owner_id = ?
                 AND (p.deleted_at IS NULL OR p.deleted_at = '')
                 AND (p.is_archived IS NULL OR p.is_archived = 0)
                 AND (p.statut IS NULL OR p.statut NOT IN ({statuts_filter_in}))
                 AND (
                       (p.lastContact IS NOT NULL AND p.lastContact >= ?)
                    OR EXISTS (SELECT 1 FROM push_logs pl
                               WHERE pl.prospect_id = p.id AND pl.sentAt >= ?)
                    OR EXISTS (SELECT 1 FROM prospect_events pe
                               WHERE pe.prospect_id = p.id AND pe.date >= ?)
                 )""",
            params,
        ).fetchall()
    return [r["id"] for r in rows]
