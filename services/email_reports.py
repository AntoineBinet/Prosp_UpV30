"""ProspUp — Rapports email quotidien & hebdomadaire.

Ce module est autonome :
    - calcul des KPI (calqués sur /api/dashboard + /api/rapport-hebdo)
    - rendu HTML email-safe (tables + styles inline, 600 px de large)
    - envoi SMTP (TLS optionnel)

Tout est paramétré côté `app_settings` (clé/valeur, table par DB user). Le
dispatcher (voir app.py — `_dispatch_email_reports`) itère sur tous les
utilisateurs actifs, ouvre leur DB, lit leurs préférences et appelle
`send_daily_report` / `send_weekly_report` quand l'heure et le jour
correspondent.
"""
from __future__ import annotations

import datetime
import json
import logging
import smtplib
import sqlite3
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any, Iterable

logger = logging.getLogger("prospup")


# ────────────────────────────────────────────────────────────────────
#  Constantes — clés app_settings & valeurs par défaut
# ────────────────────────────────────────────────────────────────────

SETTING_KEYS = (
    "email_daily_enabled",
    "email_daily_to",
    "email_daily_hour",
    "email_daily_minute",
    "email_daily_days",
    "email_weekly_enabled",
    "email_weekly_to",
    "email_weekly_hour",
    "email_weekly_minute",
    "email_weekly_day",
    "email_smtp_host",
    "email_smtp_port",
    "email_smtp_user",
    "email_smtp_password",
    "email_smtp_from",
    "email_smtp_from_name",
    "email_smtp_use_tls",
    "email_last_daily_sent",
    "email_last_weekly_sent",
    "email_last_error",
)

DEFAULTS = {
    "email_daily_enabled": "0",
    "email_daily_to": "",
    "email_daily_hour": "17",
    "email_daily_minute": "0",
    "email_daily_days": "mon,tue,wed,thu,fri",
    "email_weekly_enabled": "0",
    "email_weekly_to": "",
    "email_weekly_hour": "7",
    "email_weekly_minute": "0",
    "email_weekly_day": "mon",
    "email_smtp_host": "",
    "email_smtp_port": "587",
    "email_smtp_user": "",
    "email_smtp_password": "",
    "email_smtp_from": "",
    "email_smtp_from_name": "Prosp'Up",
    "email_smtp_use_tls": "1",
}

WEEKDAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
WEEKDAY_LABELS_FR = {
    "mon": "Lun", "tue": "Mar", "wed": "Mer",
    "thu": "Jeu", "fri": "Ven", "sat": "Sam", "sun": "Dim",
}
MONTH_LABELS_FR = {
    1: "janvier", 2: "février", 3: "mars", 4: "avril",
    5: "mai", 6: "juin", 7: "juillet", 8: "août",
    9: "septembre", 10: "octobre", 11: "novembre", 12: "décembre",
}


# ────────────────────────────────────────────────────────────────────
#  Helpers settings
# ────────────────────────────────────────────────────────────────────

def load_settings(conn: sqlite3.Connection) -> dict[str, str]:
    """Lit toutes les clés `email_*` depuis `app_settings`, complète avec
    les valeurs par défaut. Retourne un dict[str, str]."""
    out = dict(DEFAULTS)
    try:
        rows = conn.execute(
            "SELECT key, value FROM app_settings WHERE key LIKE 'email_%';"
        ).fetchall()
        for r in rows:
            key = r["key"] if hasattr(r, "keys") else r[0]
            val = r["value"] if hasattr(r, "keys") else r[1]
            out[key] = val if val is not None else ""
    except sqlite3.OperationalError:
        # Table absente ou non encore migrée — on retombe sur les defaults.
        pass
    return out


def save_settings(conn: sqlite3.Connection, updates: dict[str, Any]) -> None:
    """Persiste les paires clé/valeur acceptées (filtrées par SETTING_KEYS)."""
    for key, value in updates.items():
        if key not in SETTING_KEYS:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);",
            (key, "" if value is None else str(value)),
        )


def parse_days(raw: str | None) -> set[str]:
    """Normalise la liste CSV des jours actifs (mon,tue,…) en set."""
    if not raw:
        return set()
    out: set[str] = set()
    for tok in str(raw).split(","):
        tok = tok.strip().lower()[:3]
        if tok in WEEKDAY_KEYS:
            out.add(tok)
    return out


def weekday_key(d: datetime.date) -> str:
    return WEEKDAY_KEYS[d.weekday()]


# ────────────────────────────────────────────────────────────────────
#  Helpers de présentation
# ────────────────────────────────────────────────────────────────────

def _fmt_date_fr(d: datetime.date) -> str:
    return f"{WEEKDAY_LABELS_FR[weekday_key(d)]}. {d.day} {MONTH_LABELS_FR[d.month]}"


def _fmt_long_date_fr(d: datetime.date) -> str:
    wd = {0: "Lundi", 1: "Mardi", 2: "Mercredi", 3: "Jeudi",
          4: "Vendredi", 5: "Samedi", 6: "Dimanche"}[d.weekday()]
    return f"{wd} {d.day} {MONTH_LABELS_FR[d.month]}"


def _safe_pct(num: int, den: int) -> int:
    if not den:
        return 0
    return max(0, min(100, round(num * 100 / den)))


