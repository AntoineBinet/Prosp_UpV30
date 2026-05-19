"""ProspUp — Service Séquences Push (Phase 4 productivité v32.x).

Cadences guidées avec adaptation multi-canal. Chaque step suggère un
canal et un timing ; l'utilisateur clique pour exécuter (rien n'est
envoyé automatiquement). Pas de SMS ni LinkedIn automatique (la
suggestion LinkedIn est manuelle, l'utilisateur ouvre le profil).

Schéma `steps_json` (liste de dicts) :
    [
      {
        "day_offset": 0,                  // jours depuis l'enrollment
        "channel": "email"|"call"|"linkedin"|"wait",
        "hint": "Texte d'aide affiché à l'utilisateur",
        "condition": "always"|"if_not_opened"|"if_not_replied",
        "template_id": null | int          // template pré-sélectionné
      }
    ]

Statuts enrollment : active / paused / done / cancelled.
Auto-pause : si push_logs.replied_at sur le prospect depuis started_at
→ statut paused, raison "Réponse reçue".
"""
from __future__ import annotations

import datetime
import json
import logging
from typing import Any

from utils.common import _now_iso, _today_iso
from utils.db import _conn

logger = logging.getLogger("prospup")

VALID_STATUSES = {"active", "paused", "done", "cancelled"}
VALID_CHANNELS = {"email", "call", "linkedin", "wait"}
VALID_CONDITIONS = {"always", "if_not_opened", "if_not_replied"}


# ─── 3 séquences seedées par défaut ───────────────────────────
DEFAULT_SEQUENCES = [
    {
        "name": "Découverte cadencée",
        "description": (
            "Premier contact email à J0, relance courte à J+3 si non-ouvert, "
            "tentative téléphone à J+7 si silence total."
        ),
        "steps": [
            {"day_offset": 0, "channel": "email", "condition": "always",
             "hint": "Email d'introduction — accroche courte + appel à l'action soft",
             "template_id": None},
            {"day_offset": 3, "channel": "email", "condition": "if_not_opened",
             "hint": "Relance email courte — 2 lignes, valeur ajoutée différente",
             "template_id": None},
            {"day_offset": 7, "channel": "call", "condition": "if_not_replied",
             "hint": "Tentative téléphonique — script court 30 secondes",
             "template_id": None},
        ],
    },
    {
        "name": "Relance après RDV",
        "description": (
            "Email de remerciement à J0, rappel à J+5 si non-ouvert, "
            "tentative LinkedIn à J+10 si pas de réponse."
        ),
        "steps": [
            {"day_offset": 0, "channel": "email", "condition": "always",
             "hint": "Merci pour le RDV — récap des prochaines étapes",
             "template_id": None},
            {"day_offset": 5, "channel": "email", "condition": "if_not_opened",
             "hint": "Rappel léger des prochaines étapes",
             "template_id": None},
            {"day_offset": 10, "channel": "linkedin", "condition": "if_not_replied",
             "hint": "Message LinkedIn manuel — court et personnel",
             "template_id": None},
        ],
    },
    {
        "name": "Multi-touch large",
        "description": (
            "Séquence agressive multi-canal sur 10 jours : email J0, "
            "LinkedIn J+2, téléphone J+5, email final J+10."
        ),
        "steps": [
            {"day_offset": 0, "channel": "email", "condition": "always",
             "hint": "Email d'ouverture longue", "template_id": None},
            {"day_offset": 2, "channel": "linkedin", "condition": "if_not_opened",
             "hint": "Message LinkedIn manuel — pivot canal",
             "template_id": None},
            {"day_offset": 5, "channel": "call", "condition": "if_not_replied",
             "hint": "Appel à froid", "template_id": None},
            {"day_offset": 10, "channel": "email", "condition": "if_not_replied",
             "hint": "Email final — break-up courtois", "template_id": None},
        ],
    },
]


