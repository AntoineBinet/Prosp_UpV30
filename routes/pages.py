"""ProspUp — Blueprint Pages (rendu HTML serveur).

Toutes les routes qui rendent un template HTML v30. Aucune logique métier
ici — les pages servent une coque, et les données dynamiques sont chargées
côté client via les API JSON.
"""
from __future__ import annotations

import json

from flask import Blueprint, redirect, render_template, session

from app import _audit_log, _static_hashes, log_activity
from config import APP_DIR, APP_VERSION
from utils.auth import _get_current_user, _uid, login_required, role_required
from utils.db import _conn, _sidebar_counts

pages_bp = Blueprint("pages", __name__)


@pages_bp.get("/")
def home():
    return redirect("/v30/dashboard", code=302)


@pages_bp.get("/v30/mode-prosp")
def page_v30_mode_prosp():
    """v30 : Mode Prosp (deck 3D), layout plein écran sans sidebar.

    Réutilise les APIs /api/mode-prosp/* (start/data/save) et le CSS
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
    hydratés."""
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
    """Collaboration v30 — hub cartes."""
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
    """Doublons v30 — hub cartes."""
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
    """Générateur DC v30 — hub cartes."""
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
    """Snapshots DB v30 — admin only."""
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
    """Journal d'activité v30 — admin only."""
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
    """Paramètres v30 — hub cards + sections (mise à jour, IA, objectifs, …)."""
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
    """Gestion utilisateurs v30 — admin only."""
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


_STATUS_FILE = APP_DIR / "data" / "sitemap_status.json"


def _load_open_bugs() -> dict:
    """Renvoie un dict {action_id: [bugs ouverts]} pour intégrer les
    signalements utilisateurs dans le statut de la toile.

    Les bugs sans action_id (label trop éloigné des actions de la toile)
    sont regroupés sous la clé spéciale `__page_<page_id>__` pour qu'on
    puisse au moins marquer la page concernée."""
    bugs_by_action: dict[str, list[dict]] = {}
    try:
        with _conn() as conn:
            try:
                rows = conn.execute(
                    "SELECT id, page_id, action_id, label, description, url, created_at "
                    "FROM bug_reports WHERE status='open' ORDER BY created_at DESC LIMIT 500;"
                ).fetchall()
            except Exception:
                # Table pas encore créée
                return {}
            for r in rows:
                key = r["action_id"] or (f"__page_{r['page_id']}__" if r["page_id"] else "__orphan__")
                bugs_by_action.setdefault(key, []).append({
                    "id": r["id"],
                    "label": r["label"],
                    "description": r["description"],
                    "url": r["url"],
                    "created_at": r["created_at"],
                })
    except Exception:
        return {}
    return bugs_by_action