def _initials(name: str) -> str:
    parts = [p for p in (name or "").strip().split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def _esc(s: Any) -> str:
    """Échappement HTML minimal pour l'injection texte dans les templates."""
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _trend_pill(delta: int | float, *, suffix: str = "", positive_good: bool = True) -> tuple[str, str]:
    """Retourne (color, text) pour un delta vs J-1 ou S-1.

    color : hex, text : « ↑ +6 », « ↓ -2 », « = stable »
    """
    if delta is None:
        return "#52525c", "—"
    try:
        d = float(delta)
    except (TypeError, ValueError):
        return "#52525c", "—"
    if abs(d) < 0.01:
        return "#52525c", "= stable"
    arrow = "↑" if d > 0 else "↓"
    sign = "+" if d > 0 else ""
    if positive_good:
        color = "#2c7a50" if d > 0 else "#c64a2f"
    else:
        color = "#c64a2f" if d > 0 else "#2c7a50"
    # Mise en forme : ints sans décimale, floats avec une décimale
    if isinstance(delta, int) or (isinstance(delta, float) and float(delta).is_integer()):
        body = f"{sign}{int(d)}"
    else:
        body = f"{sign}{d:.1f}"
    return color, f"{arrow} {body}{suffix}"


# ────────────────────────────────────────────────────────────────────
#  Calculs — données du rapport quotidien
# ────────────────────────────────────────────────────────────────────

def compute_daily_data(conn: sqlite3.Connection, uid: int, *,
                       target_date: datetime.date | None = None) -> dict[str, Any]:
    """Calcule les KPI du rapport quotidien pour la date donnée
    (par défaut : la veille — le mail part le matin et résume la veille).

    Sources réutilisées :
        - prospect_events.type='rdv_taken'  → RDV pris
        - call_logs                          → appels passés
        - manual_kpi (type='contact')        → ajustement manuel appels
        - push_logs                          → push envoyés
        - prospects.nextFollowUp < today     → relances en retard
    """
    today = datetime.date.today()
    day = target_date or today
    iso = day.isoformat()
    prev_iso = (day - datetime.timedelta(days=1)).isoformat()
    week_ago_iso = (day - datetime.timedelta(days=7)).isoformat()
    monday7 = (day - datetime.timedelta(days=6)).isoformat()  # fenêtre moy. 7 j

    def _cnt(sql: str, params: tuple) -> int:
        try:
            row = conn.execute(sql, params).fetchone()
            if row is None:
                return 0
            val = row[0]
            return int(val or 0)
        except sqlite3.OperationalError:
            return 0

    # Appels (call_logs + manual_kpi contact)
    calls_day = _cnt(
        "SELECT COUNT(*) FROM call_logs WHERE owner_id=? AND date=?;",
        (uid, iso),
    )
    calls_day += _cnt(
        "SELECT COALESCE(SUM(count),0) FROM manual_kpi WHERE user_id=? AND date=? AND type='contact';",
        (uid, iso),
    )
    calls_prev = _cnt(
        "SELECT COUNT(*) FROM call_logs WHERE owner_id=? AND date=?;",
        (uid, prev_iso),
    ) + _cnt(
        "SELECT COALESCE(SUM(count),0) FROM manual_kpi WHERE user_id=? AND date=? AND type='contact';",
        (uid, prev_iso),
    )
    calls_week7 = _cnt(
        "SELECT COUNT(*) FROM call_logs WHERE owner_id=? AND date BETWEEN ? AND ?;",
        (uid, monday7, iso),
    ) + _cnt(
        "SELECT COALESCE(SUM(count),0) FROM manual_kpi WHERE user_id=? AND date BETWEEN ? AND ? AND type='contact';",
        (uid, monday7, iso),
    )
    calls_avg7 = calls_week7 / 7.0

    # RDV pris (event rdv_taken)
    rdv_day = _cnt(
        """SELECT COUNT(DISTINCT e.prospect_id) FROM prospect_events e
           JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
           WHERE e.type='rdv_taken' AND e.date=?
             AND (p.deleted_at IS NULL OR p.deleted_at='');""",
        (uid, iso),
    )
    rdv_prev = _cnt(
        """SELECT COUNT(DISTINCT e.prospect_id) FROM prospect_events e
           JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
           WHERE e.type='rdv_taken' AND e.date=?
             AND (p.deleted_at IS NULL OR p.deleted_at='');""",
        (uid, prev_iso),
    )

    # Push envoyés (toutes channels)
    pushes_day = _cnt(
        """SELECT COUNT(*) FROM push_logs l
           JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=?
           WHERE substr(COALESCE(l.sentAt,''),1,10)=?
             AND (p.deleted_at IS NULL OR p.deleted_at='');""",
        (uid, iso),
    )
    pushes_prev = _cnt(
        """SELECT COUNT(*) FROM push_logs l
           JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=?
           WHERE substr(COALESCE(l.sentAt,''),1,10)=?
             AND (p.deleted_at IS NULL OR p.deleted_at='');""",
        (uid, prev_iso),
    )

    # Goals — pour les cibles
    try:
        from services.dashboard_goals import get_goals_config
        goals = get_goals_config(conn)
        rdv_target = int((goals.get("daily", {}).get("rdv", {}) or {}).get("target", 1))
        push_target = int((goals.get("daily", {}).get("push", {}) or {}).get("target", 3))
    except Exception:
        rdv_target, push_target = 1, 3

    calls_target = max(calls_avg7 * 1.3, 20)  # estimation pragmatique

    # Relances en retard (toujours « aujourd'hui ») + 4 noms
    today_iso = today.isoformat()
    late_rows: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            """SELECT p.id, p.name, COALESCE(c.groupe,'') AS company,
                      p.nextFollowUp
               FROM prospects p
               LEFT JOIN companies c ON c.id=p.company_id
               WHERE p.owner_id=?
                 AND p.nextFollowUp IS NOT NULL AND p.nextFollowUp != ''
                 AND p.nextFollowUp < ?
                 AND (p.deleted_at IS NULL OR p.deleted_at='')
                 AND (p.is_archived IS NULL OR p.is_archived=0)
               ORDER BY p.nextFollowUp ASC LIMIT 20;""",
            (uid, today_iso),
        ).fetchall()
        late_rows = [dict(r) for r in rows]
    except sqlite3.OperationalError:
        late_rows = []

    # Aujourd'hui — relances prévues (nextFollowUp = today_iso) + tâches
    priorities: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            """SELECT p.id, p.name, COALESCE(c.groupe,'') AS company,
                      p.statut, p.nextFollowUp
               FROM prospects p
               LEFT JOIN companies c ON c.id=p.company_id
               WHERE p.owner_id=? AND p.nextFollowUp=?
                 AND (p.deleted_at IS NULL OR p.deleted_at='')
                 AND (p.is_archived IS NULL OR p.is_archived=0)
               ORDER BY p.priority DESC LIMIT 5;""",
            (uid, today_iso),
        ).fetchall()
        for r in rows:
            d = dict(r)
            priorities.append({
                "name": d.get("name") or "",
                "company": d.get("company") or "",
                "hint": "Relance prévue",
                "statut": d.get("statut") or "",
            })
    except sqlite3.OperationalError:
        pass

    # RDV pris hier — pour rappel chaud
    rdv_yesterday: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            """SELECT DISTINCT p.id, p.name, COALESCE(c.groupe,'') AS company,
                      p.rdvDate
               FROM prospect_events e
               JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
               LEFT JOIN companies c ON c.id=p.company_id
               WHERE e.type='rdv_taken' AND e.date=?
                 AND (p.deleted_at IS NULL OR p.deleted_at='')
               ORDER BY e.createdAt DESC LIMIT 5;""",
            (uid, iso),
        ).fetchall()
        rdv_yesterday = [dict(r) for r in rows]
    except sqlite3.OperationalError:
        rdv_yesterday = []

    # Taux de transfo : RDV (jour) / appels (jour)
    transfo = 0.0
    if calls_day > 0:
        transfo = round((rdv_day / calls_day) * 100, 1)

    transfo_avg7 = 0.0
    if calls_week7 > 0:
        rdv_week7 = _cnt(
            """SELECT COUNT(DISTINCT e.prospect_id) FROM prospect_events e
               JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
               WHERE e.type='rdv_taken' AND e.date BETWEEN ? AND ?
                 AND (p.deleted_at IS NULL OR p.deleted_at='');""",
            (uid, monday7, iso),
        )
        transfo_avg7 = round((rdv_week7 / calls_week7) * 100, 1)
    transfo_delta = round(transfo - transfo_avg7, 1)

    # Hero — bandeau résumé (1 phrase)
    hero_line = "Une journée nette."
    if rdv_day >= rdv_target and rdv_day > 0:
        hero_line = f"Belle journée, {rdv_day} RDV décroché{'s' if rdv_day > 1 else ''}."
    elif calls_day >= calls_target * 0.9:
        hero_line = "Vous avez tenu le rythme côté appels."
    elif calls_day == 0 and rdv_day == 0 and pushes_day == 0:
        hero_line = "Journée calme — rien à signaler."
    else:
        hero_line = f"{calls_day} appel{'s' if calls_day > 1 else ''} et {rdv_day} RDV — étoffer le push aujourd'hui."

    return {
        "date": day,
        "today": today,
        "kpis": {
            "calls": {"value": calls_day, "delta": calls_day - round(calls_avg7),
                      "delta_label": "vs moy. 7 j",
                      "target": int(round(calls_target)),
                      "pct": _safe_pct(calls_day, int(round(calls_target)))},
            "rdv": {"value": rdv_day, "delta": rdv_day - rdv_prev,
                    "delta_label": "vs hier",
                    "target": rdv_target,
                    "pct": _safe_pct(rdv_day, rdv_target)},
            "transfo": {"value": transfo, "delta": transfo_delta,
                        "delta_label": "vs moy. 7 j (pt)",
                        "denom": f"{rdv_day} RDV / {calls_day} appels"},
            "push": {"value": pushes_day, "delta": pushes_day - pushes_prev,
                     "delta_label": "vs hier",
                     "target": push_target,
                     "pct": _safe_pct(pushes_day, push_target)},
        },
        "late": late_rows,
        "priorities": priorities,
        "rdv_yesterday": rdv_yesterday,
        "hero_line": hero_line,
    }


