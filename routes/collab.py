"""ProspUp — Blueprint Collab + Dashboard Assistant.

Routes :
- /api/collab/* : partage de companies/prospects entre utilisateurs.
- /api/dashboard/adaptive : KPI adaptatifs.
- /api/dashboard/assistant* : assistant IA contextuel (streaming SSE).
"""
from __future__ import annotations

import datetime
import json
import os
import re
import time
from pathlib import Path

from flask import Blueprint, Response, jsonify, request, send_file, stream_with_context

from app import _audit_log, log_activity, logger
from config import APP_DIR, DATA_DIR
from utils.ai_helpers import _call_ai, _call_ai_web, _load_ai_config, _stream_ai_sse, _stream_ai_web_sse
from utils.auth import _company_owned, _prospect_owned, _uid, login_required, role_required
from utils.common import _now_iso, _today_iso
from utils.db import _auth_conn, _conn, _conn_for_user

collab_bp = Blueprint("collab", __name__)


@collab_bp.get("/api/collab/collaborators")
@login_required
def api_collab_collaborators():
    """Liste des utilisateurs disponibles comme collaborateurs (exclut l'utilisateur connecté)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    with _auth_conn() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, role, is_active FROM users WHERE id != ? AND is_active = 1 ORDER BY display_name, username;",
            (uid,)
        ).fetchall()
    return jsonify(ok=True, collaborators=[dict(r) for r in rows])


@collab_bp.get("/api/collab/shared-companies")
@login_required
def api_collab_shared_companies():
    """Liste des entreprises partagées (reçues et envoyées)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _auth_conn() as aconn:
        sent_rows = aconn.execute(
            """
            SELECT sc.id, sc.company_id, sc.to_user_id, sc.shared_at,
                   u.username, u.display_name
            FROM shared_companies sc
            JOIN users u ON u.id = sc.to_user_id
            WHERE sc.from_user_id = ?
            ORDER BY sc.shared_at DESC;
            """,
            (uid,)
        ).fetchall()

        received_rows = aconn.execute(
            """
            SELECT sc.id, sc.company_id, sc.from_user_id, sc.shared_at,
                   u.username, u.display_name
            FROM shared_companies sc
            JOIN users u ON u.id = sc.from_user_id
            WHERE sc.to_user_id = ?
            ORDER BY sc.shared_at DESC;
            """,
            (uid,)
        ).fetchall()

    def _company_info(company_id: int, owner_id: int) -> dict:
        """Récupère groupe/site d'une entreprise depuis la DB de son propriétaire."""
        try:
            with _conn_for_user(owner_id) as conn:
                c = conn.execute(
                    "SELECT groupe, site FROM companies WHERE id = ? AND owner_id = ? AND deleted_at IS NULL;",
                    (company_id, owner_id)
                ).fetchone()
                if c:
                    return {"groupe": c["groupe"], "site": c["site"]}
        except Exception:
            pass
        return {"groupe": None, "site": None}

    sent = []
    for r in sent_rows:
        d = dict(r)
        d.update(_company_info(r["company_id"], uid))
        sent.append(d)

    received = []
    for r in received_rows:
        d = dict(r)
        d.update(_company_info(r["company_id"], r["from_user_id"]))
        received.append(d)

    return jsonify(ok=True, sent=sent, received=received)


