"""ProspUp — Blueprint Pages (rendu HTML serveur).

Toutes les routes qui rendent un template HTML ou redirigent vers une URL
v30. Aucune logique métier ici — les pages servent une coque, et les
données dynamiques sont chargées côté client via les API JSON.

Phase B — extraction du gros bloc lignes 4273-5068 d'app.py.
"""
from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, session

from app import _audit_log, _static_hashes, log_activity
from config import APP_VERSION
from utils.auth import _get_current_user, _uid, login_required, role_required
from utils.db import _conn

pages_bp = Blueprint("pages", __name__)


def _sidebar_counts(uid=None):
    """Retourne le dict counts {prospects, entreprises, candidats} pour la sidebar v30.

    Exclut les prospects supprimés ET archivés (cohérent avec /v30/prospects côté client).
    """
    if not uid:
        uid = _uid()
    if not uid:
        return {}
    try:
        with _conn() as conn:
            return {
                "prospects":  conn.execute(
                    "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='') "
                    "AND (is_archived IS NULL OR is_archived=0);", (uid,)
                ).fetchone()[0],
                "entreprises": conn.execute(
                    "SELECT COUNT(*) FROM companies WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='');", (uid,)
                ).fetchone()[0],
                "candidats":  conn.execute(
                    "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
                ).fetchone()[0],
            }
    except Exception:
        return {}


@pages_bp.get("/")
def home():
    return redirect("/v30/dashboard", code=302)


@pages_bp.get("/entreprises")
def page_entreprises():
    return redirect("/v30/entreprises", code=302)

@pages_bp.get("/company")
def page_company():
    return redirect("/v30/entreprises", code=302)


@pages_bp.get("/parametres")
def page_parametres():
    return redirect("/v30/parametres", code=302)


@pages_bp.get("/sourcing")
def page_sourcing():
    return redirect("/v30/sourcing", code=302)


@pages_bp.get("/candidat")
def page_candidat():
    """Fiche candidat (détail). Migre ?id=X → /v30/candidat/<X>."""
    cid = (request.args.get("id") or "").strip()
    if cid.isdigit():
        return redirect(f"/v30/candidat/{cid}", code=302)
    return redirect("/v30/sourcing", code=302)


@pages_bp.get("/push")
def page_push():
    return redirect("/v30/push", code=302)

@pages_bp.get("/stats")
def page_stats():
    return redirect("/v30/stats", code=302)


@pages_bp.get("/duplicates")
def page_duplicates():
    return redirect("/v30/duplicates", code=302)


@pages_bp.get("/focus")
def page_focus():
    return redirect("/v30/focus", code=302)


@pages_bp.get("/snapshots")
def page_snapshots():
    return redirect("/v30/snapshots", code=302)


@pages_bp.get("/activity")
@login_required
@role_required('admin')
def page_activity():
    return redirect("/v30/activity", code=302)


@pages_bp.get("/help")
def page_help():
    return redirect("/v30/help", code=302)


@pages_bp.get("/aide")
def page_aide():
    return redirect("/v30/help", code=302)


@pages_bp.get("/metiers")
def page_metiers():
    return redirect("/v30/metiers", code=302)


@pages_bp.get("/prospects/mode-prosp")
def page_mode_prosp():
    return redirect("/v30/mode-prosp", code=302)


@pages_bp.get("/v30/mode-prosp")
def page_v30_mode_prosp():
    """v30 : Mode Prosp (deck 3D), layout plein écran sans sidebar.

    Réutilise les APIs /api/mode-prosp/* (start/data/save) et le CSS legacy
    `/static/css/mode-prosp.css` (autonome, pas de dépendance à base.html)."""
    return render_template("v30/mode_prosp.html", static_hashes=_static_hashes)