# ────────────────────────────────────────────────────────────────────
#  Calculs — données du rapport hebdomadaire
# ────────────────────────────────────────────────────────────────────

def compute_weekly_data(conn: sqlite3.Connection, uid: int, *,
                        reference: datetime.date | None = None) -> dict[str, Any]:
    """Données du rapport hebdo — par défaut, semaine écoulée (lundi → dimanche
    de la semaine précédente). `reference` peut forcer une autre semaine."""
    today = datetime.date.today()
    ref = reference or (today - datetime.timedelta(days=7))
    monday = ref - datetime.timedelta(days=ref.weekday())
    sunday = monday + datetime.timedelta(days=6)
    prev_monday = monday - datetime.timedelta(days=7)
    prev_sunday = sunday - datetime.timedelta(days=7)
    year_ago_monday = monday - datetime.timedelta(days=365)
    year_ago_sunday = sunday - datetime.timedelta(days=365)

    iso_start, iso_end = monday.isoformat(), sunday.isoformat()
    iso_prev_start, iso_prev_end = prev_monday.isoformat(), prev_sunday.isoformat()
    iso_y_start, iso_y_end = year_ago_monday.isoformat(), year_ago_sunday.isoformat()

    def _cnt(sql: str, params: tuple) -> int:
        try:
            row = conn.execute(sql, params).fetchone()
            return int((row[0] or 0)) if row else 0
        except sqlite3.OperationalError:
            return 0

    # Appels (call_logs + manual_kpi 'contact')
    def _calls_range(s: str, e: str) -> int:
        c = _cnt(
            "SELECT COUNT(*) FROM call_logs WHERE owner_id=? AND date BETWEEN ? AND ?;",
            (uid, s, e),
        )
        c += _cnt(
            "SELECT COALESCE(SUM(count),0) FROM manual_kpi "
            "WHERE user_id=? AND date BETWEEN ? AND ? AND type='contact';",
            (uid, s, e),
        )
        return c

    calls = _calls_range(iso_start, iso_end)
    calls_prev = _calls_range(iso_prev_start, iso_prev_end)
    calls_y = _calls_range(iso_y_start, iso_y_end)

    # RDV (events rdv_taken)
    def _rdv_range(s: str, e: str) -> int:
        return _cnt(
            """SELECT COUNT(DISTINCT e.prospect_id) FROM prospect_events e
               JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
               WHERE e.type='rdv_taken' AND e.date BETWEEN ? AND ?
                 AND (p.deleted_at IS NULL OR p.deleted_at='');""",
            (uid, s, e),
        )

    rdv = _rdv_range(iso_start, iso_end)
    rdv_prev = _rdv_range(iso_prev_start, iso_prev_end)
    rdv_y = _rdv_range(iso_y_start, iso_y_end)

    # Nouveaux prospects (createdAt dans la semaine)
    def _new_range(s: str, e: str) -> int:
        return _cnt(
            """SELECT COUNT(*) FROM prospects
               WHERE owner_id=? AND substr(COALESCE(createdAt,''),1,10) BETWEEN ? AND ?
                 AND (deleted_at IS NULL OR deleted_at='');""",
            (uid, s, e),
        )

    new_p = _new_range(iso_start, iso_end)
    new_p_prev = _new_range(iso_prev_start, iso_prev_end)
    new_p_y = _new_range(iso_y_start, iso_y_end)

    # Transfo
    transfo = round((rdv / calls) * 100, 1) if calls else 0.0
    transfo_prev = round((rdv_prev / calls_prev) * 100, 1) if calls_prev else 0.0
    transfo_y = round((rdv_y / calls_y) * 100, 1) if calls_y else 0.0

    # Funnel — Prospects (total snapshot fin de semaine) → Contactés (push OU appel)
    # → Qualifiés (statut Qualifié/Prospecté/Rendez-vous) → RDV
    try:
        total_prospects = _cnt(
            """SELECT COUNT(*) FROM prospects
               WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='')
                 AND (is_archived IS NULL OR is_archived=0)
                 AND substr(COALESCE(createdAt,''),1,10) <= ?;""",
            (uid, iso_end),
        )
    except sqlite3.OperationalError:
        total_prospects = 0

    contacted = _cnt(
        """SELECT COUNT(DISTINCT p.id) FROM prospects p
           LEFT JOIN push_logs l ON l.prospect_id=p.id
           LEFT JOIN call_logs cl ON cl.prospect_id=p.id
           WHERE p.owner_id=?
             AND (p.deleted_at IS NULL OR p.deleted_at='')
             AND (substr(COALESCE(l.sentAt,''),1,10) BETWEEN ? AND ?
                  OR cl.date BETWEEN ? AND ?
                  OR p.lastContact BETWEEN ? AND ?);""",
        (uid, iso_start, iso_end, iso_start, iso_end, iso_start, iso_end),
    )

    qualified = _cnt(
        """SELECT COUNT(*) FROM prospects
           WHERE owner_id=?
             AND statut IN ('Qualifié', 'Prospecté', 'Rendez-vous')
             AND (deleted_at IS NULL OR deleted_at='')
             AND (is_archived IS NULL OR is_archived=0);""",
        (uid,),
    )

    funnel = [
        {"label": "Prospects", "count": total_prospects, "color": "#3957b9"},
        {"label": "Contactés", "count": contacted, "color": "#3573a3"},
        {"label": "Qualifiés", "count": qualified, "color": "#2e8a82"},
        {"label": "RDV pris", "count": rdv, "color": "#3a9b6b"},
    ]
    base = funnel[0]["count"] or 1
    for f in funnel:
        f["pct"] = _safe_pct(f["count"], base)

    # Top 5 entreprises (push + RDV)
    try:
        rows = conn.execute(
            """SELECT c.id, c.groupe,
                      COUNT(DISTINCT l.id) AS pushes,
                      (SELECT COUNT(DISTINCT e.prospect_id) FROM prospect_events e
                         JOIN prospects p2 ON p2.id=e.prospect_id AND p2.owner_id=?
                        WHERE p2.company_id=c.id AND e.type='rdv_taken'
                          AND e.date BETWEEN ? AND ?) AS rdv,
                      (SELECT COUNT(DISTINCT l2.id) FROM push_logs l2
                         JOIN prospects p3 ON p3.id=l2.prospect_id AND p3.owner_id=?
                        WHERE p3.company_id=c.id
                          AND substr(COALESCE(l2.sentAt,''),1,10) BETWEEN ? AND ?) AS pushes_prev
               FROM companies c
               LEFT JOIN prospects p ON p.company_id=c.id AND p.owner_id=?
               LEFT JOIN push_logs l ON l.prospect_id=p.id
                                       AND substr(COALESCE(l.sentAt,''),1,10) BETWEEN ? AND ?
               WHERE c.owner_id=? AND (c.deleted_at IS NULL OR c.deleted_at='')
               GROUP BY c.id
               HAVING pushes > 0 OR rdv > 0
               ORDER BY (pushes + rdv*5) DESC
               LIMIT 5;""",
            (uid, iso_start, iso_end, uid, iso_prev_start, iso_prev_end,
             uid, iso_start, iso_end, uid),
        ).fetchall()
        top_companies = [
            {
                "name": (r["groupe"] or "—"),
                "calls": int(r["pushes"] or 0),
                "rdv": int(r["rdv"] or 0),
                "delta": int(r["pushes"] or 0) - int(r["pushes_prev"] or 0),
            } for r in rows
        ]
    except sqlite3.OperationalError:
        top_companies = []

    # Heatmap — push_logs par demi-journée × jour (lun→ven)
    heatmap = {wd: {"morning": 0, "afternoon": 0} for wd in ("mon", "tue", "wed", "thu", "fri")}
    try:
        rows = conn.execute(
            """SELECT substr(COALESCE(l.sentAt,''),1,10) AS d,
                      substr(COALESCE(l.sentAt,''),12,2) AS h,
                      COUNT(*) AS n
               FROM push_logs l
               JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=?
               WHERE substr(COALESCE(l.sentAt,''),1,10) BETWEEN ? AND ?
               GROUP BY d, h;""",
            (uid, iso_start, iso_end),
        ).fetchall()
        for r in rows:
            try:
                d = datetime.date.fromisoformat(r["d"])
            except Exception:
                continue
            wd = weekday_key(d)
            if wd not in heatmap:
                continue
            slot = "morning" if int(r["h"] or "0") < 13 else "afternoon"
            heatmap[wd][slot] += int(r["n"] or 0)
    except sqlite3.OperationalError:
        pass

    # Note hebdo automatique
    note_hebdo = None
    if top_companies:
        first = top_companies[0]
        note_hebdo = (
            f"{first['name']} tire l'activité ({first['calls']} push, "
            f"{first['rdv']} RDV). Maintenir la pression la semaine prochaine."
        )
    elif rdv == 0 and calls > 0:
        note_hebdo = ("Volume d'appels présent mais zéro RDV. "
                      "Travailler la qualification au prochain cycle.")
    elif rdv > rdv_prev:
        note_hebdo = "Le pipe avance, le rythme se tient."

    return {
        "monday": monday,
        "sunday": sunday,
        "week_number": monday.isocalendar()[1],
        "year": monday.isocalendar()[0],
        "kpis": {
            "calls": {"value": calls, "delta_prev_pct": _pct_delta(calls, calls_prev),
                      "delta_year_pct": _pct_delta(calls, calls_y)},
            "rdv": {"value": rdv, "delta_prev": rdv - rdv_prev,
                    "delta_year": rdv - rdv_y},
            "transfo": {"value": transfo, "delta_prev_pt": round(transfo - transfo_prev, 1),
                        "delta_year_pt": round(transfo - transfo_y, 1)},
            "new_prospects": {"value": new_p, "delta_prev": new_p - new_p_prev,
                              "delta_year": new_p - new_p_y},
        },
        "funnel": funnel,
        "top_companies": top_companies,
        "heatmap": heatmap,
        "note_hebdo": note_hebdo,
        "hero_line": _weekly_hero(rdv, rdv_prev, calls, calls_prev),
    }