@collab_bp.post("/api/collab/share-company")
@login_required
def api_collab_share_company():
    """Partager une entreprise avec un collaborateur."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    payload = request.get_json(force=True, silent=False) or {}
    company_id = payload.get("company_id")
    to_user_id = payload.get("to_user_id")
    
    if not company_id or not to_user_id:
        return jsonify(ok=False, error="company_id et to_user_id requis"), 400
    
    try:
        company_id = int(company_id)
        to_user_id = int(to_user_id)
    except (ValueError, TypeError):
        return jsonify(ok=False, error="IDs invalides"), 400
    
    if to_user_id == uid:
        return jsonify(ok=False, error="Impossible de partager avec soi-même"), 400
    
    # Vérifier que l'entreprise appartient à l'utilisateur
    with _conn() as conn:
        company = conn.execute(
            "SELECT * FROM companies WHERE id = ? AND owner_id = ? AND deleted_at IS NULL;",
            (company_id, uid)
        ).fetchone()
        if not company:
            return jsonify(ok=False, error="Entreprise non trouvée"), 404
    
    # Vérifier que le collaborateur existe
    with _auth_conn() as aconn:
        collaborator = aconn.execute(
            "SELECT id, username, display_name FROM users WHERE id = ? AND is_active = 1;",
            (to_user_id,)
        ).fetchone()
        if not collaborator:
            return jsonify(ok=False, error="Collaborateur non trouvé"), 404
        
        # Vérifier si déjà partagé
        existing = aconn.execute(
            "SELECT id FROM shared_companies WHERE company_id = ? AND from_user_id = ? AND to_user_id = ?;",
            (company_id, uid, to_user_id)
        ).fetchone()
        if existing:
            return jsonify(ok=False, error="Cette entreprise est déjà partagée avec ce collaborateur"), 409
        
        # Créer le partage
        now = _now_iso()
        aconn.execute(
            "INSERT INTO shared_companies (company_id, from_user_id, to_user_id, shared_at) VALUES (?, ?, ?, ?);",
            (company_id, uid, to_user_id, now)
        )
    
    # Copier l'entreprise et ses prospects dans la DB du collaborateur
    _sync_shared_company_to_collaborator(company_id, uid, to_user_id)
    
    return jsonify(ok=True, message="Entreprise partagée avec succès")


def _sync_shared_company_to_collaborator(company_id: int, from_user_id: int, to_user_id: int) -> None:
    """Copie une entreprise partagée et ses prospects dans la DB du collaborateur."""
    # Lire l'entreprise et ses prospects depuis la DB de l'utilisateur source
    with _conn_for_user(from_user_id) as from_conn:
        company = from_conn.execute(
            "SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL;",
            (company_id,)
        ).fetchone()
        if not company:
            return
        
        prospects = from_conn.execute(
            "SELECT * FROM prospects WHERE company_id = ? AND deleted_at IS NULL;",
            (company_id,)
        ).fetchall()
    
    # Écrire dans la DB du collaborateur
    with _conn_for_user(to_user_id) as to_conn:
        to_conn.execute("PRAGMA foreign_keys = OFF;")
        try:
            # Vérifier si l'entreprise existe déjà (par groupe+site)
            existing = to_conn.execute(
                "SELECT id FROM companies WHERE groupe = ? AND site = ? AND owner_id = ?;",
                (company["groupe"], company["site"], to_user_id)
            ).fetchone()
            
            if existing:
                target_company_id = existing["id"]
            else:
                # Insérer l'entreprise
                to_conn.execute(
                    """
                    INSERT OR REPLACE INTO companies 
                    (id, groupe, site, phone, notes, tags, website, linkedin, industry, size, 
                     address, city, country, stack, pain_points, budget, urgency, owner_id, deleted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);
                    """,
                    (
                        company["id"], company["groupe"], company["site"], company.get("phone"),
                        company.get("notes"), company.get("tags"), company.get("website"),
                        company.get("linkedin"), company.get("industry"), company.get("size"),
                        company.get("address"), company.get("city"), company.get("country"),
                        company.get("stack"), company.get("pain_points"), company.get("budget"),
                        company.get("urgency"), to_user_id
                    )
                )
                target_company_id = company["id"]
            
            # Insérer/mettre à jour les prospects
            for p_row in prospects:
                p = dict(p_row)
                to_conn.execute(
                    """
                    INSERT OR REPLACE INTO prospects
                    (id, name, company_id, fonction, telephone, email, linkedin, pertinence, statut,
                     lastContact, nextFollowUp, priority, notes, callNotes, pushEmailSentAt, tags,
                     template_id, nextAction, pushLinkedInSentAt, photo_url, push_category_id,
                     fixedMetier, rdvDate, is_archived, owner_id, deleted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL);
                    """,
                    (
                        p["id"], p["name"], target_company_id, p.get("fonction"), p.get("telephone"),
                        p.get("email"), p.get("linkedin"), p.get("pertinence"), p.get("statut"),
                        p.get("lastContact"), p.get("nextFollowUp"), p.get("priority"),
                        p.get("notes"), p.get("callNotes"), p.get("pushEmailSentAt"), p.get("tags"),
                        p.get("template_id"), p.get("nextAction"), p.get("pushLinkedInSentAt"),
                        p.get("photo_url"), p.get("push_category_id"), p.get("fixedMetier"),
                        p.get("rdvDate"), p.get("is_archived"), to_user_id
                    )
                )
        finally:
            to_conn.execute("PRAGMA foreign_keys = ON;")


@collab_bp.get("/api/collab/shared-company/<int:company_id>/prospects")
@login_required
def api_collab_shared_company_prospects(company_id: int):
    """Liste des prospects d'une entreprise partagée (lus depuis la DB du partageur)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    # Vérifier que l'entreprise est bien partagée avec l'utilisateur
    with _auth_conn() as aconn:
        share = aconn.execute(
            """SELECT sc.from_user_id, u.display_name, u.username
               FROM shared_companies sc
               JOIN users u ON u.id = sc.from_user_id
               WHERE sc.company_id = ? AND sc.to_user_id = ?;""",
            (company_id, uid)
        ).fetchone()
        if not share:
            return jsonify(ok=False, error="Entreprise non partagée"), 404

    from_user_id = share["from_user_id"]
    sharer_name = share["display_name"] or share["username"] or "?"

    # Lire les prospects directement depuis la DB du partageur
    with _conn_for_user(from_user_id) as conn:
        prospects = conn.execute(
            "SELECT * FROM prospects WHERE company_id = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY id;",
            (company_id, from_user_id)
        ).fetchall()

    def _parse_tags(v):
        if not v:
            return []
        try:
            return json.loads(v) if isinstance(v, str) else v
        except Exception:
            return [t.strip() for t in str(v).split(",") if t.strip()]

    result = []
    for p in prospects:
        d = dict(p)
        try:
            d["callNotes"] = json.loads(d.get("callNotes") or "[]")
        except Exception:
            d["callNotes"] = []
        d["tags"] = _parse_tags(d.get("tags"))
        d["is_archived"] = int(d.get("is_archived") or 0)
        result.append(d)

    return jsonify(ok=True, prospects=result, sharer_name=sharer_name, from_user_id=from_user_id)