def _load_status_data() -> dict:
    """Lit data/sitemap_status.json (résultat de scripts/test_sitemap_status.py).

    Format attendu :
        {
          "ts": "2026-05-09T01:15:00",
          "pages": {"<id>": {"status": int, "label": "ok|warn|ko", ...}},
          "endpoints": {"/api/foo": {"status": int, "label": "ok|warn|ko", ...}}
        }

    Retourne un dict vide si le fichier n'existe pas (statuts inconnus).
    """
    try:
        if _STATUS_FILE.exists():
            return json.loads(_STATUS_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _normalize_endpoint(ep: str) -> str:
    """Normalise un endpoint type 'GET /api/foo?bar=1' → '/api/foo'.

    Permet de matcher les endpoints du JSON de tests (qui ne contiennent
    pas la méthode HTTP) avec ceux déclarés dans la toile."""
    s = ep.strip()
    if " " in s:
        s = s.split(" ", 1)[1]  # enlève "GET ", "POST ", etc.
    if "?" in s:
        s = s.split("?", 1)[0]
    if "<" in s:
        s = s.split("<", 1)[0].rstrip("/")
    return s


def _compute_action_status(
    endpoints: list[str],
    status_data: dict,
    ui_action_status: dict | None = None,
    action_id: str | None = None,
) -> tuple[str, str]:
    """Calcule un statut (ok/warn/ko/unknown) + une note d'explication
    pour une action, à partir des endpoints qu'elle appelle.

    Règles d'agrégation :
      - override UI manuel (data/sitemap_status.json → ui_actions[<id>]) prioritaire
      - aucun endpoint et pas d'override → unknown
      - match exact d'un endpoint → status de l'endpoint
      - match "fraternal" : endpoint POST/PUT/DELETE non testé directement, mais
        un GET de la même famille (même base path) est OK → on considère l'action
        OK par association (le backend de la famille répond bien)
      - au moins un KO → ko
      - sinon au moins un warn → warn
    """
    # 1. Override manuel UI si fourni
    if ui_action_status and action_id and action_id in ui_action_status:
        ov = ui_action_status[action_id]
        return (ov.get("label", "unknown"), ov.get("note", "Test UI manuel."))

    ep_map = (status_data or {}).get("endpoints", {}) or {}
    if not endpoints:
        return ("unknown", "Aucun endpoint testable (action UI/frontend uniquement).")

    # 2. Match exact d'abord
    matched = []
    for ep in endpoints:
        norm = _normalize_endpoint(ep)
        for key, val in ep_map.items():
            if _normalize_endpoint(key) == norm:
                matched.append((ep, val, "exact"))
                break

    # 3. Match fraternal pour les endpoints non couverts (POST/PUT/DELETE
    #    héritent du status d'un GET frère sur le même path)
    if not matched:
        for ep in endpoints:
            norm_ep = _normalize_endpoint(ep)
            for key, val in ep_map.items():
                norm_key = _normalize_endpoint(key)
                # Frère = même base path (l'un préfixe de l'autre, ou identique)
                if norm_ep == norm_key or norm_key.startswith(norm_ep + "/") or norm_ep.startswith(norm_key + "/"):
                    matched.append((ep, val, "frère"))
                    break

    if not matched:
        return ("unknown", "Endpoints non couverts par le test automatique.")

    has_ko = any(v.get("label") == "ko" for _, v, _ in matched)
    has_warn = any(v.get("label") == "warn" for _, v, _ in matched)
    if has_ko:
        bad = [ep for ep, v, _ in matched if v.get("label") == "ko"]
        return ("ko", f"Endpoint(s) en erreur : {', '.join(bad)}")
    if has_warn:
        warns = [f"{ep} ({v.get('status')})" for ep, v, _ in matched if v.get("label") == "warn"]
        return ("warn", f"Réponse partielle ou paramètres requis : {', '.join(warns)}")
    fraternal = [ep for ep, _, kind in matched if kind == "frère"]
    if fraternal:
        return ("ok", f"{len(matched)} endpoint(s) couvert(s) (dont {len(fraternal)} via famille testée).")
    return ("ok", f"{len(matched)} endpoint(s) testé(s), tous OK.")


def _compute_page_status(page_id: str, actions: list[dict], status_data: dict) -> tuple[str, str]:
    """Statut au niveau page : combine la route HTML + l'agrégat des actions."""
    page_info = (status_data or {}).get("pages", {}).get(page_id)
    page_label = (page_info or {}).get("label")

    # Agrège les statuts des actions
    labels = [a.get("status", "unknown") for a in actions]
    has_ko = "ko" in labels or page_label == "ko"
    has_warn = "warn" in labels or page_label == "warn"

    if page_label == "ko":
        return ("ko", f"Route page indisponible (HTTP {(page_info or {}).get('status')}).")
    if has_ko:
        return ("ko", "Au moins une action de la page est en erreur.")
    if has_warn:
        return ("warn", "Page OK mais certaines actions nécessitent une vérification.")
    if page_label == "ok":
        return ("ok", "Page et actions principales fonctionnelles.")
    return ("unknown", "Statut indéterminé (test non exécuté).")


def _build_sitemap_data(is_admin: bool) -> dict:
    """Construit la structure de données pour la toile d'araignée.

    Renvoie un dict avec :
      - root : nœud Connexion (point d'entrée)
      - categories : 5 catégories (navigate, records, outils, admin, autres)
      - pages : 21 pages avec leurs actions (filtré selon le rôle)
      - chaque action porte `tools` (handlers JS, endpoints API, backend Python)
        et un `status` ∈ {ok, warn, ko, unknown} calculé depuis
        data/sitemap_status.json (généré par scripts/test_sitemap_status.py).

    Garder synchro avec templates/_partials/v30/sidebar.html et la cartographie
    des features (voir /docs/AUDIT_UI_NAVIGATION.md).

    REGLE D'AUTO-MAJ — voir CLAUDE.md : à chaque modif d'un bouton/route, mettre
    à jour la liste `pages` ci-dessous (handlers/endpoints/backend) puis relancer
    `python scripts/test_sitemap_status.py` pour rafraîchir les statuts.
    """
    status_data = _load_status_data()
    ui_action_status = (status_data or {}).get("ui_actions", {})
    open_bugs = _load_open_bugs()

    pages: list[dict] = [
        # ─── NAVIGATE ──────────────────────────────────────────
        {
            "id": "dashboard", "label": "Dashboard", "cat": "navigate",
            "icon": "🏠", "href": "/v30/dashboard", "isHub": True,
            "summary": "KPI du jour, pipeline, priorités IA, action center.",
            "actions": [
                {"label": "Ajouter un KPI manuel", "href": "/v30/parametres#kpi",
                 "tools": {"handlers": ["saveKpi"], "endpoints": ["POST /api/manual-kpi"], "backend": ["app.py:api_manual_kpi"]}},
                {"label": "Action center", "href": "/v30/dashboard#actions",
                 "tools": {"handlers": ["hydrateActionCenter", "hydrate", "renderActionCenter"], "endpoints": ["GET /api/dashboard"], "backend": ["app.py:api_dashboard"]}},
                {"label": "Détail des objectifs (sources)", "href": "/v30/dashboard#objs",
                 "tools": {"handlers": ["openGoalsDetailModal", "renderGoalsDetail"], "endpoints": ["GET /api/dashboard"], "backend": ["app.py:api_dashboard"]}},
                {"label": "Report d'objectifs (jour ouvré suivant)", "href": "/v30/dashboard#objs",
                 "tools": {"handlers": ["renderObjectifs"], "endpoints": ["GET /api/dashboard"], "backend": ["app.py:api_dashboard", "services/dashboard_goals.py:compute_daily_carryover"]}},
                {"label": "Objectif « push » → fiche prospect tirée au hasard (rattrapage de push)", "href": "/v30/dashboard#objs",
                 "tools": {"handlers": ["bindObjItemClicks", "handleObjPush"], "endpoints": ["GET /api/prospects/quick-filter"], "backend": ["app.py:api_prospects_quick_filter"]}},
                {"label": "Priorités IA", "href": "/v30/dashboard#priorities",
                 "tools": {"handlers": ["hydratePriorities", "bindObjItemClicks"], "endpoints": ["GET /api/dashboard", "GET /api/dashboard/adaptive"], "backend": ["app.py:api_dashboard", "routes/collab.py:api_dashboard_adaptive"]}},
                {"label": "Pipeline visuel", "href": "/v30/dashboard#pipeline",
                 "tools": {"handlers": ["hydratePipeline"], "endpoints": ["GET /api/dashboard/pipeline-stages"], "backend": ["app.py:api_dashboard_pipeline_stages"]}},
                {"label": "Tâches du jour", "href": "/v30/focus",
                 "tools": {"handlers": ["hydrateTasks"], "endpoints": ["GET /api/tasks"], "backend": ["routes/admin.py:api_tasks_list"]}},
                {"label": "Performance hebdo", "href": "/v30/stats",
                 "tools": {"handlers": ["bindPerfNav"], "endpoints": ["GET /api/dashboard/stats"], "backend": ["app.py:api_dashboard_stats"]}},
                {"label": "Streak / meilleur jour (jours ouvrés)", "href": "/v30/dashboard#performance",
                 "tools": {"handlers": ["renderHero", "renderPerfInsights"], "endpoints": ["GET /api/dashboard"], "backend": ["app.py:api_dashboard", "services/working_days.py:is_working_day"]}},
                {"label": "Quick access — Besoins ouverts (masqué si vide)", "href": "/v30/besoins",
                 "tools": {"handlers": ["renderBesoinsOuverts"], "endpoints": ["GET /api/dashboard"], "backend": ["app.py:api_dashboard"]}},
                {"label": "Quick access — Derniers candidats EC (masqué si vide)", "href": "/v30/sourcing",
                 "tools": {"handlers": ["renderRecentEC"], "endpoints": ["GET /api/dashboard"], "backend": ["app.py:api_dashboard"]}},
                {"label": "Aperçu rapide — fallback stats si panneaux vides", "href": "/v30/stats",
                 "tools": {"handlers": ["renderQuickStats"], "endpoints": ["GET /api/dashboard"], "backend": ["app.py:api_dashboard"]}},
                {"label": "Exporter la journée", "href": "/v30/dashboard",
                 "tools": {"handlers": ["exportDay"], "endpoints": ["GET /api/export/day"], "backend": ["routes/misc.py:api_export_day"]}},
                {"label": "Assistant IA (chat)", "href": "/v30/dashboard#assistant",
                 "tools": {"handlers": ["openAssistantPanel"], "endpoints": ["GET /api/dashboard/assistant/history", "POST /api/dashboard/assistant", "POST /api/dashboard/assistant-stream"], "backend": ["routes/collab.py:api_dashboard_assistant"]}},
            ],
        },
        {
            "id": "focus", "label": "Focus", "cat": "navigate",
            "icon": "🎯", "href": "/v30/focus",
            "summary": "Tâches prioritaires et relances classées par urgence.",
            "actions": [
                {"label": "Ajouter une tâche", "href": "/v30/focus",
                 "tools": {"handlers": ["_openTaskModal", "_saveTask"], "endpoints": ["POST /api/tasks/save"], "backend": ["routes/admin.py:api_tasks_save"]}},
                {"label": "Relances en retard", "href": "/v30/focus#late",
                 "tools": {"handlers": ["bindRelancesFilter", "loadFocusQueue"], "endpoints": ["GET /api/focus_queue"], "backend": ["routes/admin.py:api_focus_queue"]}},
                {"label": "Marquer fait (tâche)", "href": "/v30/focus",
                 "tools": {"handlers": ["onTaskCheckbox"], "endpoints": ["POST /api/tasks/done"], "backend": ["routes/admin.py:api_tasks_done"]}},
                {"label": "Marquer fait (relance)", "href": "/v30/focus",
                 "tools": {"handlers": ["bindFocusRowActions"], "endpoints": ["POST /api/prospect/mark_done"], "backend": ["routes/bulk.py:api_prospect_mark_done"]}},
                {"label": "Reporter +1j / +7j", "href": "/v30/focus",
                 "tools": {"handlers": ["bindFocusRowActions"], "endpoints": ["POST /api/prospects/bulk-update"], "backend": ["routes/bulk.py:api_prospects_bulk_update"]}},
                {"label": "Filtrer période", "href": "/v30/focus",
                 "tools": {"handlers": ["bindRelancesFilter"], "endpoints": ["GET /api/focus_queue"], "backend": ["routes/admin.py:api_focus_queue"]}},
                {"label": "Rappel relance push (J+7→J+30)", "href": "/v30/focus",
                 "tools": {"handlers": ["bindPushRelances"], "endpoints": ["GET /api/push-logs/relance-reminders"], "backend": ["routes/push.py:api_push_logs_relance_reminders"]}},
                {"label": "Supprimer tâche", "href": "/v30/focus",
                 "tools": {"handlers": ["onTaskDelete"], "endpoints": ["POST /api/tasks/delete"], "backend": ["routes/admin.py:api_tasks_delete"]}},
                {"label": "RDV à statuer (workflow no-show)", "href": "/v30/focus",
                 "tools": {"handlers": ["loadRdvReview", "renderRdvReview", "bindRdvReview"], "endpoints": ["GET /api/rdv/pending-review", "GET /api/dashboard"], "backend": ["routes/rdv_review.py:api_rdv_pending_review", "app.py:api_dashboard"]}},
                {"label": "Statuer un RDV (tenu / no-show / annulé / reprog)", "href": "/v30/focus",
                 "tools": {"handlers": ["bindRdvReview"], "endpoints": ["POST /api/rdv/<id>/review"], "backend": ["routes/rdv_review.py:api_rdv_review", "utils/ai_helpers.py:_call_ai"]}},
                {"label": "Relance IA après no-show / annulé", "href": "/v30/focus",
                 "tools": {"handlers": ["_openRelanceModal"], "endpoints": ["POST /api/rdv/<id>/review"], "backend": ["routes/rdv_review.py:_generate_relance_ai"]}},
                {"label": "Prochaines actions IA (top 10)", "href": "/v30/focus",
                 "tools": {"handlers": ["mountFocusSection"], "endpoints": ["GET /api/ai/next-action/today"], "backend": ["routes/next_action_ai.py:api_next_action_today", "services/next_action_ai.py:list_today_suggestions"]}},
                {"label": "Régénérer batch suggestions IA", "href": "/v30/focus",
                 "tools": {"handlers": ["mountFocusSection"], "endpoints": ["POST /api/ai/next-action/refresh-batch"], "backend": ["routes/next_action_ai.py:api_next_action_refresh_batch", "services/next_action_ai.py:generate_for_prospect"]}},
                {"label": "Appliquer suggestion IA (email/appel/LinkedIn/RDV)", "href": "/v30/focus",
                 "tools": {"handlers": ["applySuggestion"], "endpoints": ["GET /api/prospect/timeline"], "backend": ["app.py:api_prospect_timeline"]}},
                {"label": "Séquences push dues (cadences guidées)", "href": "/v30/focus",
                 "tools": {"handlers": ["mountFocusSection"], "endpoints": ["GET /api/push/sequences/due"], "backend": ["routes/push_sequences.py:api_sequences_due", "services/push_sequences.py:evaluate_due_steps", "services/push_sequences.py:auto_pause_replied"]}},
                {"label": "Exécuter / marquer fait une étape de séquence", "href": "/v30/focus",
                 "tools": {"handlers": ["mountFocusSection"], "endpoints": ["POST /api/push/sequences/enrollments/<id>/complete-step", "POST /api/push/sequences/enrollments/<id>/pause"], "backend": ["routes/push_sequences.py:api_sequences_complete_step"]}},
            ],
        },
        {
            "id": "calendar", "label": "Calendrier", "cat": "navigate",
            "icon": "📅", "href": "/v30/calendrier",
            "summary": "RDV, événements et agenda externe (Outlook/Google).",
            "actions": [
                {"label": "Créer un RDV", "href": "/v30/calendrier",
                 "tools": {"handlers": ["openEventModal", "saveEventModal"], "endpoints": ["POST /api/calendar_events"], "backend": ["routes/calendar.py:api_calendar_events_create"]}},
                {"label": "Vue mois / semaine / jour", "href": "/v30/calendrier",
                 "tools": {"handlers": ["render", "navPrev", "navNext", "navToday"], "endpoints": ["GET /api/calendar_events"], "backend": ["routes/calendar.py:api_calendar_events_list"]}},
                {"label": "Modifier un RDV", "href": "/v30/calendrier",
                 "tools": {"handlers": ["saveEventModal", "openEventPopup"], "endpoints": ["PUT /api/calendar_events/<id>"], "backend": ["routes/calendar.py:api_calendar_events_update"]}},
                {"label": "Supprimer un RDV", "href": "/v30/calendrier",
                 "tools": {"handlers": ["deleteEventModal"], "endpoints": ["DELETE /api/calendar_events/<id>"], "backend": ["routes/calendar.py:api_calendar_events_delete"]}},
                {"label": "Sync ICS externe", "href": "/v30/parametres#calsync",
                 "tools": {"handlers": ["loadAll"], "endpoints": ["GET /api/calendar_events_external", "GET /api/settings"], "backend": ["routes/calendar.py:api_calendar_events_external", "routes/settings.py:api_settings_get"]}},
                {"label": "Rechercher un prospect (RDV)", "href": "/v30/calendrier",
                 "tools": {"handlers": ["bindProspectSearch"], "endpoints": ["GET /api/search"], "backend": ["app.py:api_search"]}},
                {"label": "Sam/dim/JF grisés (jours non travaillés)", "href": "/v30/calendrier",
                 "tools": {"handlers": ["loadHolidays", "dayMods"], "endpoints": ["GET /api/holidays"], "backend": ["routes/calendar.py:api_holidays", "services/working_days.py:get_holidays"]}},
            ],
        },
        {
            "id": "stats", "label": "Stats", "cat": "navigate",
            "icon": "📈", "href": "/v30/stats",
            "summary": "Performance, conversion pipeline, rapports.",
            "actions": [
                {"label": "Plage de dates / période", "href": "/v30/stats",
                 "tools": {"handlers": ["bindPeriod", "bindMonthNav", "bindRangeModal"], "endpoints": ["GET /api/stats", "GET /api/stats/charts", "GET /api/stats/data"], "backend": ["routes/dashboard.py:api_stats", "routes/dashboard.py:api_stats_charts", "routes/dashboard.py:api_stats_data"]}},
                {"label": "Filtrer statuts/tags", "href": "/v30/stats",
                 "tools": {"handlers": ["bindFilters"], "endpoints": ["GET /api/stats", "GET /api/stats/charts"], "backend": ["routes/dashboard.py:api_stats"]}},
                {"label": "Export JSON / CSV / XLSX", "href": "/v30/stats",
                 "tools": {"handlers": ["bindExport"], "endpoints": ["GET /api/stats/export", "GET /api/stats/export_weekly_xlsx"], "backend": ["routes/dashboard.py:api_stats_export", "routes/dashboard.py:api_stats_export_weekly_xlsx"]}},
                {"label": "Rapport hebdo / mensuel", "href": "/v30/stats",
                 "tools": {"handlers": ["loadRapportHebdo"], "endpoints": ["GET /api/rapport-hebdo"], "backend": ["routes/misc.py:api_rapport_hebdo"]}},
                {"label": "Conversion pipeline", "href": "/v30/stats",
                 "tools": {"handlers": ["renderPipelineChart"], "endpoints": ["GET /api/dashboard/pipeline-stages", "GET /api/stats/charts"], "backend": ["app.py:api_dashboard_pipeline_stages"]}},
                {"label": "Funnel cumulatif (5 étapes + drill-down)", "href": "/v30/stats",
                 "tools": {"handlers": ["renderFunnel", "bindFunnelDrill"], "endpoints": ["GET /api/stats/funnel"], "backend": ["routes/prospect_score.py:api_stats_funnel", "services/prospect_score.py:compute_funnel"]}},
                {"label": "Prédictions IA", "href": "/v30/stats#predictions",
                 "tools": {"handlers": ["loadPredictions"], "endpoints": ["GET /api/stats/predictions"], "backend": ["routes/dashboard.py:api_stats_predictions"]}},
                {"label": "Insights IA", "href": "/v30/stats#insights",
                 "tools": {"handlers": ["loadInsights"], "endpoints": ["POST /api/stats/insights"], "backend": ["routes/dashboard.py:api_stats_insights"]}},
            ],
        },

        # ─── RECORDS ───────────────────────────────────────────
        {
            "id": "prospects", "label": "Prospects", "cat": "records",
            "icon": "👥", "href": "/v30/prospects",
            "summary": "Base de prospects — 3 vues, filtres, bulk actions.",
            "actions": [
                {"label": "Importer Excel", "href": "/v30/prospects#import",
                 "tools": {"handlers": ["openImportModal", "importXlsx"], "endpoints": ["POST /api/prospects/create", "POST /api/prospects/check-duplicates"], "backend": ["routes/duplicates.py:api_prospects_create"]}},
                {"label": "Ajouter (manuel)", "href": "/v30/prospects#add",
                 "tools": {"handlers": ["openAddModal", "submitAdd"], "endpoints": ["POST /api/prospects/create"], "backend": ["routes/duplicates.py:api_prospects_create"]}},
                {"label": "Ajouter (IA, doc)", "href": "/v30/prospects#add-ai",
                 "tools": {"handlers": ["openQuickAddAi", "parseDocStream"], "endpoints": ["POST /api/quickadd/parse-document", "POST /api/quickadd/parse-document-stream"], "backend": ["routes/misc.py:api_quickadd_parse_document"]}},
                {"label": "Scrapping IA (fiche)", "href": "/v30/prospects#ia",
                 "tools": {"handlers": ["openScrappingIA"], "endpoints": ["POST /api/ollama/generate", "POST /api/ia-enrichment-log"], "backend": ["routes/ai.py:api_ollama_generate"]}},
                {"label": "Email IA / Tel IA (bulk)", "href": "/v30/prospects#bulk-ia",
                 "tools": {"handlers": ["bulkEmailAI", "bulkPhoneAI"], "endpoints": ["POST /api/ollama/generate", "POST /api/prospects/update-contacts"], "backend": ["routes/bulk.py:api_prospects_update_contacts"]}},
                {"label": "Avant réunion IA", "href": "/v30/prospects#meeting",
                 "tools": {"handlers": ["openBeforeMeeting"], "endpoints": ["GET /api/prospect/<id>/infos-rdv-stream", "GET /api/prospect/<id>/download-rdv-pdf"], "backend": ["app.py:api_infos_rdv_stream"]}},
                {"label": "Après réunion IA (CR)", "href": "/v30/prospects#meeting",
                 "tools": {"handlers": ["openAfterMeeting"], "endpoints": ["POST /api/prospect/<id>/summarize", "POST /api/prospect/<id>/ia-log"], "backend": ["app.py:api_prospect_summarize"]}},
                {"label": "Modifier en masse", "href": "/v30/prospects#bulk",
                 "tools": {"handlers": ["openBulkEdit"], "endpoints": ["POST /api/prospects/bulk-edit", "POST /api/prospects/bulk-status-tags", "POST /api/prospects/bulk-field-update"], "backend": ["routes/bulk.py:api_prospects_bulk_edit"]}},
                {"label": "Géocoder en masse", "href": "/v30/carte",
                 "tools": {"handlers": ["openGeocodeBulk"], "endpoints": ["POST /api/map/geocode", "GET /api/map/geocode/bulk"], "backend": ["routes/map.py:api_map_geocode_bulk"]}},
                {"label": "Archiver", "href": "/v30/prospects/archives",
                 "tools": {"handlers": ["bulkArchive"], "endpoints": ["POST /api/prospects/bulk-archive"], "backend": ["routes/bulk.py:api_prospects_bulk_archive"]}},
                {"label": "Supprimer (soft)", "href": "/v30/prospects",
                 "tools": {"handlers": ["bulkDelete"], "endpoints": ["POST /api/prospects/delete"], "backend": ["app.py:api_prospects_delete"]}},
                {"label": "Désarchiver / restaurer", "href": "/v30/prospects/archives",
                 "tools": {"handlers": ["unarchive"], "endpoints": ["POST /api/soft-deleted/restore"], "backend": ["routes/misc.py:api_soft_deleted_restore"]}},
                {"label": "Exporter VCF / XLSX", "href": "/v30/prospects",
                 "tools": {"handlers": ["exportSelection"], "endpoints": ["GET /api/export/xlsx"], "backend": ["routes/misc.py:api_export_xlsx"]}},
                {"label": "Mode Prosp (deck)", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["startModeProsp"], "endpoints": ["POST /api/mode-prosp/start", "GET /api/mode-prosp/data"], "backend": ["app.py:api_mode_prosp_start"]}},
                {"label": "Voir fiche / timeline", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["openProspectDetail"], "endpoints": ["GET /api/prospect/timeline", "POST /api/prospect/log-call", "POST /api/prospect/log-stage"], "backend": ["routes/prospects.py:api_prospect_timeline"]}},
                {"label": "Pièces jointes (upload)", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["uploadAttachment"], "endpoints": ["POST /api/prospect/attachments", "GET /api/prospect/attachments"], "backend": ["routes/attachments.py:api_prospect_attachment_upload"]}},
                {"label": "Onglet CR (comptes-rendus + PDF)", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["loadCRTab", "renderCRMeetingCard", "renderCRFileCard"], "endpoints": ["GET /api/meetings", "GET /api/prospect/attachments"], "backend": ["routes/meetings.py:meetings_list", "routes/attachments.py:api_prospect_attachment_list"]}},
                {"label": "Visionneuse PDF (CR drag-drop)", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["openFilePreview", "closeFilePreview"], "endpoints": ["GET /api/prospect/attachments/<id>/file", "GET /api/prospect/attachments/<id>/thumb"], "backend": ["routes/attachments.py:api_prospect_attachment_file", "routes/attachments.py:api_prospect_attachment_thumb"]}},
                {"label": "Photo prospect", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["uploadPhoto"], "endpoints": ["POST /api/prospect/photo", "GET /api/photos/prospect/<id>"], "backend": ["routes/dashboard.py:api_prospect_photo"]}},
                {"label": "Colonne Score IA (table + tri)", "href": "/v30/prospects",
                 "tools": {"handlers": ["loadScores", "renderTable"], "endpoints": ["GET /api/prospects/scores"], "backend": ["routes/prospect_score.py:api_prospects_scores", "services/prospect_score.py:compute_for_user"]}},
                {"label": "Mode Prosp respecte le tri + filtres du tableau", "href": "/v30/prospects/mode-prosp",
                 "tools": {"handlers": ["bindModeProsp", "loadDeck"], "endpoints": ["POST /api/mode-prosp/start", "GET /api/mode-prosp/data"], "backend": ["app.py:mode_prosp_start", "app.py:mode_prosp_data"]}},
                {"label": "Carte Prochaine action IA", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["mountProspectCard"], "endpoints": ["GET /api/ai/next-action/<id>"], "backend": ["routes/next_action_ai.py:api_next_action_get", "services/next_action_ai.py:get_cached"]}},
                {"label": "Régénérer suggestion IA (fiche)", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["mountProspectCard"], "endpoints": ["POST /api/ai/next-action/<id>/refresh"], "backend": ["routes/next_action_ai.py:api_next_action_refresh", "services/next_action_ai.py:generate_for_prospect"]}},
                {"label": "Démarrer une séquence push (modal)", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["openEnrollModal", "mountProspectButton"], "endpoints": ["GET /api/push/sequences", "POST /api/push/sequences/<id>/enroll"], "backend": ["routes/push_sequences.py:api_sequences_enroll", "services/push_sequences.py:enroll"]}},
                {"label": "Rattrapage de push — bouton flottant « Suivant » (re-tirage aléatoire)", "href": "/v30/prospect/<id>",
                 "tools": {"handlers": ["pickNext"], "endpoints": ["GET /api/prospects/quick-filter"], "backend": ["app.py:api_prospects_quick_filter"]}},
            ],
        },
        {
            "id": "entreprises", "label": "Entreprises", "cat": "records",
            "icon": "🏢", "href": "/v30/entreprises",
            "summary": "Portefeuille client, fiches détaillées, fusion, opportunités.",
            "actions": [
                {"label": "Charger la liste", "href": "/v30/entreprises",
                 "tools": {"handlers": ["loadEntreprises"], "endpoints": ["GET /api/data", "GET /api/companies/list"], "backend": ["routes/misc.py:api_data", "routes/companies.py:api_companies_list"]}},
                {"label": "Ajouter une entreprise", "href": "/v30/entreprises",
                 "tools": {"handlers": ["openCreateCompany"], "endpoints": ["POST /api/companies/create"], "backend": ["routes/companies.py:api_companies_create"]}},
                {"label": "Éditer fiche entreprise", "href": "/v30/entreprises",
                 "tools": {"handlers": ["openCompanyDetail", "saveCompany"], "endpoints": ["GET /api/company/full", "POST /api/company/update"], "backend": ["routes/misc.py:api_company_full", "routes/misc.py:api_company_update"]}},
                {"label": "Scrapping IA entreprise (Tavily + Ollama)", "href": "/v30/entreprises",
                 "tools": {"handlers": ["bindEnrich", "runEnrich", "applyEnrich"], "endpoints": ["POST /api/companies/<id>/enrich", "POST /api/company/update"], "backend": ["routes/companies.py:api_companies_enrich", "routes/misc.py:api_company_update"]}},
                {"label": "Scrapping IA en masse (bulk + géocodage)", "href": "/v30/entreprises",
                 "tools": {"handlers": ["openBulkEnrichModal", "processBulkEnrich", "bindBulkEnrich"], "endpoints": ["POST /api/companies/<id>/enrich", "POST /api/company/update", "POST /api/map/geocode"], "backend": ["routes/companies.py:api_companies_enrich", "routes/misc.py:api_company_update", "routes/map.py:api_map_geocode_one"]}},
                {"label": "Scrapping IA en file d'attente (différé + validation plus tard)", "href": "/v30/entreprises",
                 "tools": {"handlers": ["enqueueBulkEnrich", "refreshPendingBadge", "openPendingModal", "renderPendingList", "reviewPendingJob", "discardPendingJob", "clearDonePendingJobs", "bindPending"], "endpoints": ["POST /api/companies/enrich-queue", "GET /api/companies/enrich-queue", "POST /api/companies/enrich-queue/<jid>/discard", "DELETE /api/companies/enrich-queue/<jid>", "POST /api/companies/enrich-queue/clear-done"], "backend": ["routes/companies.py:api_companies_enrich_queue_enqueue", "routes/companies.py:api_companies_enrich_queue_list", "routes/companies.py:api_companies_enrich_queue_discard", "routes/companies.py:api_companies_enrich_queue_delete", "routes/companies.py:api_companies_enrich_queue_clear_done", "routes/companies.py:run_company_enrich", "app.py:_process_enrich_queue_job"]}},
                {"label": "Compléter la carte (entreprises sans coordonnées)", "href": "/v30/entreprises",
                 "tools": {"handlers": ["bindFillMap"], "endpoints": ["POST /api/companies/<id>/enrich", "POST /api/map/geocode"], "backend": ["routes/companies.py:api_companies_enrich", "routes/map.py:api_map_geocode_one"]}},
                {"label": "Fusionner deux entreprises", "href": "/v30/duplicates",
                 "tools": {"handlers": ["mergeCompanies"], "endpoints": ["POST /api/companies/merge"], "backend": ["app.py:api_companies_merge"]}},
                {"label": "Supprimer une entreprise", "href": "/v30/entreprises",
                 "tools": {"handlers": ["deleteCompany"], "endpoints": ["POST /api/companies/delete"], "backend": ["routes/companies.py:api_companies_delete"]}},
                {"label": "Filtrer / rechercher", "href": "/v30/entreprises",
                 "tools": {"handlers": ["filterEntreprises"], "endpoints": ["GET /api/search"], "backend": ["app.py:api_search"]}},
                {"label": "Exporter la liste", "href": "/v30/entreprises",
                 "tools": {"handlers": ["exportXlsx"], "endpoints": ["GET /api/export/xlsx"], "backend": ["routes/misc.py:api_export_xlsx"]}},
                {"label": "Vue liste / cartes / carte géo", "href": "/v30/entreprises",
                 "tools": {"handlers": ["switchView"], "endpoints": ["GET /api/map/markers"], "backend": ["routes/map.py:api_map_markers"]}},
                {"label": "Vue Split (entreprise + prospects)", "href": "/v30/entreprises",
                 "tools": {"handlers": ["renderSplitList", "renderSplitDetail", "bindSplit"], "endpoints": ["GET /api/company/full"], "backend": ["routes/misc.py:api_company_full"]}},
                {"label": "Opportunités (créer/éditer)", "href": "/v30/entreprises",
                 "tools": {"handlers": ["saveOpportunity"], "endpoints": ["POST /api/opportunities/save", "POST /api/opportunities/delete"], "backend": ["routes/misc.py:api_opportunities_save"]}},
                {"label": "Événements entreprise", "href": "/v30/entreprises",
                 "tools": {"handlers": ["addCompanyEvent"], "endpoints": ["POST /api/company/events/add"], "backend": ["routes/misc.py:api_company_events_add"]}},
            ],
        },
        {
            "id": "candidats", "label": "Candidats", "cat": "records",
            "icon": "👤", "href": "/v30/sourcing",
            "summary": "Sourcing — pipeline 5 colonnes, statuts, skills, DC.",
            "actions": [
                {"label": "Charger pipeline", "href": "/v30/sourcing",
                 "tools": {"handlers": ["loadCandidates"], "endpoints": ["GET /api/candidates"], "backend": ["routes/candidates.py:api_candidates_list"]}},
                {"label": "Ajouter un candidat", "href": "/v30/sourcing",
                 "tools": {"handlers": ["openCandidateModal", "saveCandidate"], "endpoints": ["POST /api/candidates/save"], "backend": ["routes/candidates.py:api_candidates_save"]}},
                {"label": "Importer CV (PDF/DOCX)", "href": "/v30/sourcing",
                 "tools": {"handlers": ["uploadCV"], "endpoints": ["POST /api/candidates/extract-dc", "POST /api/candidates/upload-dc"], "backend": ["routes/candidates.py:api_candidates_extract_dc"]}},
                {"label": "Importer JSON IA (fiche)", "href": "/v30/sourcing",
                 "tools": {"handlers": ["importJsonIA"], "endpoints": ["POST /api/candidates/parse-fiche-entretien"], "backend": ["routes/candidates.py:api_candidates_parse_fiche"]}},
                {"label": "Filtrer (statut/skills)", "href": "/v30/sourcing",
                 "tools": {"handlers": ["filterCandidates"], "endpoints": ["GET /api/candidates"], "backend": ["routes/candidates.py:api_candidates_list"]}},
                {"label": "Enregistrer un InMail LinkedIn", "href": "/v30/sourcing",
                 "tools": {"handlers": ["saveInMail"], "endpoints": ["GET /api/linkedin-inmails", "POST /api/linkedin-inmails", "PATCH /api/linkedin-inmails/<id>"], "backend": ["app.py:api_linkedin_inmails"]}},
                {"label": "Vue Pipeline / Liste / Grille", "href": "/v30/sourcing",
                 "tools": {"handlers": ["switchCandidateView"], "endpoints": [], "backend": []}},
                {"label": "Changer statut (kanban)", "href": "/v30/sourcing",
                 "tools": {"handlers": ["onCandidateDrop"], "endpoints": ["POST /api/candidates/status", "POST /api/candidates/bulk-update"], "backend": ["app.py:api_candidates_status"]}},
                {"label": "Archiver / restaurer", "href": "/v30/sourcing",
                 "tools": {"handlers": ["archiveCandidate"], "endpoints": ["POST /api/candidates/bulk-update"], "backend": ["app.py:api_candidates_bulk_update"]}},
                {"label": "Supprimer un candidat", "href": "/v30/sourcing",
                 "tools": {"handlers": ["deleteCandidate"], "endpoints": ["POST /api/candidates/delete"], "backend": ["routes/candidates.py:api_candidates_delete"]}},
                {"label": "Fiche candidat (timeline + EC1)", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["openCandidateDetail"], "endpoints": ["GET /api/candidates/<id>", "GET /api/candidate/timeline", "GET /api/ec1-checklist"], "backend": ["routes/candidates.py:api_candidates_get", "app.py:api_candidate_timeline"]}},
                {"label": "Expériences / formations / skills", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["addExperience"], "endpoints": ["POST /api/candidates/<id>/experiences", "POST /api/candidates/<id>/educations", "POST /api/candidates/<id>/skills"], "backend": ["routes/candidates.py:api_candidates_experiences"]}},
                {"label": "Disponibilité", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["editAvailability"], "endpoints": ["GET /api/candidates/<id>/availability", "POST /api/candidates/<id>/availability"], "backend": ["routes/candidates.py:api_candidates_availability"]}},
                {"label": "Onglets candidat (custom)", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["loadCandidateTabs"], "endpoints": ["GET /api/candidate-tabs", "POST /api/candidate-tabs", "PUT /api/candidate-tabs/<id>"], "backend": ["app.py:api_candidate_tabs"]}},
                {"label": "Push depuis candidat", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["sendCandidatePush"], "endpoints": ["POST /api/candidate-push", "GET /api/candidate-push"], "backend": ["app.py:api_candidate_push"]}},
                {"label": "Meilleurs candidats par prospect (IA-classés)", "href": "/v30/sourcing",
                 "tools": {"handlers": ["loadBestCandidates", "loadAISuggestions"], "endpoints": ["GET /api/prospect/<id>/best-candidates?use_ollama=1&ai_explanations=1"], "backend": ["app.py:api_prospect_best_candidates", "utils/tech_synonyms.are_synonyms"]}},
                {"label": "Description IA candidat", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["generateDescription"], "endpoints": ["POST /api/candidates/<id>/generate-description", "POST /api/candidates/<id>/save-description"], "backend": ["routes/push.py:api_candidate_description"]}},
                {"label": "Pièces jointes candidat (CV, Excel suivi…)", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["loadAttachments", "uploadAttachment", "renameAttachment", "deleteAttachment"], "endpoints": ["GET /api/candidates/<id>/attachments", "POST /api/candidates/<id>/attachments", "PATCH /api/candidate-attachments/<aid>", "DELETE /api/candidate-attachments/<aid>", "GET /api/candidate-attachments/<aid>/file"], "backend": ["routes/candidates.py:api_candidate_attachment_upload", "routes/candidates.py:api_candidate_attachment_list", "routes/candidates.py:api_candidate_attachment_file", "routes/candidates.py:api_candidate_attachment_update", "routes/candidates.py:api_candidate_attachment_delete"]}},
                {"label": "Fiche entretien EC1 — export Excel", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["downloadEc1Excel", "applyEc1Form"], "endpoints": ["GET /api/candidates/<id>/ec1-export.xlsx", "POST /api/candidates/<id>/ec1-export.xlsx"], "backend": ["routes/candidates.py:api_candidate_ec1_export"]}},
                {"label": "Fiche entretien EC1 — formulaire éditable (apply)", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["renderEc1Form", "collectEc1Form", "applyEc1Form"], "endpoints": ["POST /api/candidates/<id>/ec1-apply"], "backend": ["routes/candidates.py:api_candidate_ec1_apply"]}},
                {"label": "Transcription EC1 → IA pré-remplit la fiche", "href": "/v30/candidat/<id>",
                 "tools": {"handlers": ["analyzeEc1Transcript", "buildEc1State"], "endpoints": ["POST /api/candidates/<id>/ec1-from-transcript"], "backend": ["routes/candidates.py:api_candidate_ec1_from_transcript"]}},
            ],
        },

        # ─── OUTILS ────────────────────────────────────────────
        {
            "id": "push", "label": "Push", "cat": "outils",
            "icon": "📨", "href": "/v30/push",
            "summary": "Campagnes email/LinkedIn, templates, historique, analytics.",
            "actions": [
                {"label": "Charger les catégories", "href": "/v30/push",
                 "tools": {"handlers": ["loadCategories"], "endpoints": ["GET /api/push-categories"], "backend": ["routes/push.py:api_push_categories"]}},
                {"label": "Créer / éditer une catégorie", "href": "/v30/push",
                 "tools": {"handlers": ["saveCategory"], "endpoints": ["POST /api/push-categories/save", "POST /api/push-categories/delete", "POST /api/push-categories/scan"], "backend": ["routes/push.py:api_push_categories_save"]}},
                {"label": "Templates email", "href": "/v30/push",
                 "tools": {"handlers": ["loadTemplates", "saveTemplate"], "endpoints": ["GET /api/templates", "POST /api/templates/save", "POST /api/templates/delete"], "backend": ["routes/push.py:api_templates"]}},
                {"label": "Suggestions de prospects/candidats", "href": "/v30/push",
                 "tools": {"handlers": ["loadMatch"], "endpoints": ["GET /api/push-categories/<id>/match-prospects", "GET /api/push-categories/<id>/match-candidates"], "backend": ["routes/push.py:api_push_categories_match"]}},
                {"label": "Historique des envois", "href": "/v30/push",
                 "tools": {"handlers": ["loadHistory"], "endpoints": ["GET /api/push-logs"], "backend": ["routes/push_logs.py:api_push_logs_list"]}},
                {"label": "Annuler le dernier push", "href": "/v30/push",
                 "tools": {"handlers": ["undoLastPush"], "endpoints": ["POST /api/push-logs/undo_last"], "backend": ["routes/push_logs.py:api_push_logs_undo"]}},
                {"label": "Export historique XLSX", "href": "/v30/push",
                 "tools": {"handlers": ["exportPushXlsx"], "endpoints": ["GET /api/push-logs/export.xlsx"], "backend": ["routes/push_logs.py:api_push_logs_export"]}},
                {"label": "Campagnes (créer/envoyer)", "href": "/v30/push",
                 "tools": {"handlers": ["createCampaign", "sendCampaign"], "endpoints": ["GET /api/push-campaigns", "POST /api/push-campaigns", "POST /api/push-campaigns/<id>/send"], "backend": ["routes/push_logs.py:api_push_campaigns"]}},
                {"label": "Analytics push (open/click)", "href": "/v30/push",
                 "tools": {"handlers": ["loadAnalytics"], "endpoints": ["GET /api/push/analytics", "GET /api/push/optimal-time"], "backend": ["routes/push_logs.py:api_push_analytics"]}},
                {"label": "Générer email IA", "href": "/v30/push",
                 "tools": {"handlers": ["generatePushAI"], "endpoints": ["POST /api/push/generate"], "backend": ["routes/push.py:api_push_generate"]}},
                {"label": "Upload template fichier", "href": "/v30/push",
                 "tools": {"handlers": ["uploadTemplateFile"], "endpoints": ["POST /api/push-categories/<id>/upload-template", "POST /api/push/templates/upload"], "backend": ["routes/push.py:api_push_upload_template"]}},
                {"label": "Télécharger template (.msg)", "href": "/v30/push",
                 "tools": {"handlers": ["renderModalCatFiles"], "endpoints": ["GET /api/push-categories/<id>/files", "GET /api/pushs/user/<uid>/<cat_id>/<filename>"], "backend": ["routes/push.py:api_serve_push_file"]}},
            ],
        },
        {
            "id": "actus", "label": "Actus", "cat": "outils",
            "icon": "📰", "href": "/v30/actus",
            "summary": "News marché du travail (RSS robotique/embarqué/IT) + offres d'emploi agrégées (Jobfly-ready).",
            "actions": [
                {"label": "Charger les actus marché", "href": "/v30/actus",
                 "tools": {"handlers": ["loadArticles"], "endpoints": ["GET /api/actus/articles"], "backend": ["routes/actus.py:api_actus_articles", "services/actus.py:list_articles"]}},
                {"label": "Charger les offres", "href": "/v30/actus",
                 "tools": {"handlers": ["loadJobs"], "endpoints": ["GET /api/actus/jobs"], "backend": ["routes/actus.py:api_actus_jobs", "services/actus.py:list_jobs"]}},
                {"label": "Annonces liées au CRM (entreprises/prospects)", "href": "/v30/actus",
                 "tools": {"handlers": ["loadCrmJobs"], "endpoints": ["GET /api/actus/jobs/crm"], "backend": ["routes/actus.py:api_actus_jobs_crm", "services/actus.py:list_crm_jobs", "services/actus.py:_companies_match"]}},
                {"label": "Filtrer par région", "href": "/v30/actus",
                 "tools": {"handlers": ["loadArticles", "loadJobs"], "endpoints": ["GET /api/actus/articles", "GET /api/actus/jobs"], "backend": ["services/actus.py:_detect_region"]}},
                {"label": "Recherche textuelle (offres)", "href": "/v30/actus",
                 "tools": {"handlers": ["loadJobs"], "endpoints": ["GET /api/actus/jobs"], "backend": ["routes/actus.py:api_actus_jobs"]}},
                {"label": "Filtrer par type de contrat", "href": "/v30/actus",
                 "tools": {"handlers": ["loadJobs"], "endpoints": ["GET /api/actus/jobs"], "backend": ["routes/actus.py:api_actus_jobs"]}},
                {"label": "Trier par date / A→Z", "href": "/v30/actus",
                 "tools": {"handlers": ["loadJobs"], "endpoints": ["GET /api/actus/jobs"], "backend": []}},
                {"label": "Sauvegarder en favori", "href": "/v30/actus",
                 "tools": {"handlers": ["toggleFavori"], "endpoints": ["POST /api/actus/favoris"], "backend": ["routes/actus.py:api_actus_favoris_toggle", "services/actus.py:toggle_favori"]}},
                {"label": "Voir mes favoris", "href": "/v30/actus",
                 "tools": {"handlers": ["loadJobs"], "endpoints": ["GET /api/actus/favoris"], "backend": ["routes/actus.py:api_actus_favoris_list", "services/actus.py:list_favoris"]}},
                {"label": "Rafraîchir manuellement", "href": "/v30/actus",
                 "tools": {"handlers": ["refresh"], "endpoints": ["POST /api/actus/refresh"], "backend": ["routes/actus.py:api_actus_refresh", "services/actus.py:refresh_all"]}},
                {"label": "Statut cache (compteurs)", "href": "/v30/actus",
                 "tools": {"handlers": ["loadStatus"], "endpoints": ["GET /api/actus/status"], "backend": ["routes/actus.py:api_actus_status", "services/actus.py:status"]}},
                {"label": "Définir région par défaut (admin)", "href": "/v30/actus",
                 "tools": {"handlers": ["pinRegionAsDefault"], "endpoints": ["GET /api/actus/config", "POST /api/actus/config"], "backend": ["routes/actus.py:api_actus_config_get", "routes/actus.py:api_actus_config_set", "services/actus.py:set_default_region"]}},
                {"label": "Configurer sources Adzuna/France Travail/Jobfly (Paramètres)", "href": "/v30/parametres?card=actus-sources",
                 "tools": {"handlers": ["bindActusSources"], "endpoints": ["GET /api/actus/sources-config", "POST /api/actus/sources-config", "POST /api/actus/sources-test"], "backend": ["routes/actus.py:api_actus_sources_config_get", "routes/actus.py:api_actus_sources_config_set", "routes/actus.py:api_actus_sources_test", "services/actus.py:load_sources_config", "services/actus.py:save_sources_config", "services/actus.py:FranceTravailOAuthSource"]}},
            ],
        },
        {
            "id": "carte", "label": "Carte", "cat": "outils",
            "icon": "🗺️", "href": "/v30/carte",
            "summary": "Cartographie géographique (Leaflet), géocoding bulk, heatmap.",
            "actions": [
                {"label": "Charger les marqueurs", "href": "/v30/carte",
                 "tools": {"handlers": ["loadMarkers"], "endpoints": ["GET /api/map/markers", "GET /api/map/stats"], "backend": ["routes/map.py:api_map_markers"]}},
                {"label": "Géocoder en masse", "href": "/v30/carte",
                 "tools": {"handlers": ["openGeocodeBulkModal", "runBulkGeocode"], "endpoints": ["GET /api/map/geocode/bulk", "POST /api/map/geocode"], "backend": ["routes/map.py:api_map_geocode_bulk"]}},
                {"label": "Couches (entreprises, prospects, heatmap)", "href": "/v30/carte",
                 "tools": {"handlers": ["toggleLayer"], "endpoints": ["GET /api/map/markers"], "backend": ["routes/map.py:api_map_markers"]}},
                {"label": "Filtrer par statut/pertinence/tag", "href": "/v30/carte",
                 "tools": {"handlers": ["applyFilters"], "endpoints": ["GET /api/map/markers"], "backend": []}},
                {"label": "Localiser ma position", "href": "/v30/carte",
                 "tools": {"handlers": ["locateMe"], "endpoints": [], "backend": []}},
                {"label": "Recharger les marqueurs", "href": "/v30/carte",
                 "tools": {"handlers": ["refreshMarkers"], "endpoints": ["GET /api/map/markers"], "backend": ["routes/map.py:api_map_markers"]}},
            ],
        },
        {
            "id": "transcription", "label": "Transcription", "cat": "outils",
            "icon": "🎙️", "href": "/v30/transcription",
            "summary": "Transcription locale (Whisper) + analyse Claude des réunions.",
            "actions": [
                {"label": "Vérifier l'environnement (préflight)", "href": "/v30/transcription",
                 "tools": {"handlers": ["preflight"], "endpoints": ["GET /api/transcription/preflight"], "backend": ["routes/transcription.py:api_transcription_preflight"]}},
                {"label": "Lister les transcriptions", "href": "/v30/transcription",
                 "tools": {"handlers": ["loadTranscriptions"], "endpoints": ["GET /api/transcription"], "backend": ["routes/transcription.py:api_transcription_list"]}},
                {"label": "Enregistrer en direct + upload", "href": "/v30/transcription",
                 "tools": {"handlers": ["startRecord", "uploadAudio"], "endpoints": ["POST /api/transcription/upload"], "backend": ["routes/transcription.py:api_transcription_upload"]}},
                {"label": "Importer audio (mp3, wav, m4a…)", "href": "/v30/transcription",
                 "tools": {"handlers": ["uploadAudio"], "endpoints": ["POST /api/transcription/upload"], "backend": ["routes/transcription.py:api_transcription_upload"]}},
                {"label": "Importer résumé PDF", "href": "/v30/transcription",
                 "tools": {"handlers": ["uploadSummaryPdf"], "endpoints": ["POST /api/transcription/upload-summary-pdf"], "backend": ["routes/transcription.py:api_transcription_upload_summary"]}},
                {"label": "Réanalyser (Claude API)", "href": "/v30/transcription",
                 "tools": {"handlers": ["reanalyze"], "endpoints": ["POST /api/transcription/<id>/reanalyze", "POST /api/transcription/<id>/retry"], "backend": ["routes/transcription.py:api_transcription_reanalyze"]}},
                {"label": "Identifier participants / champs", "href": "/v30/transcription",
                 "tools": {"handlers": ["editStructured"], "endpoints": ["PUT /api/transcription/<id>/structured-fields"], "backend": ["routes/transcription.py:api_transcription_structured"]}},
                {"label": "Extraire vers CRM", "href": "/v30/transcription",
                 "tools": {"handlers": ["extractCrm"], "endpoints": ["POST /api/transcription/<id>/extract-crm", "POST /api/transcription/<id>/create-prospect", "POST /api/transcription/<id>/create-candidate"], "backend": ["routes/transcription.py:api_transcription_extract_crm"]}},
                {"label": "Analyse externe (prompt à coller)", "href": "/v30/transcription",
                 "tools": {"handlers": ["copyExternalPrompt"], "endpoints": ["GET /api/transcription/<id>/external-prompt", "POST /api/transcription/<id>/external-analysis"], "backend": ["routes/transcription.py:api_transcription_external_prompt"]}},
                {"label": "Supprimer une transcription", "href": "/v30/transcription",
                 "tools": {"handlers": ["deleteTranscription"], "endpoints": ["DELETE /api/transcription/<id>"], "backend": ["routes/transcription.py:api_transcription_delete"]}},
            ],
        },
        {
            "id": "besoins", "label": "Besoins", "cat": "outils",
            "icon": "📋", "href": "/v30/besoins",
            "summary": "Fiches de besoin client, suivi des candidats matchés.",
            "actions": [
                {"label": "Lister les besoins", "href": "/v30/besoins",
                 "tools": {"handlers": ["loadBesoins"], "endpoints": ["GET /api/besoins"], "backend": ["routes/besoins.py:api_besoins_list"]}},
                {"label": "Créer un besoin", "href": "/v30/besoins",
                 "tools": {"handlers": ["openBesoinModal", "saveBesoin"], "endpoints": ["POST /api/besoins"], "backend": ["routes/besoins.py:api_besoins_create"]}},
                {"label": "Importer Excel besoins", "href": "/v30/besoins",
                 "tools": {"handlers": ["importBesoinsXlsx"], "endpoints": ["POST /api/besoins"], "backend": ["routes/besoins.py:api_besoins_create"]}},
                {"label": "Filtrer par statut", "href": "/v30/besoins",
                 "tools": {"handlers": ["filterBesoins"], "endpoints": ["GET /api/besoins"], "backend": []}},
                {"label": "Éditer fiche besoin", "href": "/v30/besoins",
                 "tools": {"handlers": ["openBesoinDetail", "saveBesoin"], "endpoints": ["GET /api/besoins/<id>", "PUT /api/besoins/<id>"], "backend": ["routes/besoins.py:api_besoins_update"]}},
                {"label": "Trier candidats par dispo", "href": "/v30/besoins",
                 "tools": {"handlers": ["sortByStatus"], "endpoints": ["PUT /api/besoins/<id>"], "backend": ["routes/besoins.py:api_besoins_update"]}},
                {"label": "Réordonner candidats (drag)", "href": "/v30/besoins",
                 "tools": {"handlers": ["bindDragAndDrop", "moveCandidate"], "endpoints": ["PUT /api/besoins/<id>"], "backend": ["routes/besoins.py:api_besoins_update"]}},
                {"label": "Supprimer un besoin", "href": "/v30/besoins",
                 "tools": {"handlers": ["deleteBesoin"], "endpoints": ["DELETE /api/besoins/<id>"], "backend": ["routes/besoins.py:api_besoins_delete"]}},
                {"label": "Export besoin XLSX", "href": "/v30/besoins",
                 "tools": {"handlers": ["exportBesoinXlsx"], "endpoints": ["GET /api/besoins/<id>/export.xlsx"], "backend": ["routes/besoins.py:api_besoins_export"]}},
                {"label": "Export besoin PDF", "href": "/v30/besoins",
                 "tools": {"handlers": ["exportPdf"], "endpoints": ["GET /api/besoins/<id>/export.pdf"], "backend": ["routes/besoins.py:api_export_besoin_pdf", "routes/besoins.py:_build_besoin_pdf"]}},
                {"label": "Résumé après RT (PDF par candidat)", "href": "/v30/besoins",
                 "tools": {"handlers": ["uploadResumeRt", "deleteResumeRt", "renderResumeRt"], "endpoints": ["POST /api/besoins/<id>/candidats/<idx>/resume-rt", "GET /api/besoins/<id>/candidats/<idx>/resume-rt", "DELETE /api/besoins/<id>/candidats/<idx>/resume-rt"], "backend": ["routes/besoins.py:api_besoin_resume_rt_upload", "routes/besoins.py:api_besoin_resume_rt_download", "routes/besoins.py:api_besoin_resume_rt_delete"]}},
            ],
        },
        {
            "id": "collab", "label": "Collaboration", "cat": "outils",
            "icon": "🤝", "href": "/v30/collab",
            "summary": "Partage d'entreprises et de prospects entre coéquipiers.",
            "actions": [
                {"label": "Lister les collaborateurs", "href": "/v30/collab",
                 "tools": {"handlers": ["loadCollaborators"], "endpoints": ["GET /api/collab/collaborators"], "backend": ["routes/collab.py:api_collab_collaborators"]}},
                {"label": "Partager une entreprise", "href": "/v30/collab",
                 "tools": {"handlers": ["openShareCompany", "shareCompany"], "endpoints": ["POST /api/collab/share-company"], "backend": ["routes/collab.py:api_collab_share_company"]}},
                {"label": "Mes partages (envoyés)", "href": "/v30/collab",
                 "tools": {"handlers": ["loadSharedCompanies"], "endpoints": ["GET /api/collab/shared-companies"], "backend": ["routes/collab.py:api_collab_shared_companies"]}},
                {"label": "Reçus (collaborateurs → moi)", "href": "/v30/collab",
                 "tools": {"handlers": ["loadReceived"], "endpoints": ["GET /api/collab/shared-companies", "GET /api/collab/shared-prospects"], "backend": ["routes/collab.py:api_collab_shared_companies"]}},
                {"label": "Voir prospects partagés (entreprise)", "href": "/v30/collab",
                 "tools": {"handlers": ["loadSharedProspects"], "endpoints": ["GET /api/collab/shared-company/<id>/prospects"], "backend": ["routes/collab.py:api_collab_shared_company_prospects"]}},
                {"label": "Éditer un prospect partagé", "href": "/v30/collab",
                 "tools": {"handlers": ["editSharedProspect"], "endpoints": ["PUT /api/collab/shared-company/<cid>/prospect/<pid>", "PATCH /api/collab/shared-company/<cid>/prospect/<pid>"], "backend": ["routes/collab.py:api_collab_shared_prospect_edit"]}},
                {"label": "Cesser le partage", "href": "/v30/collab",
                 "tools": {"handlers": ["unshareCompany"], "endpoints": ["POST /api/collab/unshare-company"], "backend": ["routes/collab.py:api_collab_unshare_company"]}},
            ],
        },
        {
            "id": "duplicates", "label": "Doublons", "cat": "outils",
            "icon": "🧹", "href": "/v30/duplicates",
            "summary": "Détection et fusion des doublons (similarité configurable).",
            "actions": [
                {"label": "Scanner les doublons", "href": "/v30/duplicates",
                 "tools": {"handlers": ["scanDuplicates"], "endpoints": ["GET /api/duplicates"], "backend": ["routes/duplicates.py:api_duplicates_list"]}},
                {"label": "Régler le seuil de similarité", "href": "/v30/duplicates",
                 "tools": {"handlers": ["onThresholdChange"], "endpoints": ["GET /api/duplicates"], "backend": []}},
                {"label": "Aperçu fusion (preview)", "href": "/v30/duplicates",
                 "tools": {"handlers": ["openMergePreview"], "endpoints": ["GET /api/duplicates/merge-preview"], "backend": ["routes/duplicates.py:api_duplicates_merge_preview"]}},
                {"label": "Fusionner prospects", "href": "/v30/duplicates",
                 "tools": {"handlers": ["mergeProspects"], "endpoints": ["POST /api/duplicates/merge"], "backend": ["routes/duplicates.py:api_duplicates_merge"]}},
                {"label": "Fusionner entreprises", "href": "/v30/duplicates",
                 "tools": {"handlers": ["mergeCompanies"], "endpoints": ["POST /api/companies/merge"], "backend": ["app.py:api_companies_merge"]}},
                {"label": "Ignorer un doublon", "href": "/v30/duplicates",
                 "tools": {"handlers": ["ignoreDuplicate"], "endpoints": ["POST /api/duplicates/ignore"], "backend": ["routes/duplicates.py:api_duplicates_ignore"]}},
                {"label": "Vérifier doublons (à la création)", "href": "/v30/prospects#add",
                 "tools": {"handlers": ["checkDuplicates"], "endpoints": ["POST /api/prospects/check-duplicates"], "backend": ["routes/duplicates.py:api_prospects_check_duplicates"]}},
            ],
        },
        {
            "id": "dc", "label": "DC Generator", "cat": "autres",
            "icon": "📑", "href": "/v30/parametres?card=dc",
            "summary": "Dossier de compétence — outil expérimental, accessible depuis Paramètres → Anciens outils / essais.",
            "actions": [
                {"label": "Sélectionner un candidat", "href": "/v30/dc",
                 "tools": {"handlers": ["pickCandidate"], "endpoints": ["GET /api/candidates", "GET /api/candidates/<id>"], "backend": ["routes/candidates.py:api_candidates_list"]}},
                {"label": "Uploader le CV (PDF/DOCX)", "href": "/v30/dc",
                 "tools": {"handlers": ["uploadCV"], "endpoints": ["POST /api/candidates/upload-dc", "POST /api/candidates/extract-dc"], "backend": ["routes/candidates.py:api_candidates_extract_dc"]}},
                {"label": "Données entretien (fiche)", "href": "/v30/dc",
                 "tools": {"handlers": ["fillEntretien"], "endpoints": ["GET /api/candidates/fiche-entretien-template", "POST /api/candidates/parse-fiche-entretien"], "backend": ["routes/candidates.py:api_fiche_entretien_template"]}},
                {"label": "Enrichir DC (IA)", "href": "/v30/dc",
                 "tools": {"handlers": ["enrichDC"], "endpoints": ["POST /api/candidates/<id>/dc-enrich"], "backend": ["routes/candidates.py:api_candidates_dc_enrich"]}},
                {"label": "Statut DC", "href": "/v30/dc",
                 "tools": {"handlers": ["loadDcStatus"], "endpoints": ["GET /api/candidates/<id>/dc-status"], "backend": ["routes/candidates.py:api_candidates_dc_status"]}},
                {"label": "Renommer / supprimer DC", "href": "/v30/dc",
                 "tools": {"handlers": ["renameDC", "deleteDC"], "endpoints": ["POST /api/candidates/<id>/dc-rename", "POST /api/candidates/<id>/dc-delete"], "backend": ["routes/candidates.py:api_candidates_dc_rename"]}},
                {"label": "Historique DC", "href": "/v30/dc",
                 "tools": {"handlers": ["loadDcHistory"], "endpoints": ["GET /api/dc/history"], "backend": ["routes/dc.py:api_dc_history"]}},
                {"label": "Télécharger DOCX", "href": "/v30/dc",
                 "tools": {"handlers": ["downloadDC"], "endpoints": ["GET /api/dc/<id>/download"], "backend": ["routes/dc.py:api_dc_download"]}},
            ],
        },

        # ─── ADMIN ─────────────────────────────────────────────
        {
            "id": "users", "label": "Utilisateurs", "cat": "admin",
            "icon": "👥", "href": "/v30/parametres?card=users", "adminOnly": True,
            "summary": "Gestion comptes, rôles, derniers logins (déployable dans Paramètres → Admin).",
            "actions": [
                {"label": "Lister les utilisateurs", "href": "/v30/users",
                 "tools": {"handlers": ["loadUsers"], "endpoints": ["GET /api/users"], "backend": ["app.py:api_users_list"]}},
                {"label": "Créer un utilisateur", "href": "/v30/users",
                 "tools": {"handlers": ["openUserModal", "saveUser"], "endpoints": ["POST /api/users/save"], "backend": ["app.py:api_users_save"]}},
                {"label": "Éditer rôle (éditeur/admin)", "href": "/v30/users",
                 "tools": {"handlers": ["editRole"], "endpoints": ["POST /api/users/save"], "backend": ["app.py:api_users_save"]}},
                {"label": "Réinitialiser mot de passe", "href": "/v30/users",
                 "tools": {"handlers": ["resetPassword"], "endpoints": ["POST /api/users/save"], "backend": ["app.py:api_users_save"]}},
                {"label": "Supprimer utilisateur", "href": "/v30/users",
                 "tools": {"handlers": ["inlineDelete"], "endpoints": ["POST /api/users/delete"], "backend": ["app.py:api_users_delete"]}},
                {"label": "Voir données d'un user", "href": "/v30/users",
                 "tools": {"handlers": ["openUserData"], "endpoints": ["GET /api/users/<id>/data"], "backend": ["app.py:api_user_data"]}},
                {"label": "Réassigner ownership (admin)", "href": "/v30/users",
                 "tools": {"handlers": ["reassignOwnership"], "endpoints": ["POST /api/admin/reassign-ownership"], "backend": ["app.py:api_admin_reassign_ownership"]}},
            ],
        },
        {
            "id": "snapshots", "label": "Snapshots", "cat": "admin",
            "icon": "💾", "href": "/v30/parametres?card=backup",
            "summary": "Sauvegardes de la base SQLite (déployable dans Paramètres → Sauvegardes).",
            "actions": [
                {"label": "Lister les snapshots", "href": "/v30/snapshots",
                 "tools": {"handlers": ["loadSnapshots"], "endpoints": ["GET /api/snapshots", "GET /api/admin/backups"], "backend": ["routes/admin.py:api_snapshots_list"]}},
                {"label": "Créer un snapshot", "href": "/v30/snapshots",
                 "tools": {"handlers": ["createSnapshot"], "endpoints": ["POST /api/snapshots/create", "POST /api/admin/backup/trigger"], "backend": ["routes/admin.py:api_snapshots_create"]}},
                {"label": "Restaurer une sauvegarde", "href": "/v30/snapshots",
                 "tools": {"handlers": ["restoreSnapshot"], "endpoints": ["POST /api/snapshots/restore"], "backend": ["routes/admin.py:api_snapshots_restore"]}},
                {"label": "Supprimer un snapshot", "href": "/v30/snapshots",
                 "tools": {"handlers": ["deleteSnapshot"], "endpoints": ["POST /api/snapshots/delete"], "backend": ["routes/admin.py:api_snapshots_delete"]}},
            ],
        },
        {
            "id": "activity", "label": "Journal", "cat": "admin",
            "icon": "📜", "href": "/v30/parametres?card=activity", "adminOnly": True,
            "summary": "Audit — login, modifications, push, suppressions (déployable dans Paramètres → Admin).",
            "actions": [
                {"label": "Charger le journal", "href": "/v30/activity",
                 "tools": {"handlers": ["loadActivity"], "endpoints": ["GET /api/activity", "GET /api/audit-log"], "backend": ["routes/misc.py:api_activity"]}},
                {"label": "Filtrer par utilisateur", "href": "/v30/activity",
                 "tools": {"handlers": ["filterByUser"], "endpoints": ["GET /api/activity"], "backend": []}},
                {"label": "Filtrer par action", "href": "/v30/activity",
                 "tools": {"handlers": ["filterByAction"], "endpoints": ["GET /api/activity"], "backend": []}},
                {"label": "Pagination", "href": "/v30/activity",
                 "tools": {"handlers": ["nextPage"], "endpoints": ["GET /api/activity"], "backend": []}},
            ],
        },
        {
            "id": "metiers", "label": "Métiers IA", "cat": "outils",
            "icon": "🧠", "href": "/v30/metiers",
            "summary": "Référentiel métiers — spécialités, certifs, salaires, classification IA des tags.",
            "actions": [
                {"label": "Rechercher un métier", "href": "/v30/metiers",
                 "tools": {"handlers": ["searchMetier"], "endpoints": [], "backend": []}},
                {"label": "Filtrer par domaine", "href": "/v30/metiers",
                 "tools": {"handlers": ["filterByDomain"], "endpoints": [], "backend": []}},
                {"label": "Voir le détail (skills, salaire)", "href": "/v30/metiers",
                 "tools": {"handlers": ["openMetierModal"], "endpoints": [], "backend": []}},
                {"label": "Ajouter un métier custom (admin)", "href": "/v30/metiers",
                 "tools": {"handlers": ["addCustomMetier"], "endpoints": ["GET /api/custom_metiers", "POST /api/custom_metiers", "DELETE /api/custom_metiers/<id>"], "backend": ["app.py:api_custom_metiers"]}},
                {"label": "Classifier les tags par IA", "href": "/v30/metiers",
                 "tools": {"handlers": ["classifyTags"], "endpoints": ["GET /api/prospects/tags-count", "POST /api/metiers/classify-tags-batch", "POST /api/metiers/batch-confirm-tags"], "backend": ["app.py:api_metiers_classify_tags"]}},
                {"label": "Intégrer les tags classifiés", "href": "/v30/metiers",
                 "tools": {"handlers": ["integrateTags"], "endpoints": ["POST /api/metiers/integrate-tags", "GET /api/metiers/integrations-cache"], "backend": ["routes/misc.py:api_metiers_integrate_tags"]}},
                {"label": "Exporter JSON métiers", "href": "/v30/metiers",
                 "tools": {"handlers": ["exportJson"], "endpoints": [], "backend": []}},
            ],
        },

        # ─── AUTRES ────────────────────────────────────────────
        {
            "id": "help", "label": "Aide", "cat": "autres",
            "icon": "💡", "href": "/v30/help",
            "summary": "Centre d'aide — démarrage, workflows, raccourcis clavier.",
            "actions": [
                {"label": "Raccourcis clavier", "href": "/v30/help#shortcuts",
                 "tools": {"handlers": ["openShortcutsModal"], "endpoints": [], "backend": []}},
                {"label": "Démarrage rapide", "href": "/v30/help#start",
                 "tools": {"handlers": ["scrollToSection"], "endpoints": [], "backend": []}},
                {"label": "Workflows métier", "href": "/v30/help",
                 "tools": {"handlers": ["scrollToSection"], "endpoints": [], "backend": []}},
                {"label": "Mode emploi (docs)", "href": "/v30/help",
                 "tools": {"handlers": ["openExternalDoc"], "endpoints": [], "backend": []}},
            ],
        },
        {
            "id": "mode-prosp", "label": "Mode Prosp", "cat": "autres",
            "icon": "⚡", "href": "/v30/mode-prosp",
            "summary": "Deck plein écran — navigation rapide entre prospects.",
            "actions": [
                {"label": "Démarrer la session", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["startSession"], "endpoints": ["POST /api/mode-prosp/start", "GET /api/mode-prosp/data"], "backend": ["app.py:api_mode_prosp_start"]}},
                {"label": "Précédent / Suivant (← →)", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["nextSlide", "prevSlide"], "endpoints": [], "backend": []}},
                {"label": "Appeler (C, tel:)", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["callProspect"], "endpoints": ["POST /api/prospect/log-call"], "backend": ["routes/prospects.py:api_prospect_log_call"]}},
                {"label": "Email (M, mailto:)", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["mailProspect"], "endpoints": [], "backend": []}},
                {"label": "LinkedIn (L, window.open)", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["openLinkedIn"], "endpoints": [], "backend": []}},
                {"label": "Demander à l'IA (I)", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["askAI"], "endpoints": ["POST /api/ollama/generate", "POST /api/ollama/generate-stream"], "backend": ["routes/ai.py:api_ollama_generate"]}},
                {"label": "Note (N)", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["saveNote"], "endpoints": ["POST /api/mode-prosp/save"], "backend": ["app.py:api_mode_prosp_save"]}},
                {"label": "Changer statut (S)", "href": "/v30/mode-prosp",
                 "tools": {"handlers": ["setStatus"], "endpoints": ["POST /api/mode-prosp/save", "POST /api/prospects/bulk-update"], "backend": ["app.py:api_mode_prosp_save"]}},
            ],
        },
        {
            "id": "parametres", "label": "Paramètres", "cat": "autres",
            "icon": "⚙️", "href": "/v30/parametres",
            "summary": "IA, objectifs, KPI, notifs, sauvegardes, déploiement.",
            "actions": [
                {"label": "Configuration IA (admin)", "href": "/v30/parametres#ia",
                 "tools": {"handlers": ["loadAiConfig", "saveAiConfig"], "endpoints": ["GET /api/ai/config", "POST /api/ai/config", "POST /api/ai/test"], "backend": ["routes/ai.py:api_ai_config"]}},
                {"label": "Modèles IA (Ollama)", "href": "/v30/parametres#ia",
                 "tools": {"handlers": ["loadOllamaModels", "pullModel", "deleteModel"], "endpoints": ["GET /api/ollama/models", "POST /api/ollama/pull", "DELETE /api/ollama/model", "GET /api/ollama/recommended"], "backend": ["routes/ai.py:api_ollama_models"]}},
                {"label": "Objectifs & gamification", "href": "/v30/parametres#goals",
                 "tools": {"handlers": ["saveGoals"], "endpoints": ["GET /api/settings", "POST /api/settings"], "backend": ["routes/settings.py:api_settings"]}},
                {"label": "Report d'objectifs au jour ouvré suivant (toggle)", "href": "/v30/parametres#goals",
                 "tools": {"handlers": ["goalsLoad", "goalsBuildFromUI", "goalsSave"], "endpoints": ["POST /api/settings"], "backend": ["routes/settings.py:api_settings", "services/dashboard_goals.py:get_goals_config"]}},
                {"label": "KPI manuels", "href": "/v30/parametres#kpi",
                 "tools": {"handlers": ["loadKpi", "saveKpi"], "endpoints": ["GET /api/manual-kpi", "POST /api/manual-kpi", "POST /api/kpi/export/xlsx"], "backend": ["app.py:api_manual_kpi"]}},
                {"label": "Calendrier externe (ICS)", "href": "/v30/parametres#calsync",
                 "tools": {"handlers": ["saveCalSync"], "endpoints": ["GET /api/settings", "POST /api/settings"], "backend": ["routes/settings.py:api_settings"]}},
                {"label": "Notifications", "href": "/v30/parametres#notif",
                 "tools": {"handlers": ["saveNotif"], "endpoints": ["POST /api/settings"], "backend": ["routes/settings.py:api_settings"]}},
                {"label": "Rapports email (quotidien + hebdo)", "href": "/v30/parametres#email-reports",
                 "tools": {"handlers": ["emailSave", "emailTest", "emailPreview", "emailSendNow"],
                           "endpoints": ["GET /api/settings", "POST /api/settings", "GET /api/email-reports/preview", "POST /api/email-reports/send", "POST /api/email-reports/test"],
                           "backend": ["routes/settings.py:api_email_reports_preview", "routes/settings.py:api_email_reports_send", "routes/settings.py:api_email_reports_test", "services/email_reports.py:build_and_send_daily", "services/email_reports.py:build_and_send_weekly"]}},
                {"label": "Snapshots auto", "href": "/v30/parametres#snapshots",
                 "tools": {"handlers": ["openSnapshots"], "endpoints": ["GET /api/snapshots"], "backend": ["routes/admin.py:api_snapshots_list"]}},
                {"label": "Mot de passe (changer)", "href": "/v30/parametres#account",
                 "tools": {"handlers": ["changePassword"], "endpoints": ["POST /api/auth/change-password"], "backend": ["routes/auth.py:api_change_password"]}},
                {"label": "Profil (avatar, nom, email)", "href": "/v30/parametres#account",
                 "tools": {"handlers": ["updateProfile", "uploadAvatar"], "endpoints": ["PATCH /api/auth/profile", "POST /api/auth/avatar"], "backend": ["routes/auth.py:api_auth_profile_update"]}},
                {"label": "Mise à jour serveur (admin)", "href": "/v30/parametres#deploy",
                 "tools": {"handlers": ["deployPull"], "endpoints": ["POST /api/deploy/pull", "GET /api/deploy/health", "GET /api/deploy/check-deps", "GET /api/deploy/update-check"], "backend": ["routes/deploy.py:api_deploy_pull"]}},
                {"label": "Vérifier dépendances", "href": "/v30/parametres#deploy",
                 "tools": {"handlers": ["checkDeps"], "endpoints": ["GET /api/deploy/check-deps", "POST /api/deploy/install-deps"], "backend": ["routes/deploy.py:api_deploy_check_deps"]}},
                {"label": "Rollback du serveur (admin)", "href": "/v30/parametres#deploy",
                 "tools": {"handlers": ["deployRollback"], "endpoints": ["POST /api/deploy/rollback"], "backend": ["routes/deploy.py:api_deploy_rollback"]}},
                {"label": "Token de récupération (404)", "href": "/v30/parametres#deploy",
                 "tools": {"handlers": ["showRecoveryToken"], "endpoints": ["GET /api/system/recovery-token"], "backend": ["routes/misc.py:api_system_recovery_token", "app.py:_verify_recovery_token"]}},
                {"label": "Toile d'araignée", "href": "/v30/sitemap",
                 "tools": {"handlers": ["openSitemap"], "endpoints": [], "backend": ["routes/pages.py:page_v30_sitemap"]}},
                {"label": "Exporter mes données", "href": "/v30/parametres#export",
                 "tools": {"handlers": ["fullExport"], "endpoints": ["GET /api/export/xlsx"], "backend": ["routes/misc.py:api_export_xlsx"]}},
            ],
        },
    ]

    # Filtre admin-only si l'utilisateur n'est pas admin
    if not is_admin:
        pages = [p for p in pages if not p.get("adminOnly")]

    # Calcule statut de chaque action et de chaque page
    for page in pages:
        # Bugs ouverts qui ciblent la page mais sans action_id précis
        page_level_bugs = open_bugs.get(f"__page_{page['id']}__", [])
        for idx, action in enumerate(page.get("actions", [])):
            tools = action.get("tools") or {}
            endpoints = tools.get("endpoints") or []
            action_id = f"{page['id']}__act_{idx}"
            label, note = _compute_action_status(
                endpoints, status_data,
                ui_action_status=ui_action_status, action_id=action_id,
            )
            # Override : un bug ouvert force le statut KO sur l'action
            action_bugs = open_bugs.get(action_id, [])
            if action_bugs:
                first_bug = action_bugs[0]
                bug_summary = f"#{first_bug['id']} : {first_bug.get('label') or '?'}"
                if first_bug.get('description'):
                    bug_summary += f" — {first_bug['description'][:80]}"
                if len(action_bugs) > 1:
                    bug_summary += f" (+{len(action_bugs) - 1} autre(s))"
                label = "ko"
                note = f"⚠️ Bug signalé : {bug_summary}"
            action["status"] = label
            action["status_note"] = note
            if action_bugs:
                action["bugs"] = action_bugs

        page_label, page_note = _compute_page_status(page["id"], page.get("actions", []), status_data)
        # Si bug page-level → force KO sur la page elle-même
        if page_level_bugs:
            page_label = "ko"
            page_note = f"⚠️ {len(page_level_bugs)} bug(s) signalé(s) sur cette page (action non identifiée)."
            page["bugs"] = page_level_bugs
        page["status"] = page_label
        page["status_note"] = page_note

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
        "status_meta": {
            "ts": status_data.get("ts") if status_data else None,
            "summary": status_data.get("summary") if status_data else None,
            "open_bugs": sum(len(v) for v in open_bugs.values()),
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
    # v32.68 — Passe le dict brut au lieu d'une string JSON ; le filtre |tojson
    # côté template fait le json.dumps avec échappement XSS-safe (< → <
    # etc.). Avant : json.dumps + |safe = vulnérable si jamais on injectait
    # un jour des données user-controlled dans le sitemap.
    return render_template(
        "v30/sitemap.html",
        app_version=APP_VERSION,
        sitemap_data=data,
        is_admin=is_admin,
    )