def _pct_delta(curr: int, prev: int) -> float | None:
    if not prev:
        return None
    return round(((curr - prev) * 100.0) / prev, 1)


def _weekly_hero(rdv: int, rdv_prev: int, calls: int, calls_prev: int) -> str:
    if rdv == 0 and calls == 0:
        return "Semaine creuse — relancer la machine lundi."
    if rdv > rdv_prev:
        return "Le pipe avance, le rythme se tient."
    if calls > calls_prev and rdv >= rdv_prev:
        return "Volume en hausse, transfo à surveiller."
    if rdv < rdv_prev:
        return "Moins de RDV cette semaine, recentrer la qualification."
    return "Semaine stable, garder le cap."


# ────────────────────────────────────────────────────────────────────
#  Rendu HTML — quotidien
# ────────────────────────────────────────────────────────────────────

def _heatmap_color(value: int, max_v: int) -> str:
    """Échelle indigo 5 paliers."""
    if max_v <= 0:
        return "#e6edf8"
    r = value / max_v
    if r >= 0.85:
        return "#3957b9"
    if r >= 0.55:
        return "#6c8dd4"
    if r >= 0.30:
        return "#9eb6e4"
    if r >= 0.10:
        return "#c4d3ee"
    return "#e6edf8"


def render_daily_html(data: dict[str, Any], *, user_name: str = "",
                      sender_name: str = "Prosp'Up") -> str:
    """HTML email-safe pour le rapport quotidien.

    Tables-only, styles inline, 600 px. Calqué sur le modèle fourni :
    en-tête + KPI 2×2, alerte relances, priorités du jour, CTA, footer.
    """
    d = data["date"]
    today = data["today"]
    k = data["kpis"]

    eyebrow = f"{_fmt_long_date_fr(today)} · résumé d'hier"
    if d == today:
        eyebrow = f"{_fmt_long_date_fr(today)} · résumé du jour"

    hero = _esc(data.get("hero_line") or "")
    salut = f"Bonjour {_esc(user_name)}, " if user_name else "Bonjour, "
    late_count = len(data.get("late") or [])
    salut_lede = salut + (
        f"voici votre point de la veille. {late_count} relance{'s' if late_count > 1 else ''} en retard à solder."
        if late_count else
        "voici votre point de la veille. Aucune relance en retard."
    )

    # KPI cards
    def _kpi_card(eyebrow: str, value: str, delta_html: str, *,
                  progress_pct: int | None = None,
                  progress_color: str = "#d18e2d",
                  caption: str = "") -> str:
        prog = ""
        if progress_pct is not None:
            prog = (
                f'<div style="margin-top:8px; height:4px; background:#f1f1f0; border-radius:99px;">'
                f'<div style="width:{max(0,min(100,progress_pct))}%; height:4px; background:{progress_color}; border-radius:99px;"></div>'
                f"</div>"
            )
        cap = (f'<div style="font-size:10.5px; color:#7a7a85; margin-top:5px; '
               f'font-family:\'JetBrains Mono\',ui-monospace,monospace;">{caption}</div>') if caption else ""
        return f"""
        <td width="50%" valign="top" style="padding:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border:1px solid #e6e6e6; border-radius:8px;">
            <tr><td style="padding:14px 16px;">
              <div style="font-size:10.5px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600;">{eyebrow}</div>
              <div style="font-family:'Instrument Serif',Georgia,serif; font-size:34px; line-height:1; color:#15151b; margin:8px 0 4px; letter-spacing:-0.01em;">{value}</div>
              {delta_html}
              {prog}
              {cap}
            </td></tr>
          </table>
        </td>"""

    # Deltas avec couleur
    calls = k["calls"]
    calls_color, calls_text = _trend_pill(calls["delta"], suffix=" " + calls["delta_label"])
    calls_html = f'<div style="font-size:11.5px; color:{calls_color}; font-weight:500; font-feature-settings:\'tnum\';">{calls_text}</div>'

    rdv = k["rdv"]
    rdv_color, rdv_text = _trend_pill(rdv["delta"], suffix=" " + rdv["delta_label"])
    rdv_html = f'<div style="font-size:11.5px; color:{rdv_color}; font-weight:500; font-feature-settings:\'tnum\';">{rdv_text}</div>'

    transfo = k["transfo"]
    t_color, t_text = _trend_pill(transfo["delta"], suffix=" pt vs moy. 7 j")
    t_html = f'<div style="font-size:11.5px; color:{t_color}; font-weight:500; font-feature-settings:\'tnum\';">{t_text}</div>'

    push = k["push"]
    p_color, p_text = _trend_pill(push["delta"], suffix=" " + push["delta_label"])
    p_html = f'<div style="font-size:11.5px; color:{p_color}; font-weight:500; font-feature-settings:\'tnum\';">{p_text}</div>'

    kpi_grid = f"""
    <tr>
      {_kpi_card("Appels passés", str(calls["value"]), calls_html,
                 progress_pct=calls["pct"], progress_color="#d18e2d",
                 caption=f"Cible {calls['target']} · {calls['pct']}%")}
      {_kpi_card("RDV obtenus", str(rdv["value"]), rdv_html,
                 progress_pct=rdv["pct"], progress_color="#3a9b6b",
                 caption=f"Cible {rdv['target']}" + (" · atteinte" if rdv["pct"] >= 100 else ""))}
    </tr>
    <tr>
      {_kpi_card("Taux de transfo", f"{transfo['value']:.1f}%".replace(".", ","),
                 t_html, caption=transfo["denom"])}
      {_kpi_card("Push envoyés", str(push["value"]), p_html,
                 progress_pct=push["pct"], progress_color="#3957b9",
                 caption=f"Cible {push['target']}")}
    </tr>"""

    # Alerte relances
    late_block = ""
    if late_count:
        names = " · ".join(
            f"{_esc(r.get('name'))} ({_esc(r.get('company'))})" if r.get("company") else _esc(r.get("name"))
            for r in (data["late"][:6])
        )
        more = f" +{late_count - 6} autres" if late_count > 6 else ""
        late_block = f"""
        <tr><td style="padding:14px 24px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fdf2ef; border:1px solid #f3d9d0; border-radius:8px;">
            <tr><td style="padding:12px 14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td valign="top" width="8" style="padding-top:5px;">
                  <span style="display:inline-block; width:8px; height:8px; border-radius:99px; background:#c64a2f;"></span>
                </td>
                <td valign="top" style="padding-left:10px;">
                  <div style="font-size:12px; font-weight:600; color:#15151b;">{late_count} relance{'s' if late_count > 1 else ''} en retard</div>
                  <div style="font-size:12px; color:#52525c; margin-top:2px; line-height:1.5;">{names}{more}</div>
                </td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>"""

    # Priorités du jour
    priorities = data.get("priorities") or []
    if not priorities:
        priorities = [{
            "name": r.get("name") or "",
            "company": r.get("company") or "",
            "hint": f"Relance en retard depuis {r.get('nextFollowUp', '')}",
            "statut": "",
        } for r in (data.get("late") or [])[:3]]

    prio_rows = ""
    palette = [("#e8eaf3", "#3957b9"), ("#f3ebd9", "#8a6a18"), ("#e2ecd9", "#3a6b21")]
    for i, p in enumerate(priorities[:3]):
        bg, fg = palette[i % len(palette)]
        initials = _initials(p.get("name") or "")
        sep = "<tr><td colspan='3' style='border-top:1px solid #f1f1f0;'></td></tr>" if i > 0 else ""
        prio_rows += f"""
        {sep}
        <tr><td style="padding:11px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" width="34">
              <span style="display:inline-block; width:24px; height:24px; border-radius:99px; background:{bg}; color:{fg}; text-align:center; line-height:24px; font-size:10px; font-weight:600; font-family:'Inter',sans-serif;">{_esc(initials)}</span>
            </td>
            <td valign="middle" style="padding-left:6px;">
              <div style="font-size:13px; font-weight:500; color:#15151b;">{_esc(p.get('name'))} <span style="color:#7a7a85; font-weight:400;">· {_esc(p.get('company') or '')}</span></div>
              <div style="font-size:11.5px; color:#7a7a85; margin-top:1px;">{_esc(p.get('hint') or 'À traiter')}</div>
            </td>
            <td valign="middle" align="right" style="font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11px; color:#7a7a85;">—</td>
          </tr></table>
        </td></tr>"""

    priorities_block = ""
    if prio_rows:
        priorities_block = f"""
        <tr><td style="padding:24px 24px 6px;">
          <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; margin-bottom:10px;">
            Aujourd'hui · priorité
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6e6e6; border-radius:8px;">
            {prio_rows}
          </table>
        </td></tr>"""

    quiet_lines = [
        "Une journée bien commencée se gagne avant 10 h.",
        "Le pipe se construit appel après appel.",
        "Un RDV par jour suffit à tenir l'année.",
        "Avancer un peu chaque jour, c'est l'arme du long terme.",
    ]
    quiet = quiet_lines[d.day % len(quiet_lines)]

    eyebrow_brand = "Rapport quotidien"

    return f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>Rapport quotidien — Prosp'Up</title></head>