def _validate_steps(raw: Any) -> list[dict]:
    """Valide une liste de steps et la normalise."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("steps doit être une liste non vide")
    out: list[dict] = []
    seen_offsets: set[int] = set()
    for idx, s in enumerate(raw):
        if not isinstance(s, dict):
            raise ValueError(f"step #{idx} doit être un objet")
        try:
            day_offset = int(s.get("day_offset", 0))
        except (TypeError, ValueError):
            raise ValueError(f"step #{idx} : day_offset invalide")
        if day_offset < 0 or day_offset > 365:
            raise ValueError(f"step #{idx} : day_offset doit être 0-365")
        if day_offset in seen_offsets:
            raise ValueError(f"step #{idx} : day_offset={day_offset} déjà utilisé")
        seen_offsets.add(day_offset)

        channel = (s.get("channel") or "").strip().lower()
        if channel not in VALID_CHANNELS:
            raise ValueError(f"step #{idx} : channel invalide ({channel!r})")
        condition = (s.get("condition") or "always").strip().lower()
        if condition not in VALID_CONDITIONS:
            raise ValueError(f"step #{idx} : condition invalide ({condition!r})")
        hint = (s.get("hint") or "").strip()[:300]
        template_id = s.get("template_id")
        if template_id is not None:
            try:
                template_id = int(template_id)
            except (TypeError, ValueError):
                template_id = None
        out.append({
            "day_offset": day_offset,
            "channel": channel,
            "condition": condition,
            "hint": hint,
            "template_id": template_id,
        })
    out.sort(key=lambda s: s["day_offset"])
    return out


def seed_default_sequences(uid: int) -> int:
    """Crée les 3 séquences par défaut si l'utilisateur n'en a aucune.

    Retourne le nombre de séquences créées. Idempotent.
    """
    now = _now_iso()
    created = 0
    with _conn() as conn:
        existing = conn.execute(
            "SELECT COUNT(*) AS n FROM push_sequences WHERE owner_id=?", (uid,),
        ).fetchone()["n"]
        if existing > 0:
            return 0
        for seq in DEFAULT_SEQUENCES:
            steps_json = json.dumps(seq["steps"], ensure_ascii=False)
            conn.execute(
                """INSERT INTO push_sequences
                   (owner_id, name, description, steps_json, is_active,
                    is_default, createdAt, updatedAt)
                   VALUES (?, ?, ?, ?, 1, 1, ?, ?)""",
                (uid, seq["name"], seq["description"], steps_json, now, now),
            )
            created += 1
        conn.commit()
    return created


def list_sequences(uid: int) -> list[dict]:
    """Liste les séquences de l'utilisateur (active=1)."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, name, description, steps_json, is_default,
                      is_active, createdAt, updatedAt
               FROM push_sequences
               WHERE owner_id=? AND is_active=1
               ORDER BY is_default DESC, id ASC""",
            (uid,),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["steps"] = json.loads(d.pop("steps_json") or "[]")
        except (json.JSONDecodeError, TypeError):
            d["steps"] = []
        out.append(d)
    return out


def get_sequence(uid: int, sequence_id: int) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM push_sequences WHERE id=? AND owner_id=?",
            (sequence_id, uid),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["steps"] = json.loads(d.pop("steps_json") or "[]")
    except (json.JSONDecodeError, TypeError):
        d["steps"] = []
    return d


def create_sequence(uid: int, name: str, description: str, steps: list[dict]) -> int:
    name = (name or "").strip()
    if not name:
        raise ValueError("name requis")
    if len(name) > 120:
        raise ValueError("name trop long (max 120)")
    validated_steps = _validate_steps(steps)
    steps_json = json.dumps(validated_steps, ensure_ascii=False)
    now = _now_iso()
    with _conn() as conn:
        cur = conn.execute(
            """INSERT INTO push_sequences
               (owner_id, name, description, steps_json, is_active, is_default,
                createdAt, updatedAt)
               VALUES (?, ?, ?, ?, 1, 0, ?, ?)""",
            (uid, name, (description or "").strip()[:500], steps_json, now, now),
        )
        conn.commit()
        return int(cur.lastrowid)


def update_sequence(uid: int, sequence_id: int, *,
                    name: str | None = None,
                    description: str | None = None,
                    steps: list[dict] | None = None,
                    is_active: bool | None = None) -> bool:
    fields: list[str] = []
    params: list[Any] = []
    if name is not None:
        n = name.strip()
        if not n:
            raise ValueError("name vide")
        if len(n) > 120:
            raise ValueError("name trop long")
        fields.append("name=?")
        params.append(n)
    if description is not None:
        fields.append("description=?")
        params.append(description.strip()[:500])
    if steps is not None:
        validated = _validate_steps(steps)
        fields.append("steps_json=?")
        params.append(json.dumps(validated, ensure_ascii=False))
    if is_active is not None:
        fields.append("is_active=?")
        params.append(1 if is_active else 0)
    if not fields:
        return False
    fields.append("updatedAt=?")
    params.append(_now_iso())
    params.extend([sequence_id, uid])
    with _conn() as conn:
        cur = conn.execute(
            f"UPDATE push_sequences SET {', '.join(fields)} WHERE id=? AND owner_id=?",
            params,
        )
        conn.commit()
        return cur.rowcount > 0


def delete_sequence(uid: int, sequence_id: int) -> bool:
    """Supprime une séquence et toutes ses enrollments (ON DELETE CASCADE)."""
    with _conn() as conn:
        cur = conn.execute(
            "DELETE FROM push_sequences WHERE id=? AND owner_id=? AND is_default=0",
            (sequence_id, uid),
        )
        conn.commit()
        return cur.rowcount > 0


def enroll(uid: int, prospect_id: int, sequence_id: int) -> dict:
    """Enrolle un prospect dans une séquence. Refuse si déjà actif sur la même."""
    now = _now_iso()
    with _conn() as conn:
        prospect = conn.execute(
            "SELECT id FROM prospects WHERE id=? AND owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='')",
            (prospect_id, uid),
        ).fetchone()
        if not prospect:
            return {"ok": False, "error": "Prospect introuvable"}
        seq = conn.execute(
            "SELECT id FROM push_sequences WHERE id=? AND owner_id=? AND is_active=1",
            (sequence_id, uid),
        ).fetchone()
        if not seq:
            return {"ok": False, "error": "Séquence introuvable"}

        existing = conn.execute(
            """SELECT id FROM push_sequence_enrollments
               WHERE prospect_id=? AND sequence_id=? AND owner_id=? AND status='active'""",
            (prospect_id, sequence_id, uid),
        ).fetchone()
        if existing:
            return {"ok": False, "error": "Prospect déjà actif sur cette séquence",
                    "enrollment_id": existing["id"]}

        cur = conn.execute(
            """INSERT INTO push_sequence_enrollments
               (sequence_id, prospect_id, owner_id, started_at, status,
                completed_steps_json, last_check_at)
               VALUES (?, ?, ?, ?, 'active', '[]', ?)""",
            (sequence_id, prospect_id, uid, now, now),
        )
        conn.commit()
    return {"ok": True, "enrollment_id": int(cur.lastrowid)}


def _push_signals_for(conn, prospect_id: int, started_at: str) -> dict:
    """Vérifie sur les push_logs s'il y a eu ouverture / réponse depuis started_at."""
    rows = conn.execute(
        """SELECT opened_at, replied_at, sentAt FROM push_logs
           WHERE prospect_id=? AND sentAt >= ?""",
        (prospect_id, started_at),
    ).fetchall()
    has_opened = any((r["opened_at"] or "").strip() for r in rows)
    has_replied = any((r["replied_at"] or "").strip() for r in rows)
    return {"has_opened": has_opened, "has_replied": has_replied,
            "n_pushes": len(rows)}