@collab_bp.route("/api/collab/shared-company/<int:company_id>/prospect/<int:prospect_id>", methods=["PUT", "PATCH"])
@login_required
def api_collab_shared_company_prospect_update(company_id: int, prospect_id: int):
    """Met à jour un prospect d'une entreprise partagée (dans la DB du partageur)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    # Vérifier le partage
    with _auth_conn() as aconn:
        share = aconn.execute(
            "SELECT from_user_id FROM shared_companies WHERE company_id = ? AND to_user_id = ?;",
            (company_id, uid)
        ).fetchone()
        if not share:
            return jsonify(ok=False, error="Accès refusé"), 403

    from_user_id = share["from_user_id"]
    payload = request.get_json(force=True, silent=True) or {}

    # Champs autorisés (pas de suppression, pas de changement d'owner/identity)
    allowed = ['statut', 'notes', 'lastContact', 'nextFollowUp', 'pertinence',
               'callNotes', 'tags', 'nextAction', 'rdvDate', 'priority', 'is_archived']
    updates = {k: v for k, v in payload.items() if k in allowed}

    if not updates:
        return jsonify(ok=False, error="Aucun champ à mettre à jour"), 400

    # Sérialiser callNotes et tags si nécessaire
    if 'callNotes' in updates and isinstance(updates['callNotes'], (list, dict)):
        updates['callNotes'] = json.dumps(updates['callNotes'], ensure_ascii=False)
    if 'tags' in updates and isinstance(updates['tags'], list):
        updates['tags'] = json.dumps(updates['tags'], ensure_ascii=False)

    with _conn_for_user(from_user_id) as conn:
        prospect = conn.execute(
            "SELECT id FROM prospects WHERE id = ? AND company_id = ? AND owner_id = ? AND deleted_at IS NULL;",
            (prospect_id, company_id, from_user_id)
        ).fetchone()
        if not prospect:
            return jsonify(ok=False, error="Prospect non trouvé"), 404

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [prospect_id]
        conn.execute(f"UPDATE prospects SET {set_clause} WHERE id = ?;", values)

    return jsonify(ok=True)


@collab_bp.get("/api/collab/shared-prospects")
@login_required
def api_collab_shared_prospects():
    """Retourne tous les prospects des entreprises partagées avec l'utilisateur courant."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401

    with _auth_conn() as aconn:
        shares = aconn.execute(
            """SELECT sc.company_id, sc.from_user_id, u.display_name, u.username
               FROM shared_companies sc
               JOIN users u ON u.id = sc.from_user_id
               WHERE sc.to_user_id = ?
               ORDER BY sc.shared_at DESC;""",
            (uid,)
        ).fetchall()

    def _parse_tags(v):
        if not v:
            return []
        try:
            return json.loads(v) if isinstance(v, str) else v
        except Exception:
            return [t.strip() for t in str(v).split(",") if t.strip()]

    all_prospects = []
    for share in shares:
        from_user_id = share["from_user_id"]
        company_id = share["company_id"]
        sharer_name = share["display_name"] or share["username"] or "?"
        try:
            with _conn_for_user(from_user_id) as conn:
                company = conn.execute(
                    "SELECT id, groupe, site FROM companies WHERE id = ? AND owner_id = ? AND deleted_at IS NULL;",
                    (company_id, from_user_id)
                ).fetchone()
                prospects = conn.execute(
                    "SELECT * FROM prospects WHERE company_id = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY id;",
                    (company_id, from_user_id)
                ).fetchall()
            company_name = (company["groupe"] or company["site"] or f"Entreprise #{company_id}") if company else f"Entreprise #{company_id}"
            for p in prospects:
                d = dict(p)
                try:
                    d["callNotes"] = json.loads(d.get("callNotes") or "[]")
                except Exception:
                    d["callNotes"] = []
                d["tags"] = _parse_tags(d.get("tags"))
                d["is_archived"] = int(d.get("is_archived") or 0)
                d["shared_from"] = sharer_name
                d["shared_from_user_id"] = from_user_id
                d["shared_company_id"] = company_id
                d["shared_company_name"] = company_name
                all_prospects.append(d)
        except Exception:
            continue

    return jsonify(ok=True, prospects=all_prospects)


