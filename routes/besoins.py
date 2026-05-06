"""
ProspUp — Blueprint Traitement Besoin

Pages :
  GET  /v30/besoins                          — Liste des besoins
  GET  /v30/besoins/<id>                     — Détail / édition d'un besoin

API :
  POST   /api/besoins                        — Créer un besoin
  GET    /api/besoins                        — Lister mes besoins (filtre statut)
  GET    /api/besoins/<id>                   — Détail
  PUT    /api/besoins/<id>                   — Mettre à jour
  DELETE /api/besoins/<id>                   — Soft delete
  GET    /api/besoins/<id>/export.xlsx       — Export Excel (format=recto|verso)
"""
from __future__ import annotations

import datetime
import json
import re
from io import BytesIO

from flask import Blueprint, Response, jsonify, render_template, request, send_file

from app import (
    APP_VERSION,
    _conn,
    _get_current_user,
    _uid,
    logger,
)

besoins_bp = Blueprint("besoins", __name__)


STATUTS = ("ouvert", "en_cours", "pourvu", "abandonne")


# ─── Helpers ──────────────────────────────────────────────────────────


def _enrich_candidats(uid: int, candidats: list) -> list:
    """Enrichit chaque entrée candidate avec les infos de la fiche (vsa_url,
    role, location, linkedin, seniority) si `cand_id` est défini.
    Le résultat est exposé sous la clé `_ref` côté front (lecture seule)."""
    if not candidats or not uid:
        return candidats
    cand_ids: list[int] = []
    for c in candidats:
        cid = c.get("cand_id") if isinstance(c, dict) else None
        if cid:
            try:
                cand_ids.append(int(cid))
            except Exception:
                pass
    if not cand_ids:
        return candidats
    placeholders = ",".join("?" * len(cand_ids))
    by_id: dict = {}
    try:
        with _conn() as conn:
            rows = conn.execute(
                f"SELECT id, name, role, location, vsa_url, linkedin, tech, "
                f"seniority, email, phone "
                f"FROM candidates WHERE owner_id=? AND id IN ({placeholders}) "
                f"AND deleted_at IS NULL;",
                (uid, *cand_ids),
            ).fetchall()
            for r in rows:
                by_id[int(r["id"])] = {
                    "id": r["id"],
                    "name": r["name"],
                    "role": r["role"],
                    "location": r["location"],
                    "vsa_url": r["vsa_url"],
                    "linkedin": r["linkedin"],
                    "tech": r["tech"],
                    "seniority": r["seniority"],
                    "email": r["email"],
                    "phone": r["phone"],
                }
    except Exception as e:
        logger.warning("besoins: enrichment failed (%s)", e)
        return candidats
    for c in candidats:
        if not isinstance(c, dict):
            continue
        cid = c.get("cand_id")
        if not cid:
            continue
        try:
            ref = by_id.get(int(cid))
        except Exception:
            ref = None
        if ref:
            c["_ref"] = ref
    return candidats


def _row_to_dict(row, uid: int | None = None) -> dict:
    if row is None:
        return {}
    d = dict(row)
    # Décoder candidats_json
    raw = d.pop("candidats_json", None)
    candidats: list = []
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                candidats = data
        except Exception:
            candidats = []
    if uid is not None:
        candidats = _enrich_candidats(uid, candidats)
    d["candidats"] = candidats
    return d


def _payload_clean(payload: dict) -> dict:
    """Filtre + sanitise un payload de création / update."""
    allowed = {
        "client", "localisation", "contact", "date_appel",
        "intitule", "date_besoin", "duree_mission",
        "descriptif", "competences", "connaissances",
        "experience", "profil_type", "commentaires",
        "statut", "priority",
        "prospect_id", "company_id",
    }
    out: dict = {}
    for k, v in (payload or {}).items():
        if k in allowed:
            if isinstance(v, str):
                v = v.strip()
            out[k] = v
    # Statut : normalisation
    s = out.get("statut")
    if s and s not in STATUTS:
        out["statut"] = "ouvert"
    # IDs : entiers ou None
    for k in ("prospect_id", "company_id", "priority"):
        if k in out:
            v = out[k]
            if v in ("", None):
                out[k] = None
            else:
                try:
                    out[k] = int(v)
                except Exception:
                    out[k] = None
    return out