<body style="margin:0; padding:0; background:#f6f6f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f6f5; padding:24px 0;">
<tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px; max-width:600px; background:#ffffff; border:1px solid #e6e6e6; border-radius:10px; font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif; color:#1a1a1f;">

    <tr><td style="padding:18px 24px 14px; border-bottom:1px solid #ececec;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:'Instrument Serif',Georgia,serif; font-style:italic; font-size:21px; color:#1a1a1f; letter-spacing:-0.3px;">
          <span style="display:inline-block; width:22px; height:22px; border-radius:5px; background:#FF6B35; color:#fff; text-align:center; line-height:22px; font-size:14px; font-family:'Instrument Serif',Georgia,serif; font-style:italic; vertical-align:-4px; margin-right:8px;">u</span>{_esc(sender_name)}
        </td>
        <td align="right" style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:500;">{eyebrow_brand}</td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:26px 24px 4px;">
      <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:500; margin-bottom:8px;">{_esc(eyebrow)}</div>
      <h1 style="font-family:'Instrument Serif',Georgia,serif; font-style:italic; font-weight:400; font-size:28px; line-height:1.15; margin:0; color:#15151b; letter-spacing:-0.4px;">{hero}</h1>
      <p style="margin:8px 0 0; font-size:13.5px; line-height:1.55; color:#52525c;">{salut_lede}</p>
    </td></tr>

    <tr><td style="padding:22px 18px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{kpi_grid}</table>
    </td></tr>

    {late_block}
    {priorities_block}

    <tr><td style="padding:22px 24px 8px;" align="center">
      <a href="https://prospup.work/v30/dashboard" style="display:inline-block; padding:10px 22px; background:#15151b; color:#ffffff; font-size:13px; font-weight:500; border-radius:6px; text-decoration:none; font-family:'Inter',sans-serif;">Ouvrir mon cockpit&nbsp;→</a>
    </td></tr>

    <tr><td style="padding:6px 24px 22px;" align="center">
      <p style="font-family:'Instrument Serif',Georgia,serif; font-style:italic; font-size:14.5px; color:#7a7a85; margin:0; line-height:1.4;">«&nbsp;{_esc(quiet)}&nbsp;»</p>
    </td></tr>

    <tr><td style="padding:14px 24px 18px; border-top:1px solid #ececec; background:#fafaf9;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:11px; color:#9a9aa5;">Prosp'Up · Up Technologies<br/>Rapport envoyé selon vos préférences (Paramètres → Rapports email).</td>
        <td align="right" style="font-size:11px; color:#9a9aa5;">
          <a href="https://prospup.work/v30/parametres#email-reports" style="color:#7a7a85; text-decoration:none;">Préférences</a>
        </td>
      </tr></table>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>"""


# ────────────────────────────────────────────────────────────────────
#  Rendu HTML — hebdomadaire
# ────────────────────────────────────────────────────────────────────

def render_weekly_html(data: dict[str, Any], *, user_name: str = "",
                       sender_name: str = "Prosp'Up") -> str:
    monday = data["monday"]
    sunday = data["sunday"]
    week_n = data["week_number"]
    k = data["kpis"]

    week_label = f"semaine du {monday.day} au {sunday.day} {MONTH_LABELS_FR[sunday.month]}"
    eyebrow_brand = f"Rapport hebdomadaire · S{week_n}"
    eyebrow = f"{_fmt_long_date_fr(datetime.date.today())} · {week_label}"

    # KPI 2x2
    def _row(eyebrow: str, value: str, delta_html: str) -> str:
        return f"""
        <td width="50%" valign="top" style="padding:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border:1px solid #e6e6e6; border-radius:8px;">
            <tr><td style="padding:14px 16px;">
              <div style="font-size:10.5px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600;">{eyebrow}</div>
              <div style="font-family:'Instrument Serif',Georgia,serif; font-size:34px; line-height:1; color:#15151b; margin:8px 0 4px; letter-spacing:-0.01em;">{value}</div>
              {delta_html}
            </td></tr>
          </table>
        </td>"""

    def _delta_inline(delta_a: Any, label_a: str, delta_b: Any, label_b: str) -> str:
        ca, ta = _trend_pill(delta_a)
        cb, tb = _trend_pill(delta_b)
        return (
            f'<div style="font-size:11.5px; color:#52525c; font-feature-settings:\'tnum\';">'
            f'<span style="color:{ca}; font-weight:500;">{ta}</span> {label_a} · '
            f'<span style="color:{cb}; font-weight:500;">{tb}</span> {label_b}'
            f'</div>'
        )

    calls = k["calls"]
    calls_delta_html = _delta_inline(
        calls.get("delta_prev_pct"), "S-1",
        calls.get("delta_year_pct"), "N-1",
    )
    rdv = k["rdv"]
    rdv_delta_html = _delta_inline(rdv.get("delta_prev"), "S-1", rdv.get("delta_year"), "N-1")
    transfo = k["transfo"]
    transfo_delta_html = _delta_inline(transfo.get("delta_prev_pt"), "pt S-1",
                                       transfo.get("delta_year_pt"), "pt N-1")
    np = k["new_prospects"]
    np_delta_html = _delta_inline(np.get("delta_prev"), "S-1", np.get("delta_year"), "N-1")

    kpi_block = f"""
    <tr>
      {_row("Appels passés", str(calls["value"]), calls_delta_html)}
      {_row("RDV obtenus", str(rdv["value"]), rdv_delta_html)}
    </tr>
    <tr>
      {_row("Taux de transfo", f"{transfo['value']:.1f}%".replace(".", ","), transfo_delta_html)}
      {_row("Nouveaux prospects", str(np["value"]), np_delta_html)}
    </tr>"""

    # Funnel
    funnel_rows = ""
    for f in data["funnel"]:
        pct = max(3, min(100, f["pct"]))
        funnel_rows += f"""
        <tr><td style="padding:5px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="110" style="font-size:12.5px; color:#52525c;">{_esc(f['label'])}</td>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f1f0; border-radius:4px; height:18px;">
                <tr><td width="{pct}%" style="height:18px; background:{f['color']}; border-radius:4px;">&nbsp;</td><td style="height:18px;">&nbsp;</td></tr>
              </table>
            </td>
            <td width="80" align="right" style="font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11.5px; color:#15151b; padding-left:10px;">
              {f['count']} <span style="color:#7a7a85;">·{f['pct']}&nbsp;%</span>
            </td>
          </tr></table>
        </td></tr>"""

    funnel_block = f"""
    <tr><td style="padding:22px 24px 6px;">
      <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; margin-bottom:12px;">
        Funnel · semaine {week_n}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{funnel_rows}</table>
    </td></tr>"""

    # Top 5 comptes
    top_rows = ""
    for c in (data.get("top_companies") or [])[:5]:
        delta_color, delta_text = _trend_pill(c.get("delta") or 0)
        top_rows += f"""
        <tr>
          <td style="padding:9px 12px; font-size:12.5px; color:#15151b; font-weight:500; border-bottom:1px solid #f1f1f0;">{_esc(c['name'])}</td>
          <td align="right" style="padding:9px 12px; font-size:12px; font-family:'JetBrains Mono',ui-monospace,monospace; color:#15151b; border-bottom:1px solid #f1f1f0;">{c['calls']}</td>
          <td align="right" style="padding:9px 12px; font-size:12px; font-family:'JetBrains Mono',ui-monospace,monospace; color:#15151b; border-bottom:1px solid #f1f1f0;">{c['rdv']}</td>
          <td align="right" style="padding:9px 12px; font-size:12px; font-family:'JetBrains Mono',ui-monospace,monospace; color:{delta_color}; border-bottom:1px solid #f1f1f0;">{delta_text}</td>
        </tr>"""

    top_block = ""
    if top_rows:
        top_block = f"""
        <tr><td style="padding:22px 24px 6px;">
          <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; margin-bottom:10px;">
            Top 5 comptes — push &amp; RDV
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6e6e6; border-radius:8px;">
            <tr style="background:#fafaf9;">
              <td style="padding:8px 12px; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; border-bottom:1px solid #ececec;">Entreprise</td>
              <td align="right" style="padding:8px 12px; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; border-bottom:1px solid #ececec;">Push</td>
              <td align="right" style="padding:8px 12px; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; border-bottom:1px solid #ececec;">RDV</td>
              <td align="right" style="padding:8px 12px; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; border-bottom:1px solid #ececec;">Δ S-1</td>
            </tr>
            {top_rows}
          </table>
        </td></tr>"""

    # Heatmap (lun→ven × matin/après-midi)
    hm = data["heatmap"]
    max_v = max((max(v.get("morning", 0), v.get("afternoon", 0)) for v in hm.values()),
                default=0)
    days_order = ["mon", "tue", "wed", "thu", "fri"]
    morning_cells = "".join(
        f'<td width="18%" style="padding:2px;"><div style="height:22px; background:{_heatmap_color(hm[d]["morning"], max_v)}; border-radius:3px;"></div></td>'
        for d in days_order
    )
    afternoon_cells = "".join(
        f'<td style="padding:2px;"><div style="height:22px; background:{_heatmap_color(hm[d]["afternoon"], max_v)}; border-radius:3px;"></div></td>'
        for d in days_order
    )
    day_labels = "".join(
        f'<td align="center" style="font-size:10.5px; color:#7a7a85; font-family:\'JetBrains Mono\',ui-monospace,monospace; padding-top:4px;">{WEEKDAY_LABELS_FR[d]}</td>'
        for d in days_order
    )

    # Pic d'activité
    pic_msg = ""
    pic_max = 0
    pic_day = ""
    pic_slot = ""
    for d in days_order:
        for slot in ("morning", "afternoon"):
            v = hm[d][slot]
            if v > pic_max:
                pic_max = v
                pic_day = WEEKDAY_LABELS_FR[d].lower()
                pic_slot = "matin" if slot == "morning" else "après-midi"
    if pic_max:
        pic_msg = f"Pic d'activité <b style=\"color:#15151b\">{pic_day} {pic_slot}</b>."

    heatmap_block = f"""
    <tr><td style="padding:22px 24px 6px;">
      <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; margin-bottom:10px;">
        Rythme · push par demi-journée
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="50" style="font-size:10.5px; color:#7a7a85; font-family:'JetBrains Mono',ui-monospace,monospace;">Matin</td>
          {morning_cells}
        </tr>
        <tr>
          <td style="font-size:10.5px; color:#7a7a85; font-family:'JetBrains Mono',ui-monospace,monospace;">A-midi</td>
          {afternoon_cells}
        </tr>
        <tr>
          <td>&nbsp;</td>
          {day_labels}
        </tr>
      </table>
      {f'<p style="font-size:11.5px; color:#52525c; margin:10px 0 0; line-height:1.5;">{pic_msg}</p>' if pic_msg else ''}
    </td></tr>"""

    note_block = ""
    if data.get("note_hebdo"):
        note_block = f"""
        <tr><td style="padding:22px 24px 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ee; border-left:3px solid #FF6B35; border-radius:0 6px 6px 0;">
            <tr><td style="padding:14px 16px;">
              <div style="font-size:10.5px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:600; margin-bottom:4px;">Note de la semaine</div>
              <p style="font-family:'Instrument Serif',Georgia,serif; font-style:italic; font-size:16px; line-height:1.45; color:#15151b; margin:0;">{_esc(data['note_hebdo'])}</p>
            </td></tr>
          </table>
        </td></tr>"""

    hero = _esc(data.get("hero_line") or "")
    salut = f"Bonjour {_esc(user_name)}, " if user_name else "Bonjour, "
    lede = (
        f"{salut}{calls['value']} appels et {rdv['value']} RDV décrochés cette semaine. "
        f"Le taux de transfo s'établit à {transfo['value']:.1f}%.".replace(".", ",")
    )

    return f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>Rapport hebdomadaire — Prosp'Up</title></head>
<body style="margin:0; padding:0; background:#f6f6f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f6f5; padding:24px 0;">
<tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px; max-width:600px; background:#ffffff; border:1px solid #e6e6e6; border-radius:10px; font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif; color:#1a1a1f;">

    <tr><td style="padding:18px 24px 14px; border-bottom:1px solid #ececec;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:'Instrument Serif',Georgia,serif; font-style:italic; font-size:21px; color:#1a1a1f; letter-spacing:-0.3px;">
          <span style="display:inline-block; width:22px; height:22px; border-radius:5px; background:#FF6B35; color:#fff; text-align:center; line-height:22px; font-size:14px; font-family:'Instrument Serif',Georgia,serif; font-style:italic; vertical-align:-4px; margin-right:8px;">u</span>{_esc(sender_name)}
        </td>
        <td align="right" style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:500;">{eyebrow_brand}</td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:26px 24px 4px;">
      <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a85; font-weight:500; margin-bottom:8px;">{_esc(eyebrow)}</div>
      <h1 style="font-family:'Instrument Serif',Georgia,serif; font-style:italic; font-weight:400; font-size:28px; line-height:1.15; margin:0; color:#15151b; letter-spacing:-0.4px;">{hero}</h1>
      <p style="margin:8px 0 0; font-size:13.5px; line-height:1.55; color:#52525c;">{lede}</p>
    </td></tr>

    <tr><td style="padding:22px 18px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{kpi_block}</table>
    </td></tr>

    {funnel_block}
    {top_block}
    {heatmap_block}
    {note_block}

    <tr><td style="padding:22px 24px 8px;" align="center">
      <a href="https://prospup.work/v30/stats" style="display:inline-block; padding:10px 22px; background:#15151b; color:#ffffff; font-size:13px; font-weight:500; border-radius:6px; text-decoration:none; font-family:'Inter',sans-serif;">Voir le rapport complet&nbsp;→</a>
    </td></tr>

    <tr><td style="padding:14px 24px 18px; border-top:1px solid #ececec; background:#fafaf9;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:11px; color:#9a9aa5;">Prosp'Up · Up Technologies<br/>Rapport envoyé selon vos préférences (Paramètres → Rapports email).</td>
        <td align="right" style="font-size:11px; color:#9a9aa5;">
          <a href="https://prospup.work/v30/parametres#email-reports" style="color:#7a7a85; text-decoration:none;">Préférences</a>
        </td>
      </tr></table>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>"""


