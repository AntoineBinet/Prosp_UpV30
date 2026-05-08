"""ProspUp — Blueprint Pages (rendu HTML serveur).

Toutes les routes qui rendent un template HTML ou redirigent vers une URL
v30. Aucune logique métier ici — les pages servent une coque, et les
données dynamiques sont chargées côté client via les API JSON.

Phase B — extraction du gros bloc lignes 4273-5068 d'app.py.
"""
from __future__ import annotations

import json

from flask import Blueprint, redirect, render_template, request, session

from app import _audit_log, _static_hashes, log_activity
from config import APP_DIR, APP_VERSION
from utils.auth import _get_current_user, _uid, login_required, role_required
from utils.db import _conn, _sidebar_counts

pages_bp = Blueprint("pages", __name__)


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
    return render_template(
        "v30/focus.html",
        active="focus",
        crumbs=["Prosp'Up", "Focus"],
        counts=_sidebar_counts(),
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

    return render_template(
        "v30/candidate_detail.html",
        active="candidats",
        crumbs=[
            {"label": "Prosp'Up", "href": "/v30/dashboard"},
            {"label": "Candidats", "href": "/v30/sourcing"},
            row["name"] or "Fiche",
        ],
        counts=_sidebar_counts(),
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
    return render_template(
        "v30/stats.html",
        active="stats",
        crumbs=["Prosp'Up", "Stats & Rapport"],
        counts=_sidebar_counts(),
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
    return render_template(
        "v30/sourcing.html",
        active="candidats",
        crumbs=["Prosp'Up", "Candidats"],
        counts=_sidebar_counts(),
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
    return render_template(
        "v30/push.html",
        active="push",
        crumbs=["Prosp'Up", "Push"],
        counts=_sidebar_counts(),
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
    return render_template(
        "v30/entreprises.html",
        active="entreprises",
        crumbs=["Prosp'Up", "Entreprises"],
        counts=_sidebar_counts(),
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

    return render_template(
        "v30/prospect_detail.html",
        active="prospects",
        crumbs=[
            {"label": "Prosp'Up", "href": "/v30/dashboard"},
            {"label": "Prospects", "href": "/v30/prospects"},
            row["name"] or "Fiche",
        ],
        counts=_sidebar_counts(),
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

    return render_template(
        "v30/prospects.html",
        active="prospects",
        crumbs=["Prosp'Up", "Prospects"],
        counts=_sidebar_counts(),
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

    return render_template(
        "v30/dashboard.html",
        active="dashboard",
        crumbs=["Prosp'Up", "Dashboard"],
        counts=_sidebar_counts(),
        pinned=[],
        user_initials=user_initials,
        display_name=display_name,
        app_version=APP_VERSION,
    )


@pages_bp.get("/v30/validation-checklist")
@login_required
@role_required('admin')
def page_v30_validation_checklist():
    """Checklist interactive de validation post-merge (admin uniquement).

    Page autonome (sans chrome v30) ouverte dans un nouvel onglet depuis la
    popup de mise à jour. Persiste l'état en localStorage et exporte un
    fichier markdown avec un prompt prêt à coller dans une nouvelle session
    Claude pour corriger les échecs.
    """
    return render_template("v30/validation_checklist.html", app_version=APP_VERSION)


def _build_sitemap_data(is_admin: bool) -> dict:
    """Construit la structure de données pour la toile d'araignée.

    Renvoie un dict avec :
      - root : nœud Connexion (point d'entrée)
      - categories : 5 catégories (navigate, records, outils, admin, autres)
      - pages : 21 pages avec leurs actions (filtré selon le rôle)

    Garder synchro avec templates/_partials/v30/sidebar.html et la cartographie
    des features (voir /docs/AUDIT_UI_NAVIGATION.md).
    """
    pages: list[dict] = [
        # ─── NAVIGATE ──────────────────────────────────────────
        {
            "id": "dashboard", "label": "Dashboard", "cat": "navigate",
            "icon": "🏠", "href": "/v30/dashboard", "isHub": True,
            "summary": "KPI du jour, pipeline, priorités IA, action center.",
            "actions": [
                {"label": "Ajouter un KPI manuel", "href": "/v30/parametres#kpi"},
                {"label": "Action center", "href": "/v30/dashboard#actions"},
                {"label": "Priorités IA", "href": "/v30/dashboard#priorities"},
                {"label": "Pipeline visuel", "href": "/v30/dashboard#pipeline"},
                {"label": "Tâches du jour", "href": "/v30/focus"},
                {"label": "Performance hebdo", "href": "/v30/stats"},
            ],
        },
        {
            "id": "focus", "label": "Focus", "cat": "navigate",
            "icon": "🎯", "href": "/v30/focus",
            "summary": "Tâches prioritaires et relances classées par urgence.",
            "actions": [
                {"label": "Ajouter une tâche", "href": "/v30/focus"},
                {"label": "Relances en retard", "href": "/v30/focus#late"},
                {"label": "Marquer fait", "href": "/v30/focus"},
                {"label": "Reporter +1j / +7j", "href": "/v30/focus"},
                {"label": "Filtrer période", "href": "/v30/focus"},
            ],
        },
        {
            "id": "calendar", "label": "Calendrier", "cat": "navigate",
            "icon": "📅", "href": "/v30/calendrier",
            "summary": "RDV, événements et agenda externe (Outlook/Google).",
            "actions": [
                {"label": "Créer un RDV", "href": "/v30/calendrier"},
                {"label": "Vue mois / semaine / jour", "href": "/v30/calendrier"},
                {"label": "Statut RDV", "href": "/v30/calendrier"},
                {"label": "Sync ICS externe", "href": "/v30/parametres#calsync"},
            ],
        },
        {
            "id": "stats", "label": "Stats", "cat": "navigate",
            "icon": "📈", "href": "/v30/stats",
            "summary": "Performance, conversion pipeline, rapports.",
            "actions": [
                {"label": "Plage de dates", "href": "/v30/stats"},
                {"label": "Filtrer statuts/tags", "href": "/v30/stats"},
                {"label": "Export JSON / CSV", "href": "/v30/stats"},
                {"label": "Rapport hebdo / mensuel", "href": "/v30/stats"},
                {"label": "Conversion pipeline", "href": "/v30/stats"},
            ],
        },

        # ─── RECORDS ───────────────────────────────────────────
        {
            "id": "prospects", "label": "Prospects", "cat": "records",
            "icon": "👥", "href": "/v30/prospects",
            "summary": "Base de prospects — 3 vues, filtres, bulk actions.",
            "actions": [
                {"label": "Importer Excel", "href": "/v30/prospects#import"},
                {"label": "Ajouter (manuel)", "href": "/v30/prospects#add"},
                {"label": "Ajouter (IA)", "href": "/v30/prospects#add-ai"},
                {"label": "Scrapping IA", "href": "/v30/prospects#ia"},
                {"label": "Email IA / Tel IA", "href": "/v30/prospects#bulk-ia"},
                {"label": "Avant/Après réunion IA", "href": "/v30/prospects#meeting"},
                {"label": "Modifier en masse", "href": "/v30/prospects#bulk"},
                {"label": "Géocoder en masse", "href": "/v30/carte"},
                {"label": "Archiver", "href": "/v30/prospects/archives"},
                {"label": "Supprimer", "href": "/v30/prospects"},
                {"label": "Exporter VCF", "href": "/v30/prospects"},
                {"label": "Mode Prosp (deck)", "href": "/v30/mode-prosp"},
            ],
        },
        {
            "id": "entreprises", "label": "Entreprises", "cat": "records",
            "icon": "🏢", "href": "/v30/entreprises",
            "summary": "Portefeuille client, fiches détaillées, fusion.",
            "actions": [
                {"label": "Ajouter une entreprise", "href": "/v30/entreprises"},
                {"label": "Éditer fiche", "href": "/v30/entreprises"},
                {"label": "Fusionner deux entreprises", "href": "/v30/duplicates"},
                {"label": "Filtrer", "href": "/v30/entreprises"},
                {"label": "Exporter la liste", "href": "/v30/entreprises"},
                {"label": "Vue liste / cartes", "href": "/v30/entreprises"},
            ],
        },
        {
            "id": "candidats", "label": "Candidats", "cat": "records",
            "icon": "👤", "href": "/v30/sourcing",
            "summary": "Sourcing — pipeline 5 colonnes, statuts, skills.",
            "actions": [
                {"label": "Ajouter un candidat", "href": "/v30/sourcing"},
                {"label": "Importer CV (PDF)", "href": "/v30/sourcing"},
                {"label": "Importer JSON IA", "href": "/v30/sourcing"},
                {"label": "Filtrer (statut/skills)", "href": "/v30/sourcing"},
                {"label": "Enregistrer InMail", "href": "/v30/sourcing"},
                {"label": "Vue Pipeline / Liste / Grille", "href": "/v30/sourcing"},
                {"label": "Archiver", "href": "/v30/sourcing"},
            ],
        },

        # ─── OUTILS ────────────────────────────────────────────
        {
            "id": "push", "label": "Push", "cat": "outils",
            "icon": "📨", "href": "/v30/push",
            "summary": "Campagnes email/LinkedIn, templates, historique.",
            "actions": [
                {"label": "Créer une catégorie", "href": "/v30/push"},
                {"label": "Templates email", "href": "/v30/push"},
                {"label": "Suggestions de prospects", "href": "/v30/push"},
                {"label": "Historique des envois", "href": "/v30/push"},
                {"label": "Filtrer par canal", "href": "/v30/push"},
            ],
        },
        {
            "id": "carte", "label": "Carte", "cat": "outils",
            "icon": "🗺️", "href": "/v30/carte",
            "summary": "Cartographie géographique, géocoding bulk, heatmap.",
            "actions": [
                {"label": "Géocoder en masse", "href": "/v30/carte"},
                {"label": "Couches (entreprises, prospects, heatmap)", "href": "/v30/carte"},
                {"label": "Filtrer par statut/pertinence/tag", "href": "/v30/carte"},
                {"label": "Localiser ma position", "href": "/v30/carte"},
                {"label": "Recharger les marqueurs", "href": "/v30/carte"},
            ],
        },
        {
            "id": "transcription", "label": "Transcription", "cat": "outils",
            "icon": "🎙️", "href": "/v30/transcription",
            "summary": "Transcription locale (Whisper) + analyse Claude des réunions.",
            "actions": [
                {"label": "Enregistrer en direct", "href": "/v30/transcription"},
                {"label": "Importer audio (mp3, wav, m4a…)", "href": "/v30/transcription"},
                {"label": "Importer résumé PDF", "href": "/v30/transcription"},
                {"label": "Analyser (Claude API)", "href": "/v30/transcription"},
                {"label": "Identifier les participants", "href": "/v30/transcription"},
            ],
        },
        {
            "id": "besoins", "label": "Besoins", "cat": "outils",
            "icon": "📋", "href": "/v30/besoins",
            "summary": "Fiches de besoin client, suivi des candidats matchés.",
            "actions": [
                {"label": "Créer un besoin", "href": "/v30/besoins"},
                {"label": "Importer Excel besoins", "href": "/v30/besoins"},
                {"label": "Filtrer par statut", "href": "/v30/besoins"},
                {"label": "Éditer fiche besoin", "href": "/v30/besoins"},
            ],
        },
        {
            "id": "collab", "label": "Collaboration", "cat": "outils",
            "icon": "🤝", "href": "/v30/collab",
            "summary": "Partage d'entreprises et de prospects entre coéquipiers.",
            "actions": [
                {"label": "Partager une entreprise", "href": "/v30/collab"},
                {"label": "Mes partages (envoyés)", "href": "/v30/collab"},
                {"label": "Reçus (collaborateurs → moi)", "href": "/v30/collab"},
                {"label": "Éditer un prospect partagé", "href": "/v30/collab"},
            ],
        },
        {
            "id": "duplicates", "label": "Doublons", "cat": "outils",
            "icon": "🧹", "href": "/v30/duplicates",
            "summary": "Détection et fusion des doublons (similarité configurable).",
            "actions": [
                {"label": "Scanner les doublons", "href": "/v30/duplicates"},
                {"label": "Régler le seuil de similarité", "href": "/v30/duplicates"},
                {"label": "Fusionner prospects", "href": "/v30/duplicates"},
                {"label": "Fusionner entreprises", "href": "/v30/duplicates"},
            ],
        },
        {
            "id": "dc", "label": "DC Generator", "cat": "outils",
            "icon": "📑", "href": "/v30/dc",
            "summary": "Dossier de compétence — DOCX structuré à partir d'un CV.",
            "actions": [
                {"label": "Sélectionner un candidat", "href": "/v30/dc"},
                {"label": "Uploader le CV (PDF/DOCX)", "href": "/v30/dc"},
                {"label": "Données entretien", "href": "/v30/dc"},
                {"label": "Générer le DC (IA)", "href": "/v30/dc"},
                {"label": "Télécharger DOCX", "href": "/v30/dc"},
            ],
        },

        # ─── ADMIN ─────────────────────────────────────────────
        {
            "id": "users", "label": "Utilisateurs", "cat": "admin",
            "icon": "👥", "href": "/v30/users", "adminOnly": True,
            "summary": "Gestion comptes, rôles, derniers logins.",
            "actions": [
                {"label": "Créer un utilisateur", "href": "/v30/users"},
                {"label": "Éditer rôle (éditeur/admin)", "href": "/v30/users"},
                {"label": "Réinitialiser mot de passe", "href": "/v30/users"},
                {"label": "Supprimer utilisateur", "href": "/v30/users"},
                {"label": "Historique des logins", "href": "/v30/users"},
            ],
        },
        {
            "id": "snapshots", "label": "Snapshots", "cat": "admin",
            "icon": "💾", "href": "/v30/snapshots",
            "summary": "Sauvegardes de la base SQLite (auto 3h00 + manuels).",
            "actions": [
                {"label": "Créer un snapshot", "href": "/v30/snapshots"},
                {"label": "Lister les snapshots", "href": "/v30/snapshots"},
                {"label": "Restaurer une sauvegarde", "href": "/v30/snapshots"},
            ],
        },
        {
            "id": "activity", "label": "Journal", "cat": "admin",
            "icon": "📜", "href": "/v30/activity", "adminOnly": True,
            "summary": "Audit — login, modifications, push, suppressions.",
            "actions": [
                {"label": "Filtrer par utilisateur", "href": "/v30/activity"},
                {"label": "Filtrer par action", "href": "/v30/activity"},
                {"label": "Pagination", "href": "/v30/activity"},
            ],
        },
        {
            "id": "metiers", "label": "Métiers IA", "cat": "admin",
            "icon": "🧠", "href": "/v30/metiers",
            "summary": "Référentiel métiers — spécialités, certifs, salaires.",
            "actions": [
                {"label": "Rechercher un métier", "href": "/v30/metiers"},
                {"label": "Filtrer par domaine", "href": "/v30/metiers"},
                {"label": "Voir le détail (skills, salaire)", "href": "/v30/metiers"},
                {"label": "Ajouter un métier (admin)", "href": "/v30/metiers"},
                {"label": "Exporter JSON", "href": "/v30/metiers"},
            ],
        },

        # ─── AUTRES ────────────────────────────────────────────
        {
            "id": "help", "label": "Aide", "cat": "autres",
            "icon": "💡", "href": "/v30/help",
            "summary": "Centre d'aide — démarrage, workflows, raccourcis clavier.",
            "actions": [
                {"label": "Raccourcis clavier", "href": "/v30/help#shortcuts"},
                {"label": "Démarrage rapide", "href": "/v30/help#start"},
                {"label": "Workflows métier", "href": "/v30/help"},
            ],
        },
        {
            "id": "mode-prosp", "label": "Mode Prosp", "cat": "autres",
            "icon": "⚡", "href": "/v30/mode-prosp",
            "summary": "Deck plein écran — navigation rapide entre prospects.",
            "actions": [
                {"label": "Précédent / Suivant (← →)", "href": "/v30/mode-prosp"},
                {"label": "Appeler (C)", "href": "/v30/mode-prosp"},
                {"label": "Email (M)", "href": "/v30/mode-prosp"},
                {"label": "LinkedIn (L)", "href": "/v30/mode-prosp"},
                {"label": "Demander à l'IA (I)", "href": "/v30/mode-prosp"},
                {"label": "Note (N)", "href": "/v30/mode-prosp"},
                {"label": "Changer statut (S)", "href": "/v30/mode-prosp"},
            ],
        },
        {
            "id": "parametres", "label": "Paramètres", "cat": "autres",
            "icon": "⚙️", "href": "/v30/parametres",
            "summary": "IA, objectifs, KPI, notifs, sauvegardes, déploiement.",
            "actions": [
                {"label": "Configuration IA (admin)", "href": "/v30/parametres#ia"},
                {"label": "Objectifs & gamification", "href": "/v30/parametres#goals"},
                {"label": "KPI manuels", "href": "/v30/parametres#kpi"},
                {"label": "Calendrier externe (ICS)", "href": "/v30/parametres#calsync"},
                {"label": "Notifications", "href": "/v30/parametres#notif"},
                {"label": "Snapshots auto", "href": "/v30/parametres#snapshots"},
                {"label": "Mot de passe", "href": "/v30/parametres#account"},
                {"label": "Mise à jour serveur (admin)", "href": "/v30/parametres#deploy"},
                {"label": "Toile d'araignée", "href": "/v30/sitemap"},
            ],
        },
    ]

    # Filtre admin-only si l'utilisateur n'est pas admin
    if not is_admin:
        pages = [p for p in pages if not p.get("adminOnly")]

    return {
        "root": {
            "id": "login",
            "label": "Connexion",
            "icon": "🔐",
            "sub": "Point d'entrée — login@prospup.work",
            "href": "/login",
        },
        "hub": "dashboard",
        "categories": {
            "navigate": {"label": "Navigate", "color": "#2563eb"},
            "records":  {"label": "Records",  "color": "#7c3aed"},
            "outils":   {"label": "Outils",   "color": "#ea580c"},
            "admin":    {"label": "Admin",    "color": "#0891b2"},
            "autres":   {"label": "Autres",   "color": "#475569"},
        },
        "pages": pages,
    }


@pages_bp.get("/v30/sitemap")
@login_required
def page_v30_sitemap():
    """Toile d'araignée des fonctionnalités — page autonome plein écran.

    Vue radiale interactive : Connexion → Dashboard (hub) → 21 pages → ~100
    actions. Ouverte dans un nouvel onglet depuis la card « Toile d'araignée »
    de Paramètres. SVG vectoriel + pan/zoom + tooltip + recherche.
    """
    current_user = _get_current_user() or {}
    is_admin = current_user.get("role") == "admin"
    data = _build_sitemap_data(is_admin=is_admin)
    return render_template(
        "v30/sitemap.html",
        app_version=APP_VERSION,
        sitemap_json=json.dumps(data, ensure_ascii=False),
        is_admin=is_admin,
    )