def _resolve_prospect_context(uid: int, prospect_id: int) -> dict:
    """Retourne un dict {client, contact, company_id, localisation} pré-rempli depuis un prospect."""
    out = {}
    try:
        with _conn() as conn:
            row = conn.execute(
                """
                SELECT p.id, p.name, p.company_id,
                       c.groupe AS company_name,
                       c.city AS company_city,
                       c.country AS company_country
                FROM prospects p
                LEFT JOIN companies c ON c.id = p.company_id
                WHERE p.id=? AND p.owner_id=?
                  AND (p.deleted_at IS NULL OR p.deleted_at='')
                LIMIT 1;
                """,
                (prospect_id, uid),
            ).fetchone()
            if row:
                out["contact"] = row["name"] or ""
                out["client"] = row["company_name"] or ""
                out["company_id"] = row["company_id"]
                loc = " ".join(p for p in [row["company_city"], row["company_country"]] if p).strip()
                if loc:
                    out["localisation"] = loc
    except Exception:
        pass
    return out


# ─── Pages ────────────────────────────────────────────────────────────


@besoins_bp.get("/v30/besoins")
def page_besoins_list():
    uid = _uid()
    if not uid:
        return Response(status=302, headers={"Location": "/login"})
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"
    return render_template(
        "v30/besoins.html",
        active="besoins",
        crumbs=["Prosp'Up", "Traitement Besoin"],
        counts={},
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@besoins_bp.get("/v30/besoins/<int:bid>")
def page_besoins_detail(bid: int):
    uid = _uid()
    if not uid:
        return Response(status=302, headers={"Location": "/login"})
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, intitule, client FROM besoins "
            "WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (bid, uid),
        ).fetchone()
    if not row:
        return Response(status=302, headers={"Location": "/v30/besoins"})
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"
    title = (row["intitule"] or "").strip() or (row["client"] or "").strip() or f"Besoin #{bid}"
    return render_template(
        "v30/besoin_detail.html",
        active="besoins",
        crumbs=[
            {"label": "Prosp'Up", "href": "/v30/dashboard"},
            {"label": "Besoins", "href": "/v30/besoins"},
            title,
        ],
        counts={},
        pinned=[],
        user_initials=user_initials,
        besoin_id=bid,
        besoin_title=title,
        app_version=APP_VERSION,
    )


# ─── API ──────────────────────────────────────────────────────────────


@besoins_bp.post("/api/besoins")
def api_create_besoin():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    data = _payload_clean(payload)

    # Préfill depuis prospect_id si fourni et pas de client/contact explicite
    pid = data.get("prospect_id")
    if pid:
        ctx = _resolve_prospect_context(uid, pid)
        for k, v in ctx.items():
            if not data.get(k):
                data[k] = v

    now = datetime.datetime.now().isoformat(timespec="seconds")
    statut = data.get("statut") or "ouvert"
    if statut not in STATUTS:
        statut = "ouvert"

    candidats = payload.get("candidats")
    candidats_json = None
    if isinstance(candidats, list):
        candidats_json = json.dumps(candidats, ensure_ascii=False)

    cols = (
        "client", "localisation", "contact", "date_appel",
        "intitule", "date_besoin", "duree_mission",
        "descriptif", "competences", "connaissances",
        "experience", "profil_type", "commentaires",
        "statut", "priority",
        "candidats_json",
        "prospect_id", "company_id",
        "owner_id", "created_at", "updated_at",
    )
    values = (
        data.get("client") or "",
        data.get("localisation") or "",
        data.get("contact") or "",
        data.get("date_appel") or "",
        data.get("intitule") or "",
        data.get("date_besoin") or "",
        data.get("duree_mission") or "",
        data.get("descriptif") or "",
        data.get("competences") or "",
        data.get("connaissances") or "",
        data.get("experience") or "",
        data.get("profil_type") or "",
        data.get("commentaires") or "",
        statut,
        data.get("priority"),
        candidats_json,
        data.get("prospect_id"),
        data.get("company_id"),
        uid,
        now,
        now,
    )
    placeholders = ",".join("?" * len(cols))
    sql = f"INSERT INTO besoins ({','.join(cols)}) VALUES ({placeholders});"
    with _conn() as conn:
        cur = conn.execute(sql, values)
        bid = cur.lastrowid
        row = conn.execute("SELECT * FROM besoins WHERE id=?", (bid,)).fetchone()
    return jsonify(ok=True, besoin=_row_to_dict(row, uid=uid))