# ────────────────────────────────────────────────────────────────────
#  Envoi SMTP
# ────────────────────────────────────────────────────────────────────

class EmailConfigError(Exception):
    """Lève quand la configuration SMTP est incomplète/invalide."""


def _smtp_config_from_settings(s: dict[str, str]) -> dict[str, Any]:
    host = (s.get("email_smtp_host") or "").strip()
    if not host:
        raise EmailConfigError("Hôte SMTP manquant")
    try:
        port = int(s.get("email_smtp_port") or "587")
    except (TypeError, ValueError):
        port = 587
    return {
        "host": host,
        "port": port,
        "user": (s.get("email_smtp_user") or "").strip(),
        "password": s.get("email_smtp_password") or "",
        "from_addr": (s.get("email_smtp_from") or s.get("email_smtp_user") or "").strip(),
        "from_name": (s.get("email_smtp_from_name") or "Prosp'Up").strip(),
        "use_tls": str(s.get("email_smtp_use_tls") or "1") in ("1", "true", "yes"),
    }


def send_email(*, to: str | Iterable[str], subject: str, html: str,
               settings: dict[str, str], timeout: int = 30) -> None:
    """Envoie un email HTML via SMTP. Lève EmailConfigError si config KO,
    smtplib.SMTPException sinon."""
    smtp = _smtp_config_from_settings(settings)
    if not smtp["from_addr"]:
        raise EmailConfigError("Adresse expéditeur manquante (SMTP from)")

    recipients = [a.strip() for a in (to if isinstance(to, (list, tuple, set))
                                      else str(to).split(",")) if a and a.strip()]
    if not recipients:
        raise EmailConfigError("Aucun destinataire")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((smtp["from_name"], smtp["from_addr"]))
    msg["To"] = ", ".join(recipients)
    msg.set_content("Votre client mail ne supporte pas le HTML. "
                    "Ouvrez Prosp'Up directement pour consulter le rapport.")
    msg.add_alternative(html, subtype="html")

    if smtp["use_tls"]:
        with smtplib.SMTP(smtp["host"], smtp["port"], timeout=timeout) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            if smtp["user"]:
                server.login(smtp["user"], smtp["password"])
            server.send_message(msg, from_addr=smtp["from_addr"], to_addrs=recipients)
    else:
        with smtplib.SMTP_SSL(smtp["host"], smtp["port"], timeout=timeout) as server:
            if smtp["user"]:
                server.login(smtp["user"], smtp["password"])
            server.send_message(msg, from_addr=smtp["from_addr"], to_addrs=recipients)


