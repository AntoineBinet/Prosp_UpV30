"""ProspUp — Blueprint Duplicates (détection + merge prospects)."""
from __future__ import annotations

import datetime
import difflib
import json
import re
import unicodedata
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request

from app import _audit_log, log_activity, logger
from routes.dashboard import _norm_phone, _normalize, _split_name_for_dup  # cross-blueprint dep
from utils.auth import _company_owned, _prospect_owned, _uid, role_required
from utils.common import _now_iso
from utils.db import _conn

duplicates_bp = Blueprint("duplicates", __name__)


@duplicates_bp.get("/api/duplicates")
def api_duplicates():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    min_score = request.args.get("min_score", type=float)
    if min_score is None or min_score < 0 or min_score > 1:
        min_score = 0.85
    with _conn() as conn:
        pros = [dict(r) for r in conn.execute(
            "SELECT id, name, email, telephone, linkedin, company_id, COALESCE(is_archived,0) AS is_archived FROM prospects WHERE owner_id=?;", (uid,)
        ).fetchall()]
        comps = {r["id"]: dict(r) for r in conn.execute("SELECT id, groupe, site FROM companies WHERE owner_id=?;", (uid,)).fetchall()}
        ignored_pairs: set[frozenset] = {
            frozenset([r["prospect_id_a"], r["prospect_id_b"]])
            for r in conn.execute(
                "SELECT prospect_id_a, prospect_id_b FROM duplicate_ignores WHERE owner_id=?;", (uid,)
            ).fetchall()
        }

    pros_for_dup = [p for p in pros if not p.get("is_archived")]
    groups = []

    def add_group(kind: str, key: str, ids: List[int], score: float | None = None):
        if len(ids) < 2:
            return
        # Filtrer les paires où TOUTES les combinaisons de 2 sont ignorées
        active_ids = []
        for pid in ids:
            # Garder ce prospect si au moins un autre prospect du groupe n'est pas ignoré avec lui
            has_active_pair = any(
                frozenset([pid, other]) not in ignored_pairs
                for other in ids if other != pid
            )
            if has_active_pair:
                active_ids.append(pid)
        if len(active_ids) < 2:
            return
        items = []
        for pid in active_ids:
            p = next((x for x in pros if x["id"] == pid), None)
            if not p:
                continue
            c = comps.get(p.get("company_id"))
            items.append(
                {
                    "id": p["id"],
                    "name": p.get("name"),
                    "email": p.get("email"),
                    "telephone": p.get("telephone"),
                    "linkedin": p.get("linkedin"),
                    "company": f"{(c.get('groupe') if c else '')} {(c.get('site') if c else '')}".strip(),
                }
            )
        if len(items) < 2:
            return
        g = {"type": kind, "key": key, "items": items}
        if score is not None:
            g["score"] = round(score, 2)
        groups.append(g)

    by_email = {}
    by_link = {}
    by_phone = {}

    for p in pros_for_dup:
        if p.get("email"):
            k = str(p["email"]).strip().lower()
            if k:
                by_email.setdefault(k, []).append(p["id"])
        if p.get("linkedin"):
            k = str(p["linkedin"]).strip().lower()
            if k:
                by_link.setdefault(k, []).append(p["id"])
        if p.get("telephone"):
            k = _norm_phone(str(p["telephone"]))
            if k:
                by_phone.setdefault(k, []).append(p["id"])

    for k, ids in by_email.items():
        add_group("email", k, ids)
    for k, ids in by_link.items():
        add_group("linkedin", k, ids)
    for k, ids in by_phone.items():
        add_group("telephone", k, ids)

    # Prospects déjà dans un groupe exact (email/linkedin/phone)
    in_exact = set()
    for g in groups:
        for it in g.get("items") or []:
            in_exact.add(it["id"])

    # Détection par similarité nom + même entreprise (uniquement parmi les non-contacts)
    by_company: Dict[int, List[Dict[str, Any]]] = {}
    for p in pros_for_dup:
        cid = p.get("company_id")
        if cid is not None:
            by_company.setdefault(int(cid), []).append(p)
    name_pairs: List[tuple[List[int], float]] = []
    for cid, company_pros in by_company.items():
        if len(company_pros) < 2:
            continue
        for i, p1 in enumerate(company_pros):
            ln1, fn1 = _split_name_for_dup(p1.get("name") or "")
            if not ln1:
                continue
            for p2 in company_pros[i + 1 :]:
                ln2, fn2 = _split_name_for_dup(p2.get("name") or "")
                if not ln2:
                    continue
                # Même nom de famille requis (exact, normalisé)
                if ln1 != ln2:
                    continue
                # Même première initiale du prénom requise (si les deux ont un prénom)
                if fn1 and fn2 and fn1[0] != fn2[0]:
                    continue
                # Comparaison complète des prénoms
                if fn1 and fn2:
                    ratio = difflib.SequenceMatcher(None, fn1, fn2).ratio()
                    if ratio < min_score:
                        continue
                else:
                    ratio = 1.0  # Même nom de famille sans prénom → doublon probable
                ids = sorted([p1["id"], p2["id"]])
                name_pairs.append((ids, ratio))
    # Fusionner les paires qui se chevauchent (A-B et B-C → A-B-C)
    merged: Dict[frozenset, float] = {}
    for ids, score in name_pairs:
        s = frozenset(ids)
        merged[s] = max(merged.get(s, 0), score)
    changed = True
    while changed:
        changed = False
        keys = list(merged.keys())
        for i, k1 in enumerate(keys):
            for k2 in keys[i + 1 :]:
                if k1 & k2:
                    new_set = k1 | k2
                    new_score = min(merged[k1], merged[k2])
                    if new_set not in merged or merged[new_set] < new_score:
                        merged[new_set] = max(merged.get(new_set, 0), new_score)
                        merged.pop(k1, None)
                        merged.pop(k2, None)
                        changed = True
                        break
            if changed:
                break
    for ids_set, score in merged.items():
        ids_list = sorted(ids_set)
        if len(ids_list) < 2:
            continue
        if all(pid in in_exact for pid in ids_list):
            continue
        p0 = next((x for x in pros if x["id"] == ids_list[0]), None)
        company_label = "même entreprise"
        if p0 and comps:
            c = comps.get(p0.get("company_id"))
            if c:
                company_label = (c.get("groupe") or "").strip() or "même entreprise"
        add_group("name_company", f"Similarité nom · {company_label}", ids_list, score=score)

    # sort bigger groups first
    groups.sort(key=lambda g: len(g.get("items") or []), reverse=True)
    # companies: duplicates by (groupe, site) — uniquement les miennes
    with _conn() as conn:
        comps = [dict(r) for r in conn.execute("SELECT * FROM companies WHERE owner_id=? ORDER BY id DESC;", (uid,)).fetchall()]

    def _norm(s: str) -> str:
        return _normalize(s or "")

    buckets = {}
    for c in comps:
        k = (_norm(c.get("groupe", "")), _norm(c.get("site", "")))
        buckets.setdefault(k, []).append(c)

    company_groups = []
    for k, lst in buckets.items():
        if len(lst) >= 2 and (k[0] or k[1]):
            company_groups.append({
                "key": f"{k[0]}|{k[1]}",
                "count": len(lst),
                "items": [{"id": x["id"], "groupe": x.get("groupe",""), "site": x.get("site",""), "notes": x.get("notes",""), "tags": x.get("tags", [])} for x in lst]
            })

    return jsonify({"ok": True, "prospect_groups": groups, "company_groups": company_groups})


