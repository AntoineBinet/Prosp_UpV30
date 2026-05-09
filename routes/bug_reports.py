"""Bug reporter — signalements UI depuis n'importe quelle page.

Le user déclenche Ctrl+Shift+B → tous les éléments cliquables sont entourés
en pointillés. Cliquer un élément ouvre une modale qui POST /api/bug-reports
avec {url, selector, label, description}. Les bugs ouverts apparaissent
ensuite en rouge sur la toile d'araignée (/v30/sitemap).
"""
from __future__ import annotations

import datetime
import sqlite3

from flask import Blueprint, jsonify, request

from utils.auth import _uid, login_required, role_required
from utils.db import _conn

bug_reports_bp = Blueprint("bug_reports", __name__)


def _ensure_table(conn: sqlite3.Connection) -> None:
    """Crée la table bug_reports si elle n'existe pas (idempotent)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bug_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            url TEXT,
            page_id TEXT,
            action_id TEXT,
            selector TEXT,
            label TEXT,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL,
            resolved_at TEXT
        );
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bug_reports_action ON bug_reports(action_id);")


def _now_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _norm(s: str) -> str:
    """Normalise pour comparer label de bug ↔ label d'action de la toile."""
    if not s:
        return ""
    import unicodedata
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    out = []
    for ch in s:
        out.append(ch if ch.isalnum() or ch == " " else " ")
    return " ".join("".join(out).split())


def _match_action(url: str, label: str) -> tuple[str | None, str | None]:
    """Tente de matcher (url, label) à une action de _build_sitemap_data().

    Retourne (page_id, action_id) ou (None, None) si pas de match.

    Stratégie :
      1. Trouve la page dont le `href` correspond à `url` (par préfixe).
      2. Cherche dans ses actions celle dont le label est le plus proche
         (token-overlap minimum 50 %).
    """
    try:
        from routes.pages import _build_sitemap_data
    except Exception:
        return (None, None)

    try:
        data = _build_sitemap_data(is_admin=True)
    except Exception:
        return (None, None)

    pages = data.get("pages") or []
    norm_url = (url or "").split("?", 1)[0].rstrip("/")

    # 1. Page par href (prefix)
    page = None
    for p in pages:
        href = (p.get("href") or "").rstrip("/")
        if href and (norm_url == href or norm_url.startswith(href + "/")):
            page = p
            break
    if not page:
        # Fallback : page Dashboard
        for p in pages:
            if p.get("id") == "dashboard":
                page = p
                break
    if not page:
        return (None, None)

    # 2. Action par label
    bug_tokens = set(_norm(label).split())
    if not bug_tokens:
        return (page["id"], None)

    best = None
    best_score = 0.0
    for idx, action in enumerate(page.get("actions") or []):
        act_tokens = set(_norm(action.get("label") or "").split())
        if not act_tokens:
            continue
        common = bug_tokens & act_tokens
        score = len(common) / max(len(bug_tokens), 1)
        if score > best_score:
            best_score = score
            best = idx
    if best is not None and best_score >= 0.4:
        return (page["id"], f"{page['id']}__act_{best}")
    return (page["id"], None)


@bug_reports_bp.post("/api/bug-reports")
@login_required
def api_bug_reports_create():
    """Enregistre un signalement de bug.

    Body JSON : {url, selector, label, description?}
    """
    payload = request.get_json(force=True, silent=True) or {}
    url = (payload.get("url") or "").strip()
    selector = (payload.get("selector") or "").strip()
    label = (payload.get("label") or "").strip()
    description = (payload.get("description") or "").strip()

    if not url or not label:
        return jsonify(ok=False, error="url et label requis"), 400
    if len(label) > 500 or len(description) > 4000 or len(selector) > 1000:
        return jsonify(ok=False, error="payload trop long"), 400

    page_id, action_id = _match_action(url, label)

    with _conn() as conn:
        _ensure_table(conn)
        cur = conn.execute(
            """INSERT INTO bug_reports
               (user_id, url, page_id, action_id, selector, label, description, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?);""",
            (_uid(), url, page_id, action_id, selector, label, description, _now_iso()),
        )
        bug_id = cur.lastrowid

    return jsonify(ok=True, id=bug_id, page_id=page_id, action_id=action_id)


@bug_reports_bp.get("/api/bug-reports")
@login_required
def api_bug_reports_list():
    """Liste les signalements (filtre status optionnel : open|fixed|dismissed|all)."""
    status_filter = (request.args.get("status") or "open").strip()
    with _conn() as conn:
        _ensure_table(conn)
        if status_filter == "all":
            rows = conn.execute(
                "SELECT * FROM bug_reports ORDER BY created_at DESC LIMIT 500;"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM bug_reports WHERE status=? ORDER BY created_at DESC LIMIT 500;",
                (status_filter,),
            ).fetchall()
    return jsonify(ok=True, bugs=[dict(r) for r in rows])


@bug_reports_bp.patch("/api/bug-reports/<int:bug_id>")
@login_required
def api_bug_reports_update(bug_id: int):
    """Change le statut d'un bug (fixed/dismissed/open) ou édite la description."""
    payload = request.get_json(force=True, silent=True) or {}
    new_status = (payload.get("status") or "").strip()
    description = payload.get("description")

    if new_status and new_status not in ("open", "fixed", "dismissed"):
        return jsonify(ok=False, error="status invalide"), 400

    fields = []
    params = []
    if new_status:
        fields.append("status=?")
        params.append(new_status)
        if new_status in ("fixed", "dismissed"):
            fields.append("resolved_at=?")
            params.append(_now_iso())
        else:
            fields.append("resolved_at=NULL")
    if description is not None:
        fields.append("description=?")
        params.append(str(description)[:4000])
    if not fields:
        return jsonify(ok=False, error="rien à mettre à jour"), 400

    params.append(bug_id)
    with _conn() as conn:
        _ensure_table(conn)
        conn.execute(f"UPDATE bug_reports SET {', '.join(fields)} WHERE id=?;", params)
    return jsonify(ok=True)


@bug_reports_bp.delete("/api/bug-reports/<int:bug_id>")
@login_required
@role_required("admin")
def api_bug_reports_delete(bug_id: int):
    """Suppression définitive (admin)."""
    with _conn() as conn:
        _ensure_table(conn)
        conn.execute("DELETE FROM bug_reports WHERE id=?;", (bug_id,))
    return jsonify(ok=True)