# ────────────────────────────────────────────────────────────────────
#  Entrée haut niveau (orchestration)
# ────────────────────────────────────────────────────────────────────

def build_and_send_daily(conn: sqlite3.Connection, uid: int, *,
                         user_name: str = "",
                         target_date: datetime.date | None = None) -> dict[str, Any]:
    settings = load_settings(conn)
    to = settings.get("email_daily_to") or ""
    if not to.strip():
        raise EmailConfigError("Destinataire quotidien manquant")
    data = compute_daily_data(conn, uid, target_date=target_date)
    html = render_daily_html(data, user_name=user_name,
                             sender_name=settings.get("email_smtp_from_name") or "Prosp'Up")
    day = data["date"]
    subject = (
        f"Hier · {_fmt_date_fr(day)} — "
        f"{data['kpis']['calls']['value']} appels · "
        f"{data['kpis']['rdv']['value']} RDV"
    )
    send_email(to=to, subject=subject, html=html, settings=settings)
    save_settings(conn, {
        "email_last_daily_sent": datetime.datetime.now().isoformat(timespec="seconds"),
        "email_last_error": "",
    })
    return {"ok": True, "subject": subject, "to": to, "data": data}


def build_and_send_weekly(conn: sqlite3.Connection, uid: int, *,
                          user_name: str = "",
                          reference: datetime.date | None = None) -> dict[str, Any]:
    settings = load_settings(conn)
    to = settings.get("email_weekly_to") or ""
    if not to.strip():
        raise EmailConfigError("Destinataire hebdomadaire manquant")
    data = compute_weekly_data(conn, uid, reference=reference)
    html = render_weekly_html(data, user_name=user_name,
                              sender_name=settings.get("email_smtp_from_name") or "Prosp'Up")
    transfo_str = f"{data['kpis']['transfo']['value']:.1f}%".replace(".", ",")
    subject = (
        f"Semaine {data['week_number']} · "
        f"{data['kpis']['calls']['value']} appels · "
        f"{data['kpis']['rdv']['value']} RDV · transfo {transfo_str}"
    )
    send_email(to=to, subject=subject, html=html, settings=settings)
    save_settings(conn, {
        "email_last_weekly_sent": datetime.datetime.now().isoformat(timespec="seconds"),
        "email_last_error": "",
    })
    return {"ok": True, "subject": subject, "to": to, "data": data}