@collab_bp.post("/api/collab/unshare-company")
@login_required
def api_collab_unshare_company():
    """Retirer le partage d'une entreprise."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    payload = request.get_json(force=True, silent=False) or {}
    share_id = payload.get("share_id")
    
    if not share_id:
        return jsonify(ok=False, error="share_id requis"), 400
    
    with _auth_conn() as aconn:
        share = aconn.execute(
            "SELECT * FROM shared_companies WHERE id = ? AND from_user_id = ?;",
            (share_id, uid)
        ).fetchone()
        if not share:
            return jsonify(ok=False, error="Partage non trouvé"), 404
        
        aconn.execute("DELETE FROM shared_companies WHERE id = ?;", (share_id,))
    
    return jsonify(ok=True, message="Partage retiré")


# ═══════════════════════════════════════════════════════════════════
# Dashboard adaptatif et Assistant virtuel (v26.6)
# ═══════════════════════════════════════════════════════════════════

@collab_bp.get("/api/dashboard/adaptive")
def api_dashboard_adaptive():
    """Retourne les recommandations adaptatives basées sur l'activité récente (widgets, priorités)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    today = _today_iso()
    d_today = datetime.date.fromisoformat(today)
    monday = (d_today - datetime.timedelta(days=d_today.weekday())).isoformat()
    
    with _conn() as conn:
        # BUG 27 : exclure les archivés pour cohérence total prospects
        prospects = conn.execute(
            "SELECT * FROM prospects WHERE owner_id=? AND deleted_at IS NULL "
            "AND (is_archived IS NULL OR is_archived=0);",
            (uid,),
        ).fetchall()
        push_logs = conn.execute(
            "SELECT l.* FROM push_logs l JOIN prospects p ON p.id=l.prospect_id AND p.owner_id=? WHERE l.sentAt >= ?;",
            (uid, monday),
        ).fetchall()
        notes = []
        for p in prospects:
            try:
                call_notes = json.loads(p.get("callNotes") or "[]")
                if isinstance(call_notes, list):
                    for n in call_notes:
                        if (n.get("date") or "")[:10] >= monday:
                            notes.append(n)
            except Exception:
                pass
    
    prospects_list = [dict(r) for r in prospects]
    push_list = [dict(r) for r in push_logs]
    
    # Calculer les métriques d'activité
    overdue = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < today]
    due_today = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() == today]
    rdv_this_week = [p for p in prospects_list if (p.get("rdvDate") or "").strip() >= monday and (p.get("rdvDate") or "").strip() <= today]
    recent_activity = len([n for n in notes if (n.get("date") or "")[:10] >= monday]) + len([p for p in push_list if (p.get("sentAt") or "")[:10] >= monday])
    
    # Préparer le contexte pour l'IA
    context = {
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
        "rdv_this_week_count": len(rdv_this_week),
        "recent_activity_count": recent_activity,
        "total_prospects": len(prospects_list),
        "pipeline_status": {s: sum(1 for p in prospects_list if p.get("statut") == s) for s in ["Rendez-vous", "À rappeler", "Messagerie", "Appelé"]},
    }
    
    # Construire le prompt pour l'analyse adaptative
    prompt = f"""Tu es un assistant pour un CRM de prospection B2B. Analyse l'activité récente et génère des recommandations.

Contexte actuel:
- {context['overdue_count']} relances en retard
- {context['due_today_count']} relances à faire aujourd'hui
- {context['rdv_this_week_count']} RDV cette semaine
- {context['recent_activity_count']} actions récentes (notes + push)
- Pipeline: {context['pipeline_status']}

Génère un JSON avec:
1. "priorities": liste de 3 priorités du jour (max 60 caractères chacune)
2. "widgets_to_show": liste des widgets recommandés parmi ["overdue", "rdv", "pipeline", "activity", "goals"]
3. "widgets_to_hide": liste des widgets à masquer
4. "insight": un message d'analyse court (max 100 caractères)

Réponds UNIQUEMENT avec le JSON, sans texte avant/après."""
    
    try:
        ai_response = _call_ai(prompt, timeout=60)
        # Nettoyer la réponse (enlever markdown si présent)
        ai_response = ai_response.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:]
        if ai_response.startswith("```"):
            ai_response = ai_response[3:]
        if ai_response.endswith("```"):
            ai_response = ai_response[:-3]
        ai_response = ai_response.strip()
        
        adaptive_data = json.loads(ai_response)
    except Exception as e:
        logger.warning("Erreur analyse adaptative IA, fallback par défaut: %s", e)
        # Fallback par défaut
        adaptive_data = {
            "priorities": [
                f"Relancer {len(overdue)} prospects en retard" if overdue else "Aucune relance en retard",
                f"{len(due_today)} relances à faire aujourd'hui" if due_today else "Aucune relance prévue",
                f"{len(rdv_this_week)} RDV cette semaine" if rdv_this_week else "Aucun RDV cette semaine",
            ],
            "widgets_to_show": ["overdue", "rdv", "pipeline"] if overdue or rdv_this_week else ["activity", "goals"],
            "widgets_to_hide": [],
            "insight": "Analyse en cours..." if recent_activity < 5 else "Activité soutenue cette semaine",
        }
    
    return jsonify(ok=True, data=adaptive_data)


