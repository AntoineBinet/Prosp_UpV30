"""ProspUp — Blueprint Calendar (RDV / relances / EC1 candidats + ICS externe)."""
from __future__ import annotations

import datetime
import json
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request

from utils.auth import _uid
from utils.db import _conn

calendar_bp = Blueprint("calendar", __name__)


@calendar_bp.get("/api/calendar_events")
def api_calendar_events():
    """Return all dated events for calendar display (prospects + candidats du user)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        prospects = conn.execute(
            """SELECT p.id, p.name, p.statut, p.nextFollowUp, p.rdvDate, p.fonction,
                      c.groupe AS company_groupe, c.site AS company_site
               FROM prospects p
               LEFT JOIN companies c ON c.id = p.company_id AND c.owner_id = ?
               WHERE p.owner_id = ?
                 AND ((p.nextFollowUp IS NOT NULL AND p.nextFollowUp != '')
                  OR (p.rdvDate IS NOT NULL AND p.rdvDate != ''))
            """,
            (uid, uid),
        ).fetchall()

        # Candidate EC1 interviews (v25: candidate_tabs type=ec1)
        cand_ec1 = conn.execute(
            """SELECT c.id, c.name, c.role, json_extract(t.payload, '$.interviewAt') AS interviewAt
               FROM candidates c
               JOIN candidate_tabs t ON t.candidate_id = c.id AND t.type = 'ec1'
               WHERE c.owner_id = ?
                 AND json_extract(t.payload, '$.interviewAt') IS NOT NULL
                 AND json_extract(t.payload, '$.interviewAt') != ''""",
            (uid,),
        ).fetchall()

        # Candidate EC2 (v25.1) — candidats avec status='ec2'
        cand_ec2 = conn.execute(
            """SELECT c.id, c.name, c.role, c.updatedAt,
                      COALESCE(ce.date, c.updatedAt) AS event_date
               FROM candidates c
               LEFT JOIN candidate_events ce ON ce.candidate_id = c.id 
                 AND ce.type = 'candidate_solid'
               WHERE c.owner_id = ?
                 AND c.status = 'ec2'
                 AND (ce.date IS NOT NULL OR c.updatedAt IS NOT NULL)""",
            (uid,),
        ).fetchall()

    events = []
    # Prospects
    for p in prospects:
        d = dict(p)
        nf = (d.get("nextFollowUp") or "").strip()
        rd = (d.get("rdvDate") or "").strip()
        company = d.get("company_groupe") or d.get("company_site") or ""
        if nf:
            events.append({
                "id": d["id"], "name": d["name"], "company": company,
                "date": nf[:10], "time": nf[11:16] if len(nf) > 10 else "",
                "type": "relance", "statut": d.get("statut", ""),
            })
        if rd:
            events.append({
                "id": d["id"], "name": d["name"], "company": company,
                "date": rd[:10], "time": rd[11:16] if len(rd) > 10 else "",
                "type": "rdv", "statut": d.get("statut", ""),
            })

    # Candidates EC1
    for r in cand_ec1:
        d = dict(r)
        ia = (d.get("interviewAt") or "").strip()
        if not ia:
            continue
        events.append({
            "id": d["id"],
            "name": d.get("name") or "Candidat",
            "company": d.get("role") or "EC1",
            "date": ia[:10],
            "time": ia[11:16] if len(ia) > 10 else "",
            "type": "ec1",
            "statut": "EC1",
            "url": f"/candidat?id={d['id']}&section=ec1",
        })

    # Candidates EC2
    for r in cand_ec2:
        d = dict(r)
        event_date = (d.get("event_date") or "").strip()
        if not event_date:
            continue
        events.append({
            "id": d["id"],
            "name": d.get("name") or "Candidat",
            "company": d.get("role") or "EC2",
            "date": event_date[:10],
            "time": event_date[11:16] if len(event_date) > 10 else "",
            "type": "ec2",
            "statut": "EC2",
            "url": f"/candidat?id={d['id']}",
        })

    # Standalone calendar events (créés depuis l'UI v30)
    try:
        with _conn() as conn:
            custom_rows = conn.execute(
                """SELECT e.id, e.title, e.event_date, e.event_time, e.duration_min,
                          e.location, e.notes, e.status, e.event_type,
                          e.prospect_id, e.candidate_id, e.company_id,
                          p.name AS prospect_name,
                          c.groupe AS company_groupe, c.site AS company_site
                   FROM calendar_events e
                   LEFT JOIN prospects p ON p.id = e.prospect_id AND p.owner_id = e.owner_id
                   LEFT JOIN companies c ON c.id = e.company_id AND c.owner_id = e.owner_id
                   WHERE e.owner_id=? AND e.deleted_at IS NULL""",
                (uid,)
            ).fetchall()
        for r in custom_rows:
            d = dict(r)
            comp = d.get("company_groupe") or d.get("company_site") or ""
            url = ""
            if d.get("prospect_id"):
                url = f"/v30/prospect/{d['prospect_id']}"
            elif d.get("candidate_id"):
                url = f"/v30/candidat/{d['candidate_id']}"
            events.append({
                "id": d["id"],
                "custom_event_id": d["id"],
                "name": d.get("title") or d.get("prospect_name") or "RDV",
                "prospect_id": d.get("prospect_id"),
                "candidate_id": d.get("candidate_id"),
                "company_id": d.get("company_id"),
                "company": comp,
                "date": (d.get("event_date") or "")[:10],
                "time": (d.get("event_time") or "")[:5],
                "type": d.get("event_type") or "rdv",
                "duration": d.get("duration_min") or 60,
                "location": d.get("location") or "",
                "notes": d.get("notes") or "",
                "statut": d.get("status") or "planifie",
                "url": url,
                "source": "custom",
            })
    except Exception as _e:
        logger.warning("api_calendar_events: custom events failed: %s", _e)

    return jsonify(ok=True, events=events)


@calendar_bp.post("/api/calendar_events")
def api_calendar_events_create():
    """Crée un événement de calendrier custom (v30)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    event_date = (payload.get("date") or payload.get("event_date") or "").strip()
    if not title:
        return jsonify(ok=False, error="title requis"), 400
    if not event_date:
        return jsonify(ok=False, error="date requise"), 400
    # Validation simple AAAA-MM-JJ
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", event_date):
        return jsonify(ok=False, error="date invalide (format YYYY-MM-DD)"), 400
    event_time = (payload.get("time") or payload.get("event_time") or "").strip() or None
    if event_time and not re.match(r"^\d{2}:\d{2}(:\d{2})?$", event_time):
        return jsonify(ok=False, error="heure invalide (format HH:MM)"), 400
    duration = payload.get("duration") or payload.get("duration_min")
    try:
        duration = int(duration) if duration not in (None, "") else 60
    except (TypeError, ValueError):
        duration = 60
    location = (payload.get("location") or "").strip() or None
    notes = (payload.get("notes") or "").strip() or None
    status = (payload.get("status") or "planifie").strip()
    if status not in ("planifie", "confirme", "annule", "termine"):
        status = "planifie"
    event_type = (payload.get("event_type") or payload.get("type") or "rdv").strip()
    if event_type not in ("rdv", "relance", "ec1", "ec2", "appel", "autre"):
        event_type = "rdv"
    def _opt_int(v):
        try:
            return int(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None
    prospect_id = _opt_int(payload.get("prospect_id"))
    candidate_id = _opt_int(payload.get("candidate_id"))
    company_id = _opt_int(payload.get("company_id"))
    now = datetime.datetime.now().isoformat()
    with _conn() as conn:
        cur = conn.execute(
            """INSERT INTO calendar_events
               (title, event_date, event_time, duration_min, location, notes, status, event_type,
                prospect_id, candidate_id, company_id, owner_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);""",
            (title, event_date, event_time, duration, location, notes, status, event_type,
             prospect_id, candidate_id, company_id, uid, now, now)
        )
        new_id = cur.lastrowid
        conn.commit()
    return jsonify(ok=True, id=new_id)


@calendar_bp.put("/api/calendar_events/<int:event_id>")
def api_calendar_events_update(event_id):
    """Met à jour un événement custom (les champs fournis uniquement)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    fields = {}
    if "title" in payload:
        t = (payload.get("title") or "").strip()
        if not t:
            return jsonify(ok=False, error="title vide"), 400
        fields["title"] = t
    if "date" in payload or "event_date" in payload:
        d = (payload.get("date") or payload.get("event_date") or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            return jsonify(ok=False, error="date invalide"), 400
        fields["event_date"] = d
    if "time" in payload or "event_time" in payload:
        t2 = (payload.get("time") or payload.get("event_time") or "").strip()
        if t2 and not re.match(r"^\d{2}:\d{2}(:\d{2})?$", t2):
            return jsonify(ok=False, error="heure invalide"), 400
        fields["event_time"] = t2 or None
    if "duration" in payload or "duration_min" in payload:
        try:
            fields["duration_min"] = int(payload.get("duration") or payload.get("duration_min") or 60)
        except (TypeError, ValueError):
            fields["duration_min"] = 60
    if "location" in payload:
        fields["location"] = (payload.get("location") or "").strip() or None
    if "notes" in payload:
        fields["notes"] = (payload.get("notes") or "").strip() or None
    if "status" in payload:
        s = (payload.get("status") or "planifie").strip()
        fields["status"] = s if s in ("planifie", "confirme", "annule", "termine") else "planifie"
    if "event_type" in payload or "type" in payload:
        et = (payload.get("event_type") or payload.get("type") or "rdv").strip()
        fields["event_type"] = et if et in ("rdv", "relance", "ec1", "ec2", "appel", "autre") else "rdv"
    if "prospect_id" in payload:
        try:
            fields["prospect_id"] = int(payload["prospect_id"]) if payload["prospect_id"] not in (None, "") else None
        except (TypeError, ValueError):
            fields["prospect_id"] = None
    if "candidate_id" in payload:
        try:
            fields["candidate_id"] = int(payload["candidate_id"]) if payload["candidate_id"] not in (None, "") else None
        except (TypeError, ValueError):
            fields["candidate_id"] = None
    if "company_id" in payload:
        try:
            fields["company_id"] = int(payload["company_id"]) if payload["company_id"] not in (None, "") else None
        except (TypeError, ValueError):
            fields["company_id"] = None
    if not fields:
        return jsonify(ok=False, error="aucun champ à mettre à jour"), 400
    fields["updated_at"] = datetime.datetime.now().isoformat()
    cols = ", ".join(f"{k}=?" for k in fields)
    params = list(fields.values()) + [event_id, uid]
    with _conn() as conn:
        cur = conn.execute(
            f"UPDATE calendar_events SET {cols} WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            tuple(params)
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify(ok=False, error="not_found"), 404
    return jsonify(ok=True, id=event_id)


@calendar_bp.delete("/api/calendar_events/<int:event_id>")
def api_calendar_events_delete(event_id):
    """Soft delete d'un événement custom."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    now = datetime.datetime.now().isoformat()
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE calendar_events SET deleted_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL;",
            (now, event_id, uid)
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify(ok=False, error="not_found"), 404
    return jsonify(ok=True, id=event_id)


def _parse_ics_to_events(ics_text: str) -> List[Dict[str, Any]]:
    """Parse ICS text and return list of events { date, time, name, teams_url, event_url }."""
    events = []
    if not ics_text or "BEGIN:VEVENT" not in ics_text:
        return events
    blocks = ics_text.split("BEGIN:VEVENT")
    for block in blocks[1:]:
        part = block.split("END:VEVENT")[0]
        # Unfold ICS lines (RFC 5545: CRLF + whitespace = continuation)
        unfolded = re.sub(r"\r?\n[ \t]", "", part)
        summary = ""
        start_date = ""
        start_time = ""
        teams_url = ""
        event_url = ""

        summary_m = re.search(r"SUMMARY[^:]*:(.*?)(?:\r?\n(?!\s))", part, re.DOTALL)
        if summary_m:
            summary = re.sub(r"\r?\n\s+", "", summary_m.group(1)).strip()

        start_m = re.search(r"DTSTART[^:]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?", part)
        if start_m:
            start_date = f"{start_m.group(1)}-{start_m.group(2)}-{start_m.group(3)}"
            if start_m.group(4):
                start_time = f"{start_m.group(4)}:{start_m.group(5) or '00'}"

        # Teams meeting URL (proprietary Microsoft fields, unfolded)
        teams_m = re.search(
            r"X-MICROSOFT-(?:SKYPETEAMSMEETINGURL|ONLINEMEETINGURL)[^:]*:(https://teams\.microsoft\.com/\S+)",
            unfolded, re.IGNORECASE,
        )
        if teams_m:
            teams_url = teams_m.group(1).strip()
        if not teams_url:
            # Fallback: search DESCRIPTION for a Teams join URL
            desc_m = re.search(r"DESCRIPTION[^:]*:(.*?)(?=\r?\n[A-Z])", unfolded, re.DOTALL)
            if desc_m:
                t_url = re.search(r"https://teams\.microsoft\.com/l/meetup-join/\S+", desc_m.group(1))
                if t_url:
                    teams_url = t_url.group(0).rstrip("\\>").strip()

        # Generic URL field
        url_m = re.search(r"^URL[^:]*:(.+)$", unfolded, re.MULTILINE)
        if url_m:
            event_url = url_m.group(1).strip()

        # Duration from DTEND (in minutes)
        duration = 60
        end_m = re.search(r"DTEND[^:]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?", unfolded)
        if end_m and start_time and end_m.group(4):
            end_mins = int(end_m.group(4)) * 60 + int(end_m.group(5) or 0)
            start_mins = int(start_time[:2]) * 60 + int(start_time[3:5])
            d_mins = end_mins - start_mins
            if d_mins > 0:
                duration = d_mins

        if start_date and summary:
            events.append({
                "date": start_date, "time": start_time, "name": summary,
                "teams_url": teams_url, "event_url": event_url, "duration": duration,
            })
    return events


@calendar_bp.get("/api/calendar_events_external")
def api_calendar_events_external():
    """Fetch an external .ics URL (Outlook/Google) and return events. Avoids CORS."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    url = (request.args.get("url") or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        return jsonify(ok=False, error="URL invalide"), 400
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Prosp'Up/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            ics_text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return jsonify(ok=False, error=f"HTTP {e.code}"), 502
    except urllib.error.URLError as e:
        return jsonify(ok=False, error=str(e.reason) if getattr(e, "reason", None) else "Erreur réseau"), 502
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 502
    raw = _parse_ics_to_events(ics_text)
    events = [
        {
            "id": None, "name": e["name"], "company": "", "date": e["date"],
            "time": e.get("time") or "", "type": "external", "statut": "",
            "url": e.get("event_url") or "",
            "teams_url": e.get("teams_url") or "",
            "duration": e.get("duration") or 60,
        }
        for e in raw
    ]
    return jsonify(ok=True, events=events)