def _condition_met(condition: str, signals: dict) -> bool:
    if condition == "always":
        return True
    if condition == "if_not_opened":
        return not signals.get("has_opened")
    if condition == "if_not_replied":
        return not signals.get("has_replied")
    return False


def evaluate_due_steps(uid: int) -> list[dict]:
    """Retourne la liste des étapes dues pour les enrollments actifs.

    Une étape est due si :
    - elle n'a pas encore été marquée complete
    - son day_offset est atteint (now - started_at >= day_offset jours)
    - sa condition est satisfaite
    - (auto-pause appliqué AVANT : si réponse reçue, l'enrollment est paused)
    """
    today = datetime.date.today()
    today_iso = today.isoformat()
    items: list[dict] = []

    with _conn() as conn:
        enrollments = conn.execute(
            """SELECT e.id, e.sequence_id, e.prospect_id, e.started_at,
                      e.completed_steps_json,
                      s.name AS sequence_name, s.steps_json,
                      p.name AS prospect_name, p.email, p.telephone, p.linkedin,
                      p.fonction, p.statut,
                      c.groupe AS company_groupe, c.site AS company_site
               FROM push_sequence_enrollments e
               JOIN push_sequences s ON s.id=e.sequence_id AND s.owner_id=?
               JOIN prospects p ON p.id=e.prospect_id AND p.owner_id=?
               LEFT JOIN companies c ON c.id=p.company_id AND c.owner_id=?
               WHERE e.owner_id=? AND e.status='active'
                 AND (p.deleted_at IS NULL OR p.deleted_at='')
                 AND (p.is_archived IS NULL OR p.is_archived=0)""",
            (uid, uid, uid, uid),
        ).fetchall()

        for e in enrollments:
            d = dict(e)
            try:
                steps = json.loads(d.get("steps_json") or "[]")
                completed = set(json.loads(d.get("completed_steps_json") or "[]"))
            except (json.JSONDecodeError, TypeError):
                continue
            started_at = (d.get("started_at") or "")[:10]
            try:
                started_d = datetime.date.fromisoformat(started_at)
            except (ValueError, TypeError):
                continue
            days_since = (today - started_d).days

            signals = _push_signals_for(conn, d["prospect_id"], d.get("started_at") or "")

            for idx, step in enumerate(steps):
                if idx in completed:
                    continue
                if step.get("day_offset", 0) > days_since:
                    continue
                if not _condition_met(step.get("condition", "always"), signals):
                    continue
                items.append({
                    "enrollment_id": d["id"],
                    "sequence_id": d["sequence_id"],
                    "sequence_name": d["sequence_name"],
                    "step_index": idx,
                    "step": step,
                    "prospect": {
                        "id": d["prospect_id"],
                        "name": d.get("prospect_name") or "",
                        "fonction": d.get("fonction") or "",
                        "email": d.get("email") or "",
                        "telephone": d.get("telephone") or "",
                        "linkedin": d.get("linkedin") or "",
                        "statut": d.get("statut") or "",
                        "company_name": d.get("company_groupe") or d.get("company_site") or "",
                    },
                    "due_since_days": days_since - step.get("day_offset", 0),
                })

        # update last_check_at pour les enrollments scannés
        if enrollments:
            conn.execute(
                "UPDATE push_sequence_enrollments SET last_check_at=? "
                "WHERE owner_id=? AND status='active'",
                (_now_iso(), uid),
            )
            conn.commit()

    items.sort(key=lambda x: (-x["due_since_days"], x["step_index"]))
    return items