@collab_bp.post("/api/dashboard/assistant")
def api_dashboard_assistant():
    """Assistant virtuel : répond à des questions en langage naturel et peut exécuter des actions (disponible sur toutes les pages)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    body = request.get_json(force=True) or {}
    question = body.get("question", "").strip()
    if not question:
        return jsonify(ok=False, error="question requise"), 400
    
    # Session ID pour grouper les messages (optionnel, généré si absent)
    session_id = body.get("session_id") or f"session_{uid}_{int(time.time())}"
    
    # Contexte de la page (optionnel)
    page_context = body.get("page_context", "")
    page_description = body.get("page_description", "")
    
    # Récupérer l'historique de conversation (derniers 10 messages)
    with _conn() as conn:
        history_rows = conn.execute(
            "SELECT role, content FROM assistant_history WHERE user_id=? AND session_id=? ORDER BY createdAt DESC LIMIT 10;",
            (uid, session_id)
        ).fetchall()
        conversation_history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]
    
    # Sauvegarder la question de l'utilisateur
    with _conn() as conn:
        conn.execute(
            "INSERT INTO assistant_history (user_id, session_id, role, content, createdAt) VALUES (?, ?, 'user', ?, datetime('now'));",
            (uid, session_id, question)
        )
    
    today = _today_iso()
    d_today = datetime.date.fromisoformat(today)
    monday = (d_today - datetime.timedelta(days=d_today.weekday())).isoformat()
    
    # Récupérer le contexte disponible selon la page
    with _conn() as conn:
        prospects = conn.execute("SELECT id, name, statut, nextFollowUp, rdvDate, company_id, tags, pertinence FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchall()
        companies = conn.execute("SELECT id, groupe, site, tags FROM companies WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchall()
        candidates = conn.execute("SELECT id, name, status, skills, role FROM candidates WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchall()
        tasks = conn.execute("SELECT id, title, status, due_date FROM tasks WHERE owner_id=? AND status='pending' ORDER BY due_date ASC LIMIT 10;", (uid,)).fetchall()
    
    prospects_list = [dict(r) for r in prospects]
    companies_list = [dict(r) for r in companies]
    candidates_list = [dict(r) for r in candidates]
    tasks_list = [dict(r) for r in tasks]
    
    # Construire le contexte pour l'IA selon la page
    overdue_prospects = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() and p["nextFollowUp"].strip() < today]
    due_today_prospects = [p for p in prospects_list if (p.get("nextFollowUp") or "").strip() == today]
    rdv_prospects = [p for p in prospects_list if p.get("statut") == "Rendez-vous"]
    
    # Contexte de base
    context_summary = f"""Contexte disponible:
- {len(prospects_list)} prospects au total
- {len(overdue_prospects)} relances en retard
- {len(due_today_prospects)} relances à faire aujourd'hui
- {len(rdv_prospects)} prospects en RDV
- {len(companies_list)} entreprises
- {len(candidates_list)} candidats
- {len(tasks_list)} tâches en cours

Statuts prospects: {', '.join(set(p.get('statut') or 'Inconnu' for p in prospects_list))}
"""
    
    # Enrichir selon le contexte de la page
    if page_context:
        context_summary += f"\nContexte de la page: {page_description}\n"
        
        if "prospects" in page_context.lower() or "Gestion des prospects" in page_context:
            context_summary += f"\nExemples de prospects (max 5):\n"
            for p in prospects_list[:5]:
                tags_str = ', '.join(json.loads(p.get('tags') or '[]')[:3]) if p.get('tags') else 'Aucun'
                context_summary += f"- {p['name']} (ID: {p['id']}, statut: {p.get('statut', 'N/A')}, pertinence: {p.get('pertinence', 'N/A')}, tags: {tags_str})\n"
        
        elif "candidat" in page_context.lower() or "Sourcing" in page_context:
            context_summary += f"\nExemples de candidats (max 5):\n"
            for c in candidates_list[:5]:
                skills_str = ', '.join(json.loads(c.get('skills') or '[]')[:3]) if c.get('skills') else 'Aucune'
                context_summary += f"- {c['name']} (ID: {c['id']}, rôle: {c.get('role', 'N/A')}, compétences: {skills_str})\n"
        
        elif "entreprise" in page_context.lower():
            context_summary += f"\nExemples d'entreprises (max 5):\n"
            for c in companies_list[:5]:
                context_summary += f"- {c.get('groupe', 'N/A')} (ID: {c['id']}, site: {c.get('site', 'N/A')})\n"
        
        elif "Focus" in page_context or "focus" in page_context.lower():
            context_summary += f"\nRelances en retard (max 5):\n"
            for p in overdue_prospects[:5]:
                context_summary += f"- {p['name']} (ID: {p['id']}, relance: {p.get('nextFollowUp', 'N/A')})\n"
            context_summary += f"\nTâches en cours (max 5):\n"
            for t in tasks_list[:5]:
                context_summary += f"- {t.get('title', 'N/A')} (échéance: {t.get('due_date', 'N/A')})\n"
    
    context_summary += f"\nExemples de prospects en retard (max 3):\n"
    for p in overdue_prospects[:3]:
        context_summary += f"- {p['name']} (ID: {p['id']}, statut: {p.get('statut', 'N/A')}, relance: {p.get('nextFollowUp', 'N/A')})\n"
    
    # Construire l'historique de conversation pour le prompt
    history_text = ""
    if conversation_history:
        history_text = "\n\nHistorique de la conversation (référence-toi si nécessaire):\n"
        for msg in conversation_history[-5:]:  # Derniers 5 messages
            role_label = "Utilisateur" if msg["role"] == "user" else "Assistant"
            history_text += f"{role_label}: {msg['content']}\n"
    
    prompt = f"""Tu es un assistant virtuel intelligent pour un CRM de prospection B2B. L'utilisateur pose une question en langage naturel.

{context_summary}{history_text}

Question actuelle de l'utilisateur: "{question}"

Analyse la question et génère une réponse JSON avec:
1. "answer": réponse textuelle claire, concise et utile (max 300 caractères). Sois proactif et propose des actions concrètes.
2. "intent": intention détectée parmi ["filter", "create", "modify", "display", "action", "info", "ia_function"]
3. "actions": liste d'actions possibles (chaque action = {{"type": "...", "label": "...", "params": {{...}}}})
   