@duplicates_bp.post("/api/duplicates/ignore")
@role_required('editor')
def api_duplicates_ignore():
    """Marque une paire de prospects comme 'pas un doublon' (persistant).

    Body JSON : { "id_a": int, "id_b": int }
    Les IDs sont triés avant insertion pour garantir l'unicité.
    """
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    try:
        id_a = int(payload["id_a"])
        id_b = int(payload["id_b"])
    except (KeyError, TypeError, ValueError):
        return jsonify(ok=False, error="id_a et id_b requis (entiers)"), 400
    if id_a == id_b:
        return jsonify(ok=False, error="Les deux IDs doivent être différents"), 400
    # Toujours stocker dans l'ordre croissant pour garantir l'unicité
    a, b = sorted([id_a, id_b])
    with _conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO duplicate_ignores (owner_id, prospect_id_a, prospect_id_b) VALUES (?,?,?);",
            (uid, a, b)
        )
    return jsonify(ok=True)


@duplicates_bp.post("/api/prospects/check-duplicates")
def api_prospects_check_duplicates():
    """Compare une liste de prospects (à ajouter) aux prospects déjà en base.
    Retourne les indices des doublons suspects (email, linkedin, téléphone, ou nom+entreprise)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    prospects = payload.get("prospects") or []
    if not isinstance(prospects, list):
        return jsonify(ok=False, error="prospects doit être une liste"), 400
    min_score = payload.get("min_score")
    if min_score is not None:
        try:
            min_score = float(min_score)
            if min_score < 0 or min_score > 1:
                min_score = 0.85
        except (TypeError, ValueError):
            min_score = 0.85
    else:
        min_score = 0.85

    with _conn() as conn:
        existing = [dict(r) for r in conn.execute(
            "SELECT id, name, email, telephone, linkedin, company_id FROM prospects WHERE owner_id=?;",
            (uid,),
        ).fetchall()]

    by_email: Dict[str, int] = {}
    by_link: Dict[str, int] = {}
    by_phone: Dict[str, int] = {}
    for p in existing:
        if p.get("email"):
            k = str(p["email"]).strip().lower()
            if k and k not in by_email:
                by_email[k] = p["id"]
        if p.get("linkedin"):
            k = str(p["linkedin"]).strip().lower()
            if k and k not in by_link:
                by_link[k] = p["id"]
        if p.get("telephone"):
            k = _norm_phone(str(p["telephone"]))
            if k and k not in by_phone:
                by_phone[k] = p["id"]

    by_company: Dict[int, List[Dict[str, Any]]] = {}
    for p in existing:
        cid = p.get("company_id")
        if cid is not None:
            by_company.setdefault(int(cid), []).append(p)

    duplicate_indexes: List[Dict[str, Any]] = []
    for idx, inc in enumerate(prospects):
        if not isinstance(inc, dict):
            continue
        existing_id = None
        reason = None
        if inc.get("email"):
            k = str(inc["email"]).strip().lower()
            if k and k in by_email:
                existing_id = by_email[k]
                reason = "email"
        if not reason and inc.get("linkedin"):
            k = str(inc["linkedin"]).strip().lower()
            if k and k in by_link:
                existing_id = by_link[k]
                reason = "linkedin"
        if not reason and inc.get("telephone"):
            k = _norm_phone(str(inc["telephone"]))
            if k and k in by_phone:
                existing_id = by_phone[k]
                reason = "telephone"
        if not reason and min_score and inc.get("name") and inc.get("company_id") is not None:
            cid = int(inc["company_id"]) if inc["company_id"] is not None else None
            if cid is not None and cid in by_company:
                ln1, fn1 = _split_name_for_dup(inc.get("name") or "")
                if ln1:
                    for p in by_company[cid]:
                        ln2, fn2 = _split_name_for_dup(p.get("name") or "")
                        if not ln2 or ln1 != ln2:
                            continue
                        if fn1 and fn2 and fn1[0] != fn2[0]:
                            continue
                        if fn1 and fn2:
                            if difflib.SequenceMatcher(None, fn1, fn2).ratio() < min_score:
                                continue
                        existing_id = p["id"]
                        reason = "name_company"
                        break
        if existing_id is not None and reason:
            duplicate_indexes.append({"index": idx, "existing_id": existing_id, "reason": reason})

    return jsonify({"ok": True, "duplicate_indexes": duplicate_indexes})


@duplicates_bp.post("/api/prospects/create")
@role_required('editor')
def api_prospect_create():
    """Crée un seul prospect. Retourne l'ID assigné côté serveur.
    Utilise le prochain id disponible côté serveur (MAX(id)+1) pour éviter les collisions
    entre sessions simultanées."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify(ok=False, error="name est requis"), 400

    def _dump_tags(v):
        if v is None:
            return "[]"
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return "[]"
            if s.startswith("["):
                return s
            parts = [t.strip() for t in s.split(",") if t.strip()]
            return json.dumps(parts, ensure_ascii=False)
        if isinstance(v, list):
            return json.dumps([str(t).strip() for t in v if str(t).strip()], ensure_ascii=False)
        return "[]"

    company_id = 0
    company_groupe = (payload.get("company_groupe") or "").strip()
    company_site = (payload.get("company_site") or "").strip()

    conn = _conn()
    try:
        # Résoudre ou créer l'entreprise si fournie
        if payload.get("company_id"):
            try:
                cid = int(payload["company_id"])
                row = conn.execute("SELECT id FROM companies WHERE id=? AND owner_id=?;", (cid, uid)).fetchone()
                if row:
                    company_id = cid
            except Exception:
                pass

        if not company_id and company_groupe:
            row = conn.execute(
                "SELECT id FROM companies WHERE owner_id=? AND LOWER(groupe)=LOWER(?) AND LOWER(COALESCE(site,''))=LOWER(?);",
                (uid, company_groupe, company_site or "")
            ).fetchone()
            if row:
                company_id = int(row["id"])
            else:
                max_co = conn.execute("SELECT COALESCE(MAX(id),0) as m FROM companies;").fetchone()["m"]
                new_co_id = int(max_co) + 1
                conn.execute(
                    "INSERT INTO companies (id, groupe, site, owner_id) VALUES (?,?,?,?);",
                    (new_co_id, company_groupe, company_site or "", uid)
                )
                company_id = new_co_id

        # Pas d'entreprise fournie : tolérer company_id=0 (sentinelle « sans entreprise »
        # historiquement utilisée par l'app — la contrainte FK ne reconnaît pas id=0).
        # On désactive temporairement les FK pour permettre l'INSERT, comme le fait
        # déjà replace_all() pour les imports en masse.
        no_company = (company_id == 0)
        if no_company:
            try:
                conn.execute("PRAGMA foreign_keys = OFF;")
            except Exception:
                pass

        # Générer l'ID côté serveur — MAX global (id est PRIMARY KEY)
        max_p = conn.execute("SELECT COALESCE(MAX(id),0) as m FROM prospects;").fetchone()["m"]
        new_id = int(max_p) + 1
        now = _now_iso()

        conn.execute(
            """INSERT INTO prospects
            (id, name, company_id, fonction, telephone, email, linkedin, pertinence, statut,
             lastContact, notes, callNotes, tags, priority, owner_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);""",
            (
                new_id,
                name,
                company_id,
                (payload.get("fonction") or ""),
                (payload.get("telephone") or ""),
                (payload.get("email") or ""),
                (payload.get("linkedin") or ""),
                payload.get("pertinence") or "",
                payload.get("statut") or "Pas d'actions",
                payload.get("lastContact") or now,
                (payload.get("notes") or ""),
                "[]",
                _dump_tags(payload.get("tags")),
                2,
                uid,
            )
        )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.execute("PRAGMA foreign_keys = ON;")
        except Exception:
            pass
        conn.close()

    return jsonify({"ok": True, "id": new_id, "company_id": company_id})


