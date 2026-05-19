"""ProspUp — Blueprint RDV Review (workflow no-show + IA relance).

Phase 1 productivité (v32.x) : permettre de statuer les RDV passés
non revus (tenu / no-show / annulé / reprogrammé), avec génération
IA d'un email de relance pour les cas no-show / annulé.

Endpoints :
- GET  /api/rdv/pending-review        — liste des RDV passés non revus
- POST /api/rdv/<id>/review           — applique l'outcome
- GET  /api/rdv/no-show-stats         — stats no-show 30j (KPI Phase 3)
"""
from __future__ import annotations

import datetime
import json
from typing import Any

from flask import Blueprint, jsonify, request

from utils.ai_helpers import _call_ai
from utils.auth import _prospect_owned, _uid
from utils.common import _now_iso, _today_iso
from utils.db import _conn

rdv_review_bp = Blueprint("rdv_review", __name__)

RDV_OUTCOMES = {"tenu", "no-show", "annule", "reprogramme"}

# Nb jours ouvrés pour la prochaine relance selon l'outcome.
RELANCE_BIZ_DAYS = {
    "no-show": 3,
    "annule": 7,
    "reprogramme": 0,
    "tenu": None,
}


def _add_business_days(start_date: datetime.date, days: int) -> datetime.date:
    """Ajoute N jours ouvrés (saute samedi/dimanche)."""
    current = start_date
    added = 0
    while added < days:
        current = current + datetime.timedelta(days=1)
        if current.weekday() < 5:
            added += 1
    return current


def _suggest_creneaux(today_d: datetime.date) -> list[str]:
    """Trois créneaux à J+5 / J+8 / J+12 ouvrés, à 10:00."""
    return [
        _add_business_days(today_d, n).isoformat() + "T10:00"
        for n in (5, 8, 12)
    ]


def _fallback_relance_template(prospect: dict, outcome: str, creneaux: list[str]) -> dict:
    """Template de secours si l'IA est indisponible."""
    name = prospect.get("name") or ""
    first_name = name.split()[0] if name else ""
    rdv_date = (prospect.get("rdvDate") or "")[:10]

    intro = {
        "no-show": "Nous n'avons malheureusement pas pu nous échanger comme prévu",
        "annule": "Suite à l'annulation de notre rendez-vous",
    }.get(outcome, "Suite à notre échange")

    creneaux_lines = "\n".join(f"  - {c.replace('T', ' à ')}" for c in creneaux)

    body = (
        f"Bonjour {first_name},\n\n"
        f"{intro} du {rdv_date}, je me permets de revenir vers vous pour "
        f"proposer un nouveau créneau.\n\n"
        f"Voici trois disponibilités sur les jours à venir :\n{creneaux_lines}\n\n"
        f"Dites-moi celle qui vous convient le mieux, ou indiquez-moi un autre moment.\n\n"
        f"Bien cordialement,"
    )
    return {
        "subject": "Reprogrammons notre échange",
        "body": body,
        "success": False,
    }


def _generate_relance_ai(prospect: dict, outcome: str, creneaux: list[str]) -> dict:
    """Génère un email de relance via IA. Retombe sur template si l'IA échoue."""
    name = prospect.get("name") or "votre interlocuteur"
    company = prospect.get("company_name") or ""
    fonction = prospect.get("fonction") or ""
    rdv_date = (prospect.get("rdvDate") or "")[:10]
    first_name = name.split()[0] if name else ""

    context_outcome = {
        "no-show": "n'a pas honoré le rendez-vous prévu (no-show)",
        "annule": "a annulé le rendez-vous prévu",
    }.get(outcome, "")

    creneaux_str = "\n".join(f"- {c.replace('T', ' à ')}" for c in creneaux)

    prompt = (
        "Tu es un commercial B2B professionnel et bienveillant. Rédige un "
        "email court (max 120 mots) de relance après un rendez-vous manqué.\n\n"
        "Contexte :\n"
        f"- Prospect : {name} ({fonction}) chez {company}\n"
        f"- RDV initial prévu le {rdv_date}\n"
        f"- Situation : le prospect {context_outcome}\n\n"
        "Objectif : reproposer un nouveau créneau sans culpabiliser, en "
        "restant cordial et professionnel.\n\n"
        f"Créneaux à proposer :\n{creneaux_str}\n\n"
        'Format de réponse — JSON strict : {"subject": "...", "body": "..."}\n\n'
        "Le body doit :\n"
        f"- Commencer par \"Bonjour {first_name},\"\n"
        "- Comprendre 2 paragraphes courts\n"
        "- Inclure les 3 créneaux proposés en liste\n"
        "- Se terminer par \"Bien cordialement,\"\n"
        "- Ne PAS contenir d'emojis ni de formules grandiloquentes"
    )

    try:
        raw = _call_ai(prompt, timeout=60)
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(raw[start:end + 1])
            subj = (data.get("subject") or "").strip()
            body = (data.get("body") or "").strip()
            if body:
                return {
                    "subject": subj or "Reprogrammons notre échange",
                    "body": body,
                    "success": True,
                }
    except Exception:
        pass

    return _fallback_relance_template(prospect, outcome, creneaux)