Types d'actions disponibles:
- "filter": filtrer des prospects (params: {{"field": "statut|nextFollowUp|sector|...", "value": "..."}})
- "open": ouvrir une fiche (params: {{"id": prospect_id|candidate_id|company_id, "type": "prospect|candidate|company"}})
- "navigate": naviguer vers une page (params: {{"url": "/focus|/sourcing|/stats|/dashboard|..."}})
- "create_prospect": créer un prospect (params: {{"name": "...", "company": "...", "fonction": "...", ...}})
- "create_company": créer une entreprise (params: {{"groupe": "...", "site": "...", ...}})
- "create_candidate": créer un candidat (params: {{"name": "...", "role": "...", "skills": [...], ...}})
- "modify_prospect": modifier un prospect (params: {{"id": ..., "field": "...", "value": "..."}})
- "ia_scrap": enrichir avec l'IA (params: {{"type": "prospect|candidate|company", "id": ...}})
- "ia_avant_reunion": générer fiche préparation RDV (params: {{"prospect_id": ...}})
- "ia_apres_reunion": générer compte-rendu après réunion (params: {{"prospect_id": ...}})

Exemples d'actions intelligentes:
- Pour "prospects à relancer": {{"type": "navigate", "label": "Voir les relances en retard", "params": {{"url": "/focus"}}}}
- Pour "créer un prospect Jean Dupont": {{"type": "create_prospect", "label": "Créer le prospect", "params": {{"name": "Jean Dupont", "company": "..."}}}}
- Pour "enrichis ce prospect avec l'IA": {{"type": "ia_scrap", "label": "Enrichir avec l'IA", "params": {{"type": "prospect", "id": ...}}}}
- Pour "génère la fiche avant réunion": {{"type": "ia_avant_reunion", "label": "Générer fiche préparation", "params": {{"prospect_id": ...}}}}

Réponds UNIQUEMENT avec le JSON, sans texte avant/après."""
    
    try:
        ai_response = _call_ai(prompt, timeout=90)
        # Nettoyer la réponse
        ai_response = ai_response.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:]
        if ai_response.startswith("```"):
            ai_response = ai_response[3:]
        if ai_response.endswith("```"):
            ai_response = ai_response[:-3]
        ai_response = ai_response.strip()
        
        assistant_data = json.loads(ai_response)
        
        # Enrichir les actions avec les IDs réels si possible
        if assistant_data.get("intent") == "filter" and "prospects" in question.lower():
            # Détecter les filtres courants
            if "relancer" in question.lower() or "retard" in question.lower():
                assistant_data["actions"] = [{
                    "type": "navigate",
                    "label": "Voir les relances en retard",
                    "params": {"url": "/focus"}
                }]
            elif "rdv" in question.lower() or "rendez-vous" in question.lower():
                assistant_data["actions"] = [{
                    "type": "filter",
                    "label": "Voir les prospects en RDV",
                    "params": {"field": "statut", "value": "Rendez-vous"}
                }]
        
        # Sauvegarder la réponse de l'assistant
        answer_text = assistant_data.get("answer", "")
        with _conn() as conn:
            conn.execute(
                "INSERT INTO assistant_history (user_id, session_id, role, content, metadata, createdAt) VALUES (?, ?, 'assistant', ?, ?, datetime('now'));",
                (uid, session_id, answer_text, json.dumps({"intent": assistant_data.get("intent"), "actions_count": len(assistant_data.get("actions", []))}))
            )
        
        assistant_data["session_id"] = session_id
        
    except Exception as e:
        logger.warning("Erreur assistant IA: %s", e)
        assistant_data = {
            "answer": "Désolé, je n'ai pas pu traiter votre question. Pouvez-vous reformuler ?",
            "intent": "info",
            "actions": [],
            "session_id": session_id
        }
    
    return jsonify(ok=True, data=assistant_data)


@collab_bp.post("/api/dashboard/assistant-stream")
def api_dashboard_assistant_stream():
    """Assistant virtuel avec streaming SSE pour affichage progressif."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    body = request.get_json(force=True) or {}
    question = body.get("question", "").strip()
    if not question:
        return jsonify(ok=False, error="question requise"), 400
    
    session_id = body.get("session_id") or f"session_{uid}_{int(time.time())}"
    page_context = body.get("page_context", "")
    page_description = body.get("page_description", "")
    
    # Récupérer l'historique
    with _conn() as conn:
        history_rows = conn.execute(
            "SELECT role, content FROM assistant_history WHERE user_id=? AND session_id=? ORDER BY createdAt DESC LIMIT 10;",
            (uid, session_id)
        ).fetchall()
        conversation_history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]
    
    # Sauvegarder la question
    with _conn() as conn:
        conn.execute(
            "INSERT INTO assistant_history (user_id, session_id, role, content, createdAt) VALUES (?, ?, 'user', ?, datetime('now'));",
            (uid, session_id, question)
        )
    
    # Construire le prompt (simplifié pour streaming)
    today = _today_iso()
    with _conn() as conn:
        prospects_count = conn.execute("SELECT COUNT(*) as c FROM prospects WHERE owner_id=? AND deleted_at IS NULL;", (uid,)).fetchone()["c"]
        overdue_count = conn.execute("SELECT COUNT(*) as c FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND nextFollowUp < ?;", (uid, today)).fetchone()["c"]
    
    history_text = ""
    if conversation_history:
        history_text = "\n\nHistorique:\n" + "\n".join([f"{'User' if m['role']=='user' else 'Assistant'}: {m['content']}" for m in conversation_history[-5:]])
    
    prompt = f"""Tu es un assistant virtuel pour un CRM B2B. Contexte: {prospects_count} prospects, {overdue_count} relances en retard. Page: {page_description}.{history_text}\n\nQuestion: "{question}"\n\nRéponds de manière concise et utile."""
    
    def generate():
        full_response = ""
        try:
            yield f"data: {json.dumps({'type': 'start', 'session_id': session_id}, ensure_ascii=False)}\n\n"
            try:
                for event in _stream_ai_sse(prompt, None, 90):
                    if event.startswith("data: "):
                        data_str = event[6:].strip()
                        try:
                            data = json.loads(data_str)
                            if data.get("type") == "token":
                                token = data.get("text", "")
                                full_response += token
                                yield f"data: {json.dumps({'type': 'token', 'text': token}, ensure_ascii=False)}\n\n"
                            elif data.get("type") == "end":
                                # Sauvegarder la réponse complète
                                try:
                                    with _conn() as conn:
                                        conn.execute(
                                            "INSERT INTO assistant_history (user_id, session_id, role, content, createdAt) VALUES (?, ?, 'assistant', ?, datetime('now'));",
                                            (uid, session_id, full_response)
                                        )
                                except Exception as save_err:
                                    logger.warning("Erreur sauvegarde historique: %s", save_err)
                                yield f"data: {json.dumps({'type': 'end', 'session_id': session_id}, ensure_ascii=False)}\n\n"
                                return
                            elif data.get("type") == "error":
                                raise Exception(data.get("message", "Erreur streaming"))
                        except json.JSONDecodeError:
                            continue
                    else:
                        yield event
            except Exception as stream_err:
                logger.error("Erreur dans le stream: %s", stream_err)
                raise
        except Exception as e:
            logger.error("Erreur streaming assistant: %s", e)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
    
    return Response(stream_with_context(generate()), mimetype='text/event-stream')