# ────────────────────────────────────────────────────────────────────
#  Dispatcher — appelé par le scheduler toutes les minutes
# ────────────────────────────────────────────────────────────────────

def should_send_daily(s: dict[str, str], now: datetime.datetime) -> bool:
    if s.get("email_daily_enabled") not in ("1", "true", "yes", "on"):
        return False
    days = parse_days(s.get("email_daily_days"))
    if weekday_key(now.date()) not in days:
        return False
    try:
        h = int(s.get("email_daily_hour") or "17")
        m = int(s.get("email_daily_minute") or "0")
    except (TypeError, ValueError):
        return False
    if now.hour != h or now.minute != m:
        return False
    last = s.get("email_last_daily_sent") or ""
    if last and last[:10] == now.date().isoformat():
        return False
    return True


def should_send_weekly(s: dict[str, str], now: datetime.datetime) -> bool:
    if s.get("email_weekly_enabled") not in ("1", "true", "yes", "on"):
        return False
    day = (s.get("email_weekly_day") or "mon").strip().lower()[:3]
    if day not in WEEKDAY_KEYS:
        return False
    if weekday_key(now.date()) != day:
        return False
    try:
        h = int(s.get("email_weekly_hour") or "7")
        m = int(s.get("email_weekly_minute") or "0")
    except (TypeError, ValueError):
        return False
    if now.hour != h or now.minute != m:
        return False
    last = s.get("email_last_weekly_sent") or ""
    if last and last[:10] == now.date().isoformat():
        return False
    return True