@rdv_review_bp.get("/api/rdv/pending-review")
def api_rdv_pending_review():
    """RDV passés non statués : statut=Rendez-vous, rdvDate<today, non revus."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    today = _today_iso()
    with _conn() as conn:
        rows = conn.execute(
            """SELECT p.id, p.name, p.fonction, p.email, p.telephone, p.linkedin,
                      p.statut, p.rdvDate, p.lastContact, p.nextFollowUp,
                      c.groupe AS company_groupe, c.site AS company_site
               FROM prospects p
               LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = ?
               WHERE p.owner_id = ?
                 AND (p.deleted_at IS NULL OR p.deleted_at = '')
                 AND (p.is_archived IS NULL OR p.is_archived = 0)
                 AND p.statut = 'Rendez-vous'
                 AND p.rdvDate IS NOT NULL AND p.rdvDate != ''
                 AND substr(p.rdvDate, 1, 10) < ?
                 AND (p.rdv_reviewed_at IS NULL OR p.rdv_reviewed_at = '')
               ORDER BY p.rdvDate DESC""",
            (uid, uid, today),
        ).fetchall()

    items = []
    for r in rows:
        d = dict(r)
        items.append({
            "id": d["id"],
            "name": d["name"],
            "fonction": d.get("fonction") or "",
            "email": d.get("email") or "",
            "telephone": d.get("telephone") or "",
            "linkedin": d.get("linkedin") or "",
            "rdvDate": d.get("rdvDate") or "",
            "statut": d.get("statut") or "",
            "company_name": d.get("company_groupe") or d.get("company_site") or "",
        })

    return jsonify(ok=True, items=items, count=len(items))


@rdv_review_bp.post("/api/rdv/<int:prospect_id>/review")
def api_rdv_review(prospect_id: int):
    """Applique un outcome à un RDV passé.

    Body JSON : {"outcome": "tenu" | "no-show" | "annule" | "reprogramme"}

    Effets :
    - tenu        : marque reviewed, garde statut "Rendez-vous"
                    (l'utilisateur lance ensuite l'IA Après RDV)
    - no-show     : reviewed + statut "À rappeler" + nextFollowUp = +3j ouvré
                    + retourne ai_relance + 3 créneaux suggérés
    - annule      : reviewed + statut "À rappeler" + nextFollowUp = +7j ouvré
                    + retourne ai_relance + 3 créneaux suggérés
    - reprogramme : reviewed + garde "Rendez-vous" + efface rdvDate
                    (l'utilisateur choisit un nouveau créneau)
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    if not _prospect_owned(prospect_id):
        return jsonify(ok=False, error="Prospect introuvable"), 404

    payload = request.get_json(force=True, silent=True) or {}
    outcome = (payload.get("outcome") or "").strip().lower()
    if outcome not in RDV_OUTCOMES:
        return jsonify(
            ok=False,
            error=f"outcome invalide (attendu : {sorted(RDV_OUTCOMES)})",
        ), 400

    now = _now_iso()
    today_d = datetime.date.today()

    with _conn() as conn:
        row = conn.execute(
            """SELECT p.id, p.name, p.fonction, p.email, p.telephone, p.statut,
                      p.rdvDate, p.nextFollowUp,
                      c.groupe AS company_groupe, c.site AS company_site
               FROM prospects p
               LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = ?
               WHERE p.id = ? AND p.owner_id = ?""",
            (uid, prospect_id, uid),
        ).fetchone()
        if not row:
            return jsonify(ok=False, error="Prospect introuvable"), 404

        prospect = dict(row)
        prospect["company_name"] = (
            prospect.get("company_groupe") or prospect.get("company_site") or ""
        )

        if outcome == "tenu":
            conn.execute(
                "UPDATE prospects SET rdv_reviewed_at=?, rdv_outcome=? "
                "WHERE id=? AND owner_id=?",
                (now, outcome, prospect_id, uid),
            )
        elif outcome == "no-show":
            new_follow = _add_business_days(today_d, RELANCE_BIZ_DAYS["no-show"]).isoformat()
            conn.execute(
                "UPDATE prospects SET rdv_reviewed_at=?, rdv_outcome=?, "
                "statut=?, nextFollowUp=? WHERE id=? AND owner_id=?",
                (now, outcome, "À rappeler", new_follow, prospect_id, uid),
            )
        elif outcome == "annule":
            new_follow = _add_business_days(today_d, RELANCE_BIZ_DAYS["annule"]).isoformat()
            conn.execute(
                "UPDATE prospects SET rdv_reviewed_at=?, rdv_outcome=?, "
                "statut=?, nextFollowUp=? WHERE id=? AND owner_id=?",
                (now, outcome, "À rappeler", new_follow, prospect_id, uid),
            )
        elif outcome == "reprogramme":
            conn.execute(
                "UPDATE prospects SET rdv_reviewed_at=?, rdv_outcome=?, "
                "rdvDate=NULL WHERE id=? AND owner_id=?",
                (now, outcome, prospect_id, uid),
            )

        try:
            conn.execute(
                "INSERT OR IGNORE INTO prospect_events "
                "(prospect_id, date, type, title, content, meta, createdAt) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    prospect_id,
                    today_d.isoformat(),
                    f"rdv_{outcome}",
                    f"RDV statué : {outcome}",
                    "",
                    json.dumps(
                        {"rdvDate": prospect.get("rdvDate"), "outcome": outcome},
                        ensure_ascii=False,
                    ),
                    now,
                ),
            )
        except Exception:
            pass

    result: dict[str, Any] = {"ok": True, "outcome": outcome}
    if outcome in ("no-show", "annule"):
        creneaux = _suggest_creneaux(today_d)
        result["creneaux"] = creneaux
        result["ai_relance"] = _generate_relance_ai(prospect, outcome, creneaux)
    return jsonify(result)