@collab_bp.get("/api/dashboard/assistant/history")
def api_assistant_history():
    """Récupère l'historique de conversation de l'assistant."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    session_id = request.args.get("session_id")
    limit = int(request.args.get("limit", 50))
    
    with _conn() as conn:
        if session_id:
            rows = conn.execute(
                "SELECT role, content, createdAt FROM assistant_history WHERE user_id=? AND session_id=? ORDER BY createdAt ASC LIMIT ?;",
                (uid, session_id, limit)
            ).fetchall()
        else:
            # Dernière session
            last_session = conn.execute(
                "SELECT session_id FROM assistant_history WHERE user_id=? ORDER BY createdAt DESC LIMIT 1;",
                (uid,)
            ).fetchone()
            if not last_session:
                return jsonify(ok=True, history=[], session_id=None)
            session_id = last_session["session_id"]
            rows = conn.execute(
                "SELECT role, content, createdAt FROM assistant_history WHERE user_id=? AND session_id=? ORDER BY createdAt ASC LIMIT ?;",
                (uid, session_id, limit)
            ).fetchall()
        
        history = [{"role": r["role"], "content": r["content"], "createdAt": r["createdAt"]} for r in rows]
    
    return jsonify(ok=True, history=history, session_id=session_id)


@collab_bp.get("/api/dashboard/assistant/suggestions")
def api_assistant_suggestions():
    """Génère des suggestions de questions intelligentes selon le contexte."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    page_context = request.args.get("page_context", "")
    page_description = request.args.get("page_description", "")
    
    today = _today_iso()
    with _conn() as conn:
        overdue_count = conn.execute("SELECT COUNT(*) as c FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND nextFollowUp < ?;", (uid, today)).fetchone()["c"]
        rdv_count = conn.execute("SELECT COUNT(*) as c FROM prospects WHERE owner_id=? AND deleted_at IS NULL AND statut='Rendez-vous';", (uid,)).fetchone()["c"]
    
    prompt = f"""Génère 5 suggestions de questions pertinentes pour un assistant CRM B2B.
Contexte: {page_description}. {overdue_count} relances en retard, {rdv_count} RDV.
Retourne UNIQUEMENT un JSON array de strings: ["question 1", "question 2", ...]"""
    
    try:
        ai_response = _call_ai(prompt, timeout=30)
        ai_response = ai_response.strip()
        if ai_response.startswith("```json"):
            ai_response = ai_response[7:]
        if ai_response.startswith("```"):
            ai_response = ai_response[3:]
        if ai_response.endswith("```"):
            ai_response = ai_response[:-3]
        suggestions = json.loads(ai_response)
        if not isinstance(suggestions, list):
            suggestions = []
    except Exception as e:
        logger.warning("Erreur suggestions IA: %s", e)
        # Suggestions par défaut
        suggestions = [
            "Quels sont mes prospects à relancer ?",
            "Combien de RDV cette semaine ?",
            "Quelles sont mes priorités du jour ?",
            "Montre-moi les prospects du secteur automobile",
            "Quels candidats ont des compétences en C++ ?"
        ]
    
    return jsonify(ok=True, suggestions=suggestions[:5])