def auto_pause_replied(uid: int) -> int:
    """Auto-pause les enrollments dont le prospect a répondu depuis started_at.

    Retourne le nombre d'enrollments pausés.
    """
    paused = 0
    now = _now_iso()
    with _conn() as conn:
        enrollments = conn.execute(
            """SELECT e.id, e.prospect_id, e.started_at
               FROM push_sequence_enrollments e
               WHERE e.owner_id=? AND e.status='active'""",
            (uid,),
        ).fetchall()
        for e in enrollments:
            replied = conn.execute(
                """SELECT 1 FROM push_logs
                   WHERE prospect_id=? AND replied_at IS NOT NULL AND replied_at != ''
                     AND replied_at >= ?
                   LIMIT 1""",
                (e["prospect_id"], e["started_at"]),
            ).fetchone()
            if replied:
                conn.execute(
                    """UPDATE push_sequence_enrollments
                       SET status='paused', paused_at=?, paused_reason='Réponse reçue'
                       WHERE id=?""",
                    (now, e["id"]),
                )
                paused += 1
        if paused:
            conn.commit()
    return paused


def mark_step_complete(uid: int, enrollment_id: int, step_index: int) -> dict:
    """Marque une étape comme exécutée. Si toutes les étapes sont faites,
    passe l'enrollment à 'done'."""
    now = _now_iso()
    with _conn() as conn:
        row = conn.execute(
            """SELECT e.id, e.completed_steps_json, s.steps_json
               FROM push_sequence_enrollments e
               JOIN push_sequences s ON s.id=e.sequence_id
               WHERE e.id=? AND e.owner_id=? AND e.status='active'""",
            (enrollment_id, uid),
        ).fetchone()
        if not row:
            return {"ok": False, "error": "Enrollment introuvable"}
        try:
            steps = json.loads(row["steps_json"] or "[]")
            completed = json.loads(row["completed_steps_json"] or "[]")
        except (json.JSONDecodeError, TypeError):
            return {"ok": False, "error": "Données corrompues"}
        if step_index < 0 or step_index >= len(steps):
            return {"ok": False, "error": "step_index hors limites"}
        if step_index in completed:
            return {"ok": False, "error": "Étape déjà complétée"}

        completed.append(step_index)
        completed.sort()
        all_done = len(completed) == len(steps)
        new_status = "done" if all_done else "active"
        conn.execute(
            """UPDATE push_sequence_enrollments
               SET completed_steps_json=?, status=?, last_check_at=?
               WHERE id=?""",
            (json.dumps(completed), new_status, now, enrollment_id),
        )
        conn.commit()
    return {"ok": True, "completed_count": len(completed), "all_done": all_done}