@rdv_review_bp.get("/api/rdv/no-show-stats")
def api_rdv_no_show_stats():
    """Stats RDV statués sur 30j (count par outcome + distribution jour semaine)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    today_d = datetime.date.today()
    start_d = today_d - datetime.timedelta(days=30)

    with _conn() as conn:
        rows = conn.execute(
            """SELECT p.rdv_outcome, p.rdvDate
               FROM prospects p
               WHERE p.owner_id = ?
                 AND p.rdv_outcome IS NOT NULL AND p.rdv_outcome != ''
                 AND p.rdv_reviewed_at >= ?
                 AND (p.deleted_at IS NULL OR p.deleted_at = '')""",
            (uid, start_d.isoformat()),
        ).fetchall()

    by_outcome = {"tenu": 0, "no-show": 0, "annule": 0, "reprogramme": 0}
    by_dow = {"no-show": [0] * 7, "annule": [0] * 7}

    for r in rows:
        outcome = (r["rdv_outcome"] or "").strip().lower()
        if outcome in by_outcome:
            by_outcome[outcome] += 1
        if outcome in by_dow:
            rdate = (r["rdvDate"] or "")[:10]
            try:
                d = datetime.date.fromisoformat(rdate)
                by_dow[outcome][d.weekday()] += 1
            except Exception:
                pass

    total = sum(by_outcome.values())
    no_show_rate = round(100 * by_outcome["no-show"] / total, 1) if total > 0 else 0.0

    return jsonify(
        ok=True,
        period_days=30,
        total=total,
        by_outcome=by_outcome,
        by_day_of_week=by_dow,
        no_show_rate_pct=no_show_rate,
    )