@collab_bp.post("/api/dashboard/assistant/action")
def api_assistant_action():
    """Exécute une action demandée par l'assistant (création, modification, fonctions IA, etc.)."""
    uid = _uid()
    if not uid:
        return jsonify(ok=False, error="Non authentifié"), 401
    
    body = request.get_json(force=True) or {}
    action_type = body.get("type")
    params = body.get("params", {})
    
    if not action_type:
        return jsonify(ok=False, error="type d'action requis"), 400
    
    try:
        if action_type == "create_prospect":
            # Créer un prospect
            name = params.get("name", "").strip()
            company_name = params.get("company", "").strip()
            if not name:
                return jsonify(ok=False, error="Nom du prospect requis"), 400
            
            # Trouver ou créer l'entreprise
            with _conn() as conn:
                if company_name:
                    company = conn.execute("SELECT id FROM companies WHERE owner_id=? AND groupe=? AND deleted_at IS NULL LIMIT 1;", (uid, company_name)).fetchone()
                    if not company:
                        # Créer l'entreprise
                        cursor = conn.execute(
                            "INSERT INTO companies (groupe, site, owner_id) VALUES (?, ?, ?);",
                            (company_name, params.get("site", ""), uid)
                        )
                        company_id = cursor.lastrowid
                    else:
                        company_id = company["id"]
                else:
                    company_id = params.get("company_id")
                    if not company_id:
                        return jsonify(ok=False, error="Entreprise requise"), 400
                
                # Créer le prospect
                cursor = conn.execute(
                    "INSERT INTO prospects (name, company_id, fonction, telephone, email, linkedin, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (name, company_id, params.get("fonction"), params.get("telephone"), params.get("email"), params.get("linkedin"), uid)
                )
                prospect_id = cursor.lastrowid
            
            return jsonify(ok=True, message=f"Prospect '{name}' créé avec succès", data={"prospect_id": prospect_id})
        
        elif action_type == "create_company":
            groupe = params.get("groupe", "").strip()
            if not groupe:
                return jsonify(ok=False, error="Nom de l'entreprise requis"), 400
            
            with _conn() as conn:
                cursor = conn.execute(
                    "INSERT INTO companies (groupe, site, website, industry, owner_id) VALUES (?, ?, ?, ?, ?);",
                    (groupe, params.get("site"), params.get("website"), params.get("industry"), uid)
                )
                company_id = cursor.lastrowid
            
            return jsonify(ok=True, message=f"Entreprise '{groupe}' créée avec succès", data={"company_id": company_id})
        
        elif action_type == "create_candidate":
            name = params.get("name", "").strip()
            if not name:
                return jsonify(ok=False, error="Nom du candidat requis"), 400
            
            skills_json = json.dumps(params.get("skills", []))
            with _conn() as conn:
                cursor = conn.execute(
                    "INSERT INTO candidates (name, role, skills, phone, email, linkedin, owner_id, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'));",
                    (name, params.get("role"), skills_json, params.get("phone"), params.get("email"), params.get("linkedin"), uid)
                )
                candidate_id = cursor.lastrowid
            
            return jsonify(ok=True, message=f"Candidat '{name}' créé avec succès", data={"candidate_id": candidate_id})
        
        elif action_type == "modify_prospect":
            prospect_id = params.get("id")
            field = params.get("field")
            value = params.get("value")
            
            if not prospect_id or not field:
                return jsonify(ok=False, error="ID et champ requis"), 400
            
            if not _prospect_owned(prospect_id):
                return jsonify(ok=False, error="Prospect non trouvé ou accès refusé"), 404
            
            with _conn() as conn:
                conn.execute(f"UPDATE prospects SET {field}=? WHERE id=? AND owner_id=?;", (value, prospect_id, uid))
            
            return jsonify(ok=True, message="Prospect modifié avec succès")
        
        elif action_type == "ia_scrap":
            entity_type = params.get("type")
            entity_id = params.get("id")
            
            if not entity_type or not entity_id:
                return jsonify(ok=False, error="Type et ID requis"), 400
            
            # Retourner une instruction pour le frontend d'appeler la fonction IA appropriée
            return jsonify(ok=True, message="Fonction IA déclenchée", data={"ia_function": "scrap", "type": entity_type, "id": entity_id})
        
        elif action_type == "ia_avant_reunion":
            prospect_id = params.get("prospect_id")
            if not prospect_id or not _prospect_owned(prospect_id):
                return jsonify(ok=False, error="Prospect non trouvé"), 404
            return jsonify(ok=True, message="Génération fiche préparation", data={"ia_function": "avant_reunion", "prospect_id": prospect_id})
        
        elif action_type == "ia_apres_reunion":
            prospect_id = params.get("prospect_id")
            if not prospect_id or not _prospect_owned(prospect_id):
                return jsonify(ok=False, error="Prospect non trouvé"), 404
            return jsonify(ok=True, message="Génération compte-rendu", data={"ia_function": "apres_reunion", "prospect_id": prospect_id})
        
        else:
            return jsonify(ok=False, error=f"Type d'action non supporté: {action_type}"), 400
    
    except Exception as e:
        logger.error("Erreur exécution action assistant: %s", e)
        return jsonify(ok=False, error=str(e)), 500


# ═══════════════════════════════════════════════════════════════════
# v29.0: DC Generator — Dossier de Compétences format Up Technologies
# ═══════════════════════════════════════════════════════════════════