def update_enrollment_status(uid: int, enrollment_id: int, status: str,
                              reason: str | None = None) -> bool:
    if status not in VALID_STATUSES:
        return False
    now = _now_iso()
    with _conn() as conn:
        cur = conn.execute(
            """UPDATE push_sequence_enrollments
               SET status=?, paused_at=?, paused_reason=?
               WHERE id=? AND owner_id=?""",
            (status, now if status == "paused" else None,
             (reason or "")[:200] if status == "paused" else None,
             enrollment_id, uid),
        )
        conn.commit()
        return cur.rowcount > 0


def list_enrollments(uid: int, status: str | None = None) -> list[dict]:
    """Liste les enrollments de l'user (filtrable par status)."""
    sql = """SELECT e.id, e.sequence_id, e.prospect_id, e.started_at, e.status,
                    e.completed_steps_json, e.paused_at, e.paused_reason,
                    s.name AS sequence_name,
                    p.name AS prospect_name,
                    c.groupe AS company_groupe, c.site AS company_site
             FROM push_sequence_enrollments e
             JOIN push_sequences s ON s.id=e.sequence_id AND s.owner_id=?
             JOIN prospects p ON p.id=e.prospect_id
             LEFT JOIN companies c ON c.id=p.company_id AND c.owner_id=?
             WHERE e.owner_id=?
               AND (p.deleted_at IS NULL OR p.deleted_at='')"""
    params: list[Any] = [uid, uid, uid]
    if status and status in VALID_STATUSES:
        sql += " AND e.status=?"
        params.append(status)
    sql += " ORDER BY e.started_at DESC LIMIT 200"
    with _conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["completed_steps"] = json.loads(d.pop("completed_steps_json") or "[]")
        except (json.JSONDecodeError, TypeError):
            d["completed_steps"] = []
        d["company_name"] = d.pop("company_groupe", "") or d.pop("company_site", "")
        out.append(d)
    return out