@pages_bp.get("/v30/preview")
def page_v30_preview():
    """Preview du chrome v30 (topbar + sidebar) + aperçu du design system.
    Voir CHECKLIST.md et update UX web app/handoff/HANDOFF.md."""
    return render_template(
        "v30/preview.html",
        active="dashboard",
        crumbs=["Prosp'Up", "Aperçu v30"],
        counts={"prospects": 1247, "entreprises": 342, "candidats": 89, "focus": 12},
        pinned=[
            {"id": "cap", "label": "Capgemini",    "sub": "12 prospects"},
            {"id": "sfr", "label": "SFR Business", "sub": "4 prospects"},
        ],
        user_initials="AB",
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/login")
def page_v30_login():
    """Preview du login v30 (split 60/40, citation + stats éditoriales).
    Formulaire fonctionnel : POST vers /api/auth/login comme /login."""
    if session.get('user_id'):
        return redirect('/v30/preview')
    return render_template("v30/login.html", app_version=APP_VERSION)


    try:
        with _conn() as conn:
            return {
                "prospects":  conn.execute(
                    "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='') "
                    "AND (is_archived IS NULL OR is_archived=0);", (uid,)
                ).fetchone()[0],
                "entreprises": conn.execute(
                    "SELECT COUNT(*) FROM companies WHERE owner_id=? "
                    "AND (deleted_at IS NULL OR deleted_at='');", (uid,)
                ).fetchone()[0],
                "candidats":  conn.execute(
                    "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
                ).fetchone()[0],
            }
    except Exception:
        return {}


@pages_bp.get("/v30/calendrier")
def page_v30_calendar():
    """Calendrier v30 — grille mois avec RDV / relances / EC1 candidats.
    Hydraté côté client via /api/calendar_events."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    return render_template(
        "v30/calendar.html",
        active="calendar",
        crumbs=["Prosp'Up", "Calendrier"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/focus")
def page_v30_focus():
    """Focus v30 — vue concentration 3 colonnes (overdue / today / upcoming)
    hydratée via /api/dashboard."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
    except Exception:
        pass
    return render_template(
        "v30/focus.html",
        active="focus",
        crumbs=["Prosp'Up", "Focus"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/candidat/<int:cid>")
def page_v30_candidate_detail(cid):
    """Fiche candidat v30 (SPEC §3.8). Rendu serveur minimal ; les
    données (profil + expériences) sont chargées côté client via
    /api/candidates/<id> et /api/candidates/<id>/experiences."""
    uid = _uid()
    if not uid:
        return redirect('/login')
    try:
        with _conn() as conn:
            row = conn.execute(
                "SELECT id, name FROM candidates WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
                (cid, uid),
            ).fetchone()
    except Exception:
        row = None
    if not row:
        return redirect('/v30/sourcing')

    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"

    counts = {}
    try:
        with _conn() as conn:
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}

    return render_template(
        "v30/candidate_detail.html",
        active="candidats",
        crumbs=[
            {"label": "Prosp'Up", "href": "/v30/dashboard"},
            {"label": "Candidats", "href": "/v30/sourcing"},
            row["name"] or "Fiche",
        ],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        candidate_id=cid,
        candidate_name=row["name"] or "",
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/stats")
def page_v30_stats():
    """Stats & Rapport v30 (SPEC §3.9). Topbar + 4 KPI + Top entreprises
    hydratés. Les 8 charts Chart.js et l'éditeur rapport WYSIWYG restent
    sur les routes legacy /stats et /rapport (liens dans les panels)."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}
    return render_template(
        "v30/stats.html",
        active="stats",
        crumbs=["Prosp'Up", "Stats & Rapport"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/collab")
@login_required
def page_v30_collab():
    """Collaboration v30 — hub cartes vers /collab."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/collab.html",
        active="collab",
        crumbs=["Prosp'Up", "Collaboration"],
        counts=_sidebar_counts(), pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/duplicates")
@login_required
def page_v30_duplicates():
    """Doublons v30 — hub cartes vers /duplicates."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/duplicates.html",
        active="duplicates",
        crumbs=["Prosp'Up", "Doublons"],
        counts=_sidebar_counts(), pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/dc")
@pages_bp.get("/v30/dc/<int:cid>")
@login_required
def page_v30_dc(cid: int | None = None):
    """Générateur DC v30 — hub cartes + lien vers /dc_generator."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/dc.html",
        active="dc",
        crumbs=["Prosp'Up", "Dossier de compétence"],
        counts=_sidebar_counts(), pinned=[],
        user_initials=user_initials,
        cid=cid,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/metiers")
@login_required
def page_v30_metiers():
    """Métiers v30 — référentiel ouvert à tous, CRUD custom_metiers réservé admin."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/metiers.html",
        active="metiers",
        crumbs=["Prosp'Up", "Métiers"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        current_user=u,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/help")
def page_v30_help():
    """Aide v30 — cartes vers sections + raccourci pour ouvrir la modal raccourcis."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/help.html",
        active="help",
        crumbs=["Prosp'Up", "Aide"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/snapshots")
@login_required
@role_required('admin')
def page_v30_snapshots():
    """Snapshots DB v30 — admin only, miroir /snapshots."""
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/snapshots.html",
        active="snapshots",
        crumbs=["Prosp'Up", "Snapshots"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/activity")
@login_required
@role_required('admin')
def page_v30_activity():
    """Journal d'activité v30 — admin only, miroir /activity."""
    uid = _uid()
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "AB").strip()
    parts = [p for p in dn.split() if p]
    user_initials = ("".join(p[0].upper() for p in parts[:2]) or dn[:2].upper())
    return render_template(
        "v30/activity.html",
        active="activity",
        crumbs=["Prosp'Up", "Activité"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/parametres")
@login_required
def page_v30_parametres():
    """Paramètres v30 — hub cards + liens vers /parametres#section legacy."""
    uid = _uid()
    current_user = _get_current_user() or {}
    user_initials = "AB"
    if uid:
        dn = (current_user.get("display_name") or current_user.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    return render_template(
        "v30/parametres.html",
        active="parametres",
        crumbs=["Prosp'Up", "Paramètres"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        current_user=current_user,
        app_version=APP_VERSION,
        app_dir=str(APP_DIR),
    )


@pages_bp.get("/v30/users")
@login_required
@role_required('admin')
def page_v30_users():
    """Gestion utilisateurs v30 — admin only, miroir /users."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    return render_template(
        "v30/users.html",
        active="users",
        crumbs=["Prosp'Up", "Utilisateurs"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/rapport")
def page_v30_rapport():
    """Rapport fusionné dans Stats — redirige vers /v30/stats."""
    return redirect("/v30/stats", code=302)


@pages_bp.get("/v30/sourcing")
def page_v30_sourcing():
    """Sourcing v30 (SPEC §3.7). Kanban 5 colonnes par status +
    vue Grille. Hydraté côté client via /api/candidates. Voir
    static/js/v30/sourcing.js."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}
    return render_template(
        "v30/sourcing.html",
        active="candidats",
        crumbs=["Prosp'Up", "Candidats"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/push")
def page_v30_push():
    """Push v30 (SPEC §3.6). Rendu serveur du chrome ; 3 onglets
    (Campagnes / Templates / Historique) hydratés côté client :
    - Campagnes : placeholder — la table push_campaigns (SPEC §5.2)
      n'existe pas encore ; migration à prévoir en accord avec l'utilisateur.
    - Templates : /api/templates
    - Historique : /api/data → push_logs groupés par jour
    Voir static/js/v30/push.js."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}
    return render_template(
        "v30/push.html",
        active="push",
        crumbs=["Prosp'Up", "Push"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/entreprises")
def page_v30_entreprises():
    """Entreprises v30 (SPEC §3.5). Rendu serveur du chrome ; données
    chargées côté client via /api/data (liste companies + prospects),
    agrégation par company_id (total prospects, RDV/propale, gagnés,
    dernier contact) dans static/js/v30/entreprises.js."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);", (uid,)
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');", (uid,)
            ).fetchone()[0]
    except Exception:
        counts = {}
    return render_template(
        "v30/entreprises.html",
        active="entreprises",
        crumbs=["Prosp'Up", "Entreprises"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/prospect/<int:pid>")
def page_v30_prospect_detail(pid):
    """Fiche prospect v30 (SPEC §3.4). Rendu serveur du chrome ;
    les données (prospect + timeline + push logs) sont chargées côté
    client via /api/prospect/timeline. Inline-edit via
    /api/prospects/bulk-edit avec ids=[pid]."""
    uid = _uid()
    if not uid:
        return redirect('/login')
    # Vérifie ownership léger (le endpoint timeline filtre déjà)
    try:
        with _conn() as conn:
            row = conn.execute(
                "SELECT id, name FROM prospects WHERE id=? AND owner_id=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1;",
                (pid, uid),
            ).fetchone()
    except Exception:
        row = None
    if not row:
        # Pas d'accès → retour liste
        return redirect('/v30/prospects')

    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    parts = [p for p in dn.split() if p]
    user_initials = "".join(p[0].upper() for p in parts[:2]) or "AB"

    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);",
                (uid,),
            ).fetchone()[0]
    except Exception:
        counts = {}

    return render_template(
        "v30/prospect_detail.html",
        active="prospects",
        crumbs=[
            {"label": "Prosp'Up", "href": "/v30/dashboard"},
            {"label": "Prospects", "href": "/v30/prospects"},
            row["name"] or "Fiche",
        ],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        prospect_id=pid,
        prospect_name=row["name"] or "",
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/prospects")
def page_v30_prospects():
    """Prospects v30 (SPEC §3.3). Rendu serveur du chrome uniquement ;
    le tableau est hydraté côté client via /api/search (liste + fuzzy)
    et les bulks via /api/prospects/bulk-*. Voir
    static/js/v30/prospects.js."""
    uid = _uid()
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()

    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);",
                (uid,),
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;", (uid,)
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');",
                (uid,),
            ).fetchone()[0]
    except Exception:
        counts = {}

    return render_template(
        "v30/prospects.html",
        active="prospects",
        crumbs=["Prosp'Up", "Prospects"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/prospects/archives")
def page_v30_prospects_archives():
    """BUG 29 : page des prospects archivés. Liste lecture seule avec action
    Désarchiver. Utilise /api/data pour récupérer les archivés côté client."""
    uid = _uid()
    if not uid:
        return redirect('/login')
    user_initials = "AB"
    u = _get_current_user() or {}
    dn = (u.get("display_name") or u.get("username") or "").strip()
    if dn:
        parts = [p for p in dn.split() if p]
        user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()

    counts = _sidebar_counts()
    archived_count = 0
    try:
        with _conn() as conn:
            archived_count = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') AND is_archived=1;",
                (uid,),
            ).fetchone()[0]
    except Exception:
        pass

    return render_template(
        "v30/prospects_archives.html",
        active="prospects",
        crumbs=["Prosp'Up", "Prospects", "Archives"],
        counts=counts,
        archived_count=archived_count,
        pinned=[],
        user_initials=user_initials,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/dashboard")
def page_v30_dashboard():
    """Dashboard v3 (SPEC §3.2). Rendu serveur du chrome + hero ;
    les bloks dynamiques (KPIs, action center, pipeline, objectifs,
    priorités IA, activité) sont peuplés côté client par les
    endpoints existants /api/dashboard, /api/dashboard/pipeline-stages,
    /api/tasks."""
    uid = _uid()
    display_name = ""
    user_initials = "AB"
    if uid:
        u = _get_current_user() or {}
        dn = (u.get("display_name") or u.get("username") or "").strip()
        display_name = dn
        if dn:
            parts = [p for p in dn.split() if p]
            user_initials = "".join(p[0].upper() for p in parts[:2]) or dn[:2].upper()

    # Compteurs sidebar — lightweight; pas fatal si indispo
    counts = {}
    try:
        with _conn() as conn:
            counts["prospects"] = conn.execute(
                "SELECT COUNT(*) FROM prospects WHERE owner_id=? "
                "AND (deleted_at IS NULL OR deleted_at='') "
                "AND (is_archived IS NULL OR is_archived=0);",
                (uid,),
            ).fetchone()[0]
            counts["entreprises"] = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE owner_id=?;",
                (uid,),
            ).fetchone()[0]
            counts["candidats"] = conn.execute(
                "SELECT COUNT(*) FROM candidates WHERE owner_id=? AND (deleted_at IS NULL OR deleted_at='');",
                (uid,),
            ).fetchone()[0]
    except Exception:
        counts = {}

    return render_template(
        "v30/dashboard.html",
        active="dashboard",
        crumbs=["Prosp'Up", "Dashboard"],
        counts=counts,
        pinned=[],
        user_initials=user_initials,
        display_name=display_name,
        app_version=APP_VERSION,
    )
