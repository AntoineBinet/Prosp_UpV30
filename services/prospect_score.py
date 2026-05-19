"""ProspUp — Service Score Prospect (Phase 3 productivité v32.x).

Calcul déterministe d'un score 0-100 par prospect, sans IA (pas d'appel
Ollama). Trois composantes pondérées :

- **Engagement push (35%)** : opened×1 + clicked×2 + replied×4 sur 90j,
  saturé à 10 → 1.0. Mesure la réactivité directe du prospect.
- **Recency (35%)** : ancienneté du dernier contact (lastContact).
  Décroissance par paliers (1.0 / 0.5 / 0.2 / 0.05).
- **Volume / récurrence (30%)** : nb total d'actions sur 180j (push +
  calls + events), normalisé log10 sur base 20.

Pas de cache : le calcul est rapide (~50ms pour 500 prospects).
"""
from __future__ import annotations

import datetime
import math
from typing import Any

from utils.db import _conn

ENGAGEMENT_WEIGHT = 0.35
RECENCY_WEIGHT = 0.35
VOLUME_WEIGHT = 0.30

ENGAGEMENT_WINDOW_DAYS = 90
VOLUME_WINDOW_DAYS = 180
VOLUME_CAP = 20  # 20 actions/180j = score volume max


def _recency_score(last_contact: str | None, today: datetime.date) -> float:
    """1.0 à 0.0 selon l'ancienneté du dernier contact."""
    if not last_contact:
        return 0.0
    raw = str(last_contact).strip()[:10]
    if not raw:
        return 0.0
    try:
        d = datetime.date.fromisoformat(raw)
    except (ValueError, TypeError):
        return 0.0
    days = (today - d).days
    if days < 0:
        return 1.0
    if days <= 7:
        return 1.0
    if days <= 30:
        return 0.5
    if days <= 90:
        return 0.2
    return 0.05


def _engagement_score(pushes: list[dict], cutoff: str) -> float:
    """Engagement basé sur opened/clicked/replied sur la fenêtre."""
    points = 0
    for pl in pushes:
        sent_at = (pl.get("sentAt") or "")[:10]
        if sent_at < cutoff:
            continue
        if pl.get("opened_at"):
            points += 1
        if pl.get("clicked_at"):
            points += 2
        if pl.get("replied_at"):
            points += 4
    return min(1.0, points / 10.0)


def _volume_score(action_count: int) -> float:
    """Score volume normalisé log10."""
    if action_count <= 0:
        return 0.0
    return min(1.0, math.log10(1 + action_count) / math.log10(1 + VOLUME_CAP))