# Champs prospect fusionnables (pour prévisualisation et choix utilisateur)
MERGEABLE_PROSPECT_FIELDS = [
    "name", "company_id", "fonction", "telephone", "email", "linkedin",
    "pertinence", "statut", "lastContact", "nextFollowUp", "priority",
    "notes", "callNotes", "pushEmailSentAt", "tags", "template_id",
]
# Champs pour lesquels on propose "both" (fusionner les deux)
MERGEABLE_TEXT_APPEND_FIELDS = ("notes", "callNotes", "tags")


@duplicates_bp.get("/api/duplicates/merge-preview")
def api_duplicates_merge_preview():
    """Retourne les deux prospects complets pour afficher la modale de fusion (choix par champ)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    keep_id = request.args.get("keep_id", type=int)
    merge_id = request.args.get("merge_id", type=int)
    if not keep_id or not merge_id or keep_id == merge_id:
        return jsonify({"ok": False, "error": "keep_id and merge_id required"}), 400
    with _conn() as conn:
        k = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (keep_id, uid)).fetchone()
        m = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (merge_id, uid)).fetchone()
        if not k or not m:
            return jsonify({"ok": False, "error": "prospect not found"}), 404
        k = dict(k)
        m = dict(m)
        companies = [dict(r) for r in conn.execute("SELECT id, groupe, site FROM companies WHERE owner_id=?;", (uid,)).fetchall()]
    keep_d = dict(k)
    merge_d = dict(m)
    # Nettoyer pour JSON (dates, None)
    for d in (keep_d, merge_d):
        for key in list(d.keys()):
            if d[key] is None:
                continue
            if hasattr(d[key], "isoformat"):
                d[key] = d[key].isoformat() if d[key] else None
    return jsonify({
        "ok": True,
        "keep": keep_d,
        "merge": merge_d,
        "companies": companies,
        "mergeable_fields": MERGEABLE_PROSPECT_FIELDS,
        "append_fields": list(MERGEABLE_TEXT_APPEND_FIELDS),
    })


@duplicates_bp.post("/api/duplicates/merge")
def api_duplicates_merge():
    payload = request.get_json(force=True, silent=False) or {}
    keep_id = payload.get("keep_id")
    merge_id = payload.get("merge_id")
    choices = payload.get("choices") or {}  # { "name": "keep"|"merge", "notes": "keep"|"merge"|"both", ... }
    if not keep_id or not merge_id:
        return jsonify({"ok": False, "error": "keep_id and merge_id are required"}), 400
    keep_id = int(keep_id)
    merge_id = int(merge_id)
    if keep_id == merge_id:
        return jsonify({"ok": False, "error": "ids must differ"}), 400

    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        k = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (keep_id, uid)).fetchone()
        m = conn.execute("SELECT * FROM prospects WHERE id=? AND owner_id=?;", (merge_id, uid)).fetchone()
        if not k or not m:
            return jsonify({"ok": False, "error": "prospect not found"}), 404
        k = dict(k)
        m = dict(m)

        def pick(a, b):
            return a if (a is not None and str(a).strip()) else b

        def parse_tags(v):
            try:
                j = json.loads(v or "[]")
                if isinstance(j, list):
                    return [str(x).strip() for x in j if str(x).strip()]
            except Exception:
                pass
            return []
        def parse_cn(v):
            try:
                j = json.loads(v or "[]")
                if isinstance(j, list):
                    return j
            except Exception:
                pass
            return []

        merged = {}
        for f in MERGEABLE_PROSPECT_FIELDS:
            choice = (choices.get(f) or "").strip().lower()
            kv = k.get(f)
            mv = m.get(f)
            if f in MERGEABLE_TEXT_APPEND_FIELDS:
                if choice == "both":
                    if f == "tags":
                        merged[f] = json.dumps(sorted(set(parse_tags(k.get("tags")) + parse_tags(m.get("tags")))), ensure_ascii=False)
                    elif f == "callNotes":
                        merged[f] = json.dumps(parse_cn(k.get("callNotes")) + parse_cn(m.get("callNotes")), ensure_ascii=False)
                    else:
                        merged[f] = (str(kv or "") + "\n" + str(mv or "")).strip() or None
                elif choice == "merge":
                    merged[f] = mv if (mv is not None and str(mv).strip()) else kv
                    if f == "tags":
                        merged[f] = json.dumps(parse_tags(merged[f]) if isinstance(merged[f], str) else (merged[f] or "[]"), ensure_ascii=False)
                    elif f == "callNotes":
                        merged[f] = json.dumps(parse_cn(merged[f]) if isinstance(merged[f], str) else (merged[f] or "[]"), ensure_ascii=False)
                else:
                    merged[f] = kv if (kv is not None and str(kv).strip()) else mv
                    if f == "tags":
                        merged[f] = json.dumps(parse_tags(merged[f]) if isinstance(merged[f], str) else (merged[f] or "[]"), ensure_ascii=False)
                    elif f == "callNotes":
                        merged[f] = json.dumps(parse_cn(merged[f]) if isinstance(merged[f], str) else (merged[f] or "[]"), ensure_ascii=False)
            else:
                if choice == "merge":
                    merged[f] = pick(mv, kv)
                else:
                    merged[f] = pick(kv, mv)

        conn.execute(
            '''
            UPDATE prospects
            SET name=?, company_id=?, fonction=?, telephone=?, email=?, linkedin=?, pertinence=?, statut=?, lastContact=?, nextFollowUp=?, priority=?, notes=?, callNotes=?, pushEmailSentAt=?, tags=?, template_id=?
            WHERE id=? AND owner_id=?;
            ''',
            (
                merged["name"],
                merged["company_id"],
                merged["fonction"],
                merged["telephone"],
                merged["email"],
                merged["linkedin"],
                merged["pertinence"],
                merged["statut"],
                merged["lastContact"],
                merged["nextFollowUp"],
                merged["priority"],
                merged["notes"],
                merged["callNotes"],
                merged["pushEmailSentAt"],
                merged["tags"],
                merged["template_id"],
                keep_id,
                uid,
            ),
        )

        conn.execute("UPDATE push_logs SET prospect_id=? WHERE prospect_id=?;", (keep_id, merge_id))
        conn.execute("DELETE FROM prospects WHERE id=? AND owner_id=?;", (merge_id, uid))

    _audit_log("merge_delete", "prospect", merge_id, new_value=str(keep_id))
    return jsonify({"ok": True})