@besoins_bp.get("/api/besoins")
def api_list_besoins():
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    statut = (request.args.get("statut") or "").strip()
    prospect_id = (request.args.get("prospect_id") or "").strip()

    where = ["b.owner_id=?", "(b.deleted_at IS NULL OR b.deleted_at='')"]
    params: list = [uid]
    if statut and statut in STATUTS:
        where.append("b.statut=?")
        params.append(statut)
    if prospect_id:
        try:
            where.append("b.prospect_id=?")
            params.append(int(prospect_id))
        except Exception:
            pass

    sql = (
        "SELECT b.*, p.name AS prospect_name, c.groupe AS company_name "
        "FROM besoins b "
        "LEFT JOIN prospects p ON p.id = b.prospect_id "
        "LEFT JOIN companies c ON c.id = b.company_id "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY b.created_at DESC, b.id DESC LIMIT 500;"
    )
    with _conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    items = []
    for r in rows:
        d = _row_to_dict(r, uid=uid)
        # Stats candidats
        cands = d.get("candidats") or []
        d["candidats_count"] = len(cands)
        items.append(d)
    return jsonify(ok=True, items=items)


@besoins_bp.get("/api/besoins/<int:bid>")
def api_get_besoin(bid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT b.*, p.name AS prospect_name, c.groupe AS company_name "
            "FROM besoins b "
            "LEFT JOIN prospects p ON p.id = b.prospect_id "
            "LEFT JOIN companies c ON c.id = b.company_id "
            "WHERE b.id=? AND b.owner_id=? AND (b.deleted_at IS NULL OR b.deleted_at='') LIMIT 1;",
            (bid, uid),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Introuvable"), 404
    return jsonify(ok=True, besoin=_row_to_dict(row, uid=uid))


@besoins_bp.put("/api/besoins/<int:bid>")
def api_update_besoin(bid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    payload = request.get_json(silent=True) or {}
    data = _payload_clean(payload)

    with _conn() as conn:
        existing = conn.execute(
            "SELECT id, client, contact, localisation, company_id "
            "FROM besoins WHERE id=? AND owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
            (bid, uid),
        ).fetchone()
        if not existing:
            return jsonify(ok=False, error="Introuvable"), 404

        # Si on lie un nouveau prospect, pré-remplir les champs vides
        if data.get("prospect_id"):
            ctx = _resolve_prospect_context(uid, data["prospect_id"])
            existing_cols = set(existing.keys())
            for k, v in ctx.items():
                if k in data:
                    continue
                cur_val = existing[k] if k in existing_cols else None
                if isinstance(cur_val, str):
                    is_empty = not cur_val.strip()
                else:
                    is_empty = cur_val is None
                if is_empty:
                    data[k] = v

        sets = []
        values: list = []
        for k, v in data.items():
            sets.append(f"{k}=?")
            values.append(v)

        if "candidats" in payload:
            cands = payload.get("candidats")
            # Nettoie les clés enrichies côté front (lecture seule) avant
            # persistance — `_ref` est rebuilé à chaque GET via JOIN.
            if isinstance(cands, list):
                cleaned = []
                for c in cands:
                    if isinstance(c, dict):
                        cleaned.append({k: v for k, v in c.items() if not k.startswith("_")})
                    else:
                        cleaned.append(c)
                cands = cleaned
            sets.append("candidats_json=?")
            values.append(json.dumps(cands, ensure_ascii=False) if isinstance(cands, list) else None)

        sets.append("updated_at=?")
        values.append(datetime.datetime.now().isoformat(timespec="seconds"))
        values.extend([bid, uid])

        if sets:
            sql = f"UPDATE besoins SET {','.join(sets)} WHERE id=? AND owner_id=?;"
            conn.execute(sql, values)
        row = conn.execute(
            "SELECT b.*, p.name AS prospect_name, c.groupe AS company_name "
            "FROM besoins b "
            "LEFT JOIN prospects p ON p.id = b.prospect_id "
            "LEFT JOIN companies c ON c.id = b.company_id "
            "WHERE b.id=?;",
            (bid,),
        ).fetchone()
    return jsonify(ok=True, besoin=_row_to_dict(row, uid=uid))


@besoins_bp.delete("/api/besoins/<int:bid>")
def api_delete_besoin(bid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE besoins SET deleted_at=? WHERE id=? AND owner_id=? "
            "AND (deleted_at IS NULL OR deleted_at='');",
            (now, bid, uid),
        )
        if cur.rowcount == 0:
            return jsonify(ok=False, error="Introuvable"), 404
    return jsonify(ok=True)


# ─── Export Excel ─────────────────────────────────────────────────────


def _safe_filename(s: str) -> str:
    s = (s or "").strip() or "besoin"
    s = re.sub(r"[^A-Za-z0-9._ -]+", "", s)
    s = re.sub(r"\s+", "_", s)
    return s[:80]


def _build_sheet(ws, b: dict, cands: list):
    """Construit la feuille unique 'recto verso' selon le template Scintil (13 colonnes A-M)."""
    from openpyxl.styles import Alignment, Border, Font, Side

    THIN = Side(border_style="thin", color="000000")
    MED = Side(border_style="medium", color="000000")
    BOLD = Font(name="Calibri", size=11, bold=True)
    REG = Font(name="Calibri", size=11, bold=False)
    CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
    LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)
    WRAP = Alignment(vertical="center", wrap_text=True)

    ws.page_setup.orientation = ws.ORIENTATION_PORTRAIT
    ws.page_setup.paperSize = 9
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = 0.236
    ws.page_margins.right = 0.236
    ws.page_margins.top = 0.354
    ws.page_margins.bottom = 0.354

    widths = {
        "A": 33.1, "B": 33.2, "C": 8.8, "D": 8.4, "E": 8.4,
        "F": 12.2, "G": 16.3, "H": 8.6, "I": 8.8, "J": 27.8,
        "K": 39.9, "L": 31.7, "M": 28.6, "N": 11.4,
    }
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

    for r in (1, 2, 3):
        ws.row_dimensions[r].height = 28.5
    ws.row_dimensions[4].height = 105.6
    ws.row_dimensions[5].height = 63.0
    ws.row_dimensions[6].height = 43.5
    ws.row_dimensions[7].height = 76.8
    ws.row_dimensions[8].height = 43.2
    ws.row_dimensions[9].height = 15.0
    for r in range(10, 63):
        ws.row_dimensions[r].height = 31.5

    # Fusions header
    ws.merge_cells("B1:E1")
    ws.merge_cells("F1:G1")
    ws.merge_cells("H1:J1")
    ws.merge_cells("K1:L1")
    ws.merge_cells("B2:G2")
    ws.merge_cells("I2:J2")
    ws.merge_cells("L2:M2")
    ws.merge_cells("B3:M3")
    ws.merge_cells("B4:M4")
    ws.merge_cells("B5:M5")
    ws.merge_cells("B6:M6")
    ws.merge_cells("B7:F7")
    ws.merge_cells("G7:H7")
    ws.merge_cells("I7:M7")
    ws.merge_cells("B8:M8")

    # Cellules header
    ws["A1"] = "Client";          ws["B1"] = b.get("client") or ""
    ws["F1"] = "Localisation";    ws["H1"] = b.get("localisation") or ""
    ws["K1"] = "Durée mission";   ws["M1"] = b.get("duree_mission") or ""
    ws["A2"] = "Contact";         ws["B2"] = b.get("contact") or ""
    ws["H2"] = "Date appel";      ws["I2"] = b.get("date_appel") or ""
    ws["K2"] = "Date besoin";     ws["L2"] = b.get("date_besoin") or ""
    ws["A3"] = "Besoin";          ws["B3"] = b.get("intitule") or ""
    ws["A4"] = "Descriptif";              ws["B4"] = b.get("descriptif") or ""
    ws["A5"] = "Compétences requises";    ws["B5"] = b.get("competences") or ""
    ws["A6"] = "Connaissances attendues"; ws["B6"] = b.get("connaissances") or ""
    ws["A7"] = "Expérience";      ws["B7"] = b.get("experience") or ""
    ws["G7"] = "Ingénieur et / ou Technicien ?"; ws["I7"] = b.get("profil_type") or ""
    ws["A8"] = "Commentaires";    ws["B8"] = b.get("commentaires") or ""

    # Header candidats (row 9, colonnes A-M)
    headers = ["Candidat", "Commentaires", "Dispo", "Appel", "DT",
               "RDV1", "RDV2", "RT", "Envoi DT", "Propal", "RT",
               "Lieux Habitation", "Diplome"]
    for i, h in enumerate(headers, start=1):
        cell = ws.cell(row=9, column=i, value=h)
        cell.font = BOLD
        cell.alignment = CENTER

    # Données candidats (rows 10-62, 53 lignes, 13 colonnes)
    keys = ["candidat", "commentaires", "dispo", "appel", "dt",
            "rdv1", "rdv2", "rt", "envoi_dt", "propal", "rt_client",
            "lieu_habitation", "diplome"]
    for ri in range(53):
        r = 10 + ri
        c = cands[ri] if ri < len(cands) else {}
        for ci, k in enumerate(keys, start=1):
            ws.cell(row=r, column=ci, value=c.get(k) or "")

    # Bordures (A1:M62)
    for r in range(1, 63):
        for ci in range(1, 14):
            cell = ws.cell(row=r, column=ci)
            top = MED if r == 1 or r == 9 else THIN
            bottom = MED if r == 8 or r == 9 else THIN
            left = MED if ci == 1 else THIN
            right = MED if ci == 13 else THIN
            cell.border = Border(top=top, bottom=bottom, left=left, right=right)
            if r <= 8 and ci == 1:
                cell.font = BOLD
                cell.alignment = WRAP
            elif r == 9:
                cell.font = BOLD
                cell.alignment = CENTER
            elif r <= 8 and ci > 1:
                cell.font = BOLD
                cell.alignment = LEFT
            else:
                cell.font = REG
                cell.alignment = LEFT

    ws.print_area = "A1:M62"


@besoins_bp.get("/api/besoins/<int:bid>/export.xlsx")
def api_export_besoin_xlsx(bid: int):
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _conn() as conn:
        row = conn.execute(
            "SELECT b.*, p.name AS prospect_name, c.groupe AS company_name "
            "FROM besoins b "
            "LEFT JOIN prospects p ON p.id = b.prospect_id "
            "LEFT JOIN companies c ON c.id = b.company_id "
            "WHERE b.id=? AND b.owner_id=? AND (b.deleted_at IS NULL OR b.deleted_at='') LIMIT 1;",
            (bid, uid),
        ).fetchone()
    if not row:
        return jsonify(ok=False, error="Introuvable"), 404

    b = _row_to_dict(row)
    cands = b.get("candidats") or []

    if not b.get("client") and b.get("company_name"):
        b["client"] = b["company_name"]
    if not b.get("contact") and b.get("prospect_name"):
        b["contact"] = b["prospect_name"]

    from openpyxl import Workbook
    wb = Workbook()
    default_ws = wb.active
    wb.remove(default_ws)

    ws = wb.create_sheet(title="recto verso")
    _build_sheet(ws, b, cands)

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    intitule = _safe_filename(b.get("intitule") or b.get("client") or f"besoin_{bid}")
    filename = f"03_traitement_besoin_{intitule}.xlsx"
    return send_file(
        bio,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