def compute_for_user(uid: int, prospect_ids: list[int] | None = None) -> dict[int, dict]:
    """Calcule les scores pour tous (ou un sous-ensemble) de prospects d'un user.

    Retourne un dict {prospect_id: {score, engagement, recency, volume, components}}.
    """
    today = datetime.date.today()
    eng_cutoff = (today - datetime.timedelta(days=ENGAGEMENT_WINDOW_DAYS)).isoformat()
    vol_cutoff = (today - datetime.timedelta(days=VOLUME_WINDOW_DAYS)).isoformat()

    with _conn() as conn:
        if prospect_ids:
            ph = ",".join("?" * len(prospect_ids))
            rows = conn.execute(
                f"""SELECT id, lastContact FROM prospects
                   WHERE owner_id=? AND id IN ({ph})
                     AND (deleted_at IS NULL OR deleted_at='')
                     AND (is_archived IS NULL OR is_archived=0)""",
                [uid] + list(prospect_ids),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT id, lastContact FROM prospects
                   WHERE owner_id=?
                     AND (deleted_at IS NULL OR deleted_at='')
                     AND (is_archived IS NULL OR is_archived=0)""",
                (uid,),
            ).fetchall()

        pids = [r["id"] for r in rows]
        prospects = {r["id"]: dict(r) for r in rows}
        if not pids:
            return {}

        ph_all = ",".join("?" * len(pids))
        pushes_rows = conn.execute(
            f"""SELECT prospect_id, channel, sentAt, opened_at, clicked_at, replied_at
               FROM push_logs
               WHERE prospect_id IN ({ph_all}) AND sentAt >= ?""",
            pids + [eng_cutoff],
        ).fetchall()

        push_counts = conn.execute(
            f"""SELECT prospect_id, COUNT(*) AS n FROM push_logs
               WHERE prospect_id IN ({ph_all}) AND sentAt >= ?
               GROUP BY prospect_id""",
            pids + [vol_cutoff],
        ).fetchall()
        push_by_pid = {r["prospect_id"]: int(r["n"]) for r in push_counts}

        call_counts: dict[int, int] = {}
        try:
            call_rows = conn.execute(
                f"""SELECT prospect_id, COUNT(*) AS n FROM call_logs
                   WHERE prospect_id IN ({ph_all}) AND date >= ?
                   GROUP BY prospect_id""",
                pids + [vol_cutoff],
            ).fetchall()
            call_by_pid = {r["prospect_id"]: int(r["n"]) for r in call_rows}
            call_counts = call_by_pid
        except Exception:
            call_counts = {}

        event_counts = conn.execute(
            f"""SELECT prospect_id, COUNT(*) AS n FROM prospect_events
               WHERE prospect_id IN ({ph_all}) AND date >= ?
               GROUP BY prospect_id""",
            pids + [vol_cutoff],
        ).fetchall()
        event_by_pid = {r["prospect_id"]: int(r["n"]) for r in event_counts}

    pushes_by_pid: dict[int, list[dict]] = {}
    for r in pushes_rows:
        d = dict(r)
        pushes_by_pid.setdefault(d["prospect_id"], []).append(d)

    results: dict[int, dict] = {}
    for pid in pids:
        eng = _engagement_score(pushes_by_pid.get(pid, []), eng_cutoff)
        rec = _recency_score(prospects[pid].get("lastContact"), today)
        actions = (
            push_by_pid.get(pid, 0)
            + call_counts.get(pid, 0)
            + event_by_pid.get(pid, 0)
        )
        vol = _volume_score(actions)
        score = round(100 * (
            ENGAGEMENT_WEIGHT * eng
            + RECENCY_WEIGHT * rec
            + VOLUME_WEIGHT * vol
        ))
        results[pid] = {
            "score": int(score),
            "engagement": round(eng * 100),
            "recency": round(rec * 100),
            "volume": round(vol * 100),
            "components": {
                "engagement_weight": ENGAGEMENT_WEIGHT,
                "recency_weight": RECENCY_WEIGHT,
                "volume_weight": VOLUME_WEIGHT,
                "actions_volume_180d": actions,
                "engagement_window_days": ENGAGEMENT_WINDOW_DAYS,
                "volume_window_days": VOLUME_WINDOW_DAYS,
            },
        }
    return results


def compute_funnel(uid: int) -> dict[str, Any]:
    """Funnel 5 étapes pour la page Stats.

    - Total      : prospects actifs (non archivés, non supprimés)
    - Contactés  : au moins 1 push, 1 call_log, ou lastContact rempli
    - RDV pris   : rdvDate rempli OU statut Rendez-vous/Prospecté
                   OU rdv_outcome non null (déjà revus)
    - RDV tenus  : rdv_outcome = 'tenu'
                   OU au moins 1 meeting (table meetings)
                   OU statut Prospecté (après-RDV par convention)
    - Signés     : event 'contrat_signe' enregistré

    Étapes cumulatives décroissantes (chaque suivante est inclus dans
    la précédente).
    """
    with _conn() as conn:
        prospects = conn.execute(
            """SELECT id, statut, lastContact, rdvDate, rdv_outcome
               FROM prospects
               WHERE owner_id=?
                 AND (deleted_at IS NULL OR deleted_at='')
                 AND (is_archived IS NULL OR is_archived=0)""",
            (uid,),
        ).fetchall()
        all_pids = {r["id"] for r in prospects}

        contacted_via_push = {
            r["prospect_id"]
            for r in conn.execute(
                """SELECT DISTINCT prospect_id FROM push_logs
                   WHERE prospect_id IN (SELECT id FROM prospects WHERE owner_id=?)""",
                (uid,),
            ).fetchall()
        }
        contacted_via_call: set[int] = set()
        try:
            contacted_via_call = {
                r["prospect_id"]
                for r in conn.execute(
                    """SELECT DISTINCT prospect_id FROM call_logs
                       WHERE owner_id=?""",
                    (uid,),
                ).fetchall()
            }
        except Exception:
            pass

        meetings_pids = {
            r["prospect_id"]
            for r in conn.execute(
                "SELECT DISTINCT prospect_id FROM meetings WHERE owner_id=?",
                (uid,),
            ).fetchall()
        }

        contrat_pids = {
            r["prospect_id"]
            for r in conn.execute(
                """SELECT DISTINCT prospect_id FROM prospect_events
                   WHERE type='contrat_signe'
                     AND prospect_id IN (SELECT id FROM prospects WHERE owner_id=?)""",
                (uid,),
            ).fetchall()
        }

    rdv_statuts = {"Rendez-vous", "Prospecté"}

    contacted = set()
    rdv_pris = set()
    rdv_tenus = set()
    signes = set()

    for p in prospects:
        pid = p["id"]
        statut = p["statut"] or ""
        rdv_outcome = (p["rdv_outcome"] or "").strip().lower()
        has_lastcontact = bool((p["lastContact"] or "").strip())
        has_rdv_date = bool((p["rdvDate"] or "").strip())

        if (
            has_lastcontact
            or pid in contacted_via_push
            or pid in contacted_via_call
        ):
            contacted.add(pid)

        if statut in rdv_statuts or has_rdv_date or rdv_outcome:
            rdv_pris.add(pid)

        if (
            rdv_outcome == "tenu"
            or pid in meetings_pids
            or statut == "Prospecté"
        ):
            rdv_tenus.add(pid)

        if pid in contrat_pids:
            signes.add(pid)

    # Inclusion cumulative : rdv_tenus ⊆ rdv_pris ⊆ contacted ⊆ total
    rdv_tenus = rdv_tenus & rdv_pris
    rdv_pris = rdv_pris | rdv_tenus
    rdv_pris = rdv_pris & all_pids
    contacted = contacted | rdv_pris

    stages = [
        {"key": "total",     "label": "Total",      "count": len(all_pids),    "ids": sorted(all_pids)},
        {"key": "contacted", "label": "Contactés",  "count": len(contacted),   "ids": sorted(contacted)},
        {"key": "rdv_pris",  "label": "RDV pris",   "count": len(rdv_pris),    "ids": sorted(rdv_pris)},
        {"key": "rdv_tenus", "label": "RDV tenus",  "count": len(rdv_tenus),   "ids": sorted(rdv_tenus)},
        {"key": "signes",    "label": "Signés",     "count": len(signes),      "ids": sorted(signes)},
    ]

    def _rate(num: int, denom: int) -> float:
        return round(100 * num / denom, 1) if denom > 0 else 0.0

    rates = {
        "contacted_from_total": _rate(len(contacted), len(all_pids)),
        "rdv_from_contacted": _rate(len(rdv_pris), len(contacted)),
        "tenus_from_rdv": _rate(len(rdv_tenus), len(rdv_pris)),
        "signes_from_tenus": _rate(len(signes), len(rdv_tenus)),
        "global_conversion": _rate(len(signes), len(all_pids)),
    }

    return {"stages": stages, "rates": rates}
