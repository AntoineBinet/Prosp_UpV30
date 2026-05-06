"""ProspUp — helpers candidats (résolution DC PDF, descriptions IA).

Utilisé par les routes candidates et push (description vendeuse pour emails
de prospection). Centralisé ici pour briser la dépendance circulaire entre
candidates ↔ push ↔ prospects qui passait toutes par
`_generate_candidate_description_ai`.
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path

from config import APP_DIR, DATA_DIR
from utils.ai_helpers import _call_ai, _load_ai_config
from utils.db import _conn
from utils.files import _extract_pdf_text

logger = logging.getLogger("prospup")


def _resolve_dc_pdf_path(candidate: dict, uid: int) -> Path | None:
    """Résout le chemin du DC PDF d'un candidat. Retourne None si introuvable."""
    dc_path_str = candidate.get("dossier_competence_pdf", "")
    if not dc_path_str:
        # Chercher dans le dossier par convention
        cand_id = candidate.get("id")
        if cand_id:
            dc_dir = DATA_DIR / "dossiers_candidats" / str(uid) / str(cand_id)
            if dc_dir.is_dir():
                pdfs = list(dc_dir.glob("*.pdf"))
                if pdfs:
                    return pdfs[0]
        return None

    if not os.path.isabs(dc_path_str):
        dc_path = APP_DIR / "dossiers_competence" / dc_path_str
    else:
        dc_path = Path(dc_path_str)

    if not dc_path.is_file():
        cand_id = candidate.get("id")
        if cand_id:
            alt_path = DATA_DIR / "dossiers_candidats" / str(uid) / str(cand_id) / Path(dc_path_str).name
            if alt_path.is_file():
                return alt_path
    return dc_path if dc_path.is_file() else None


def _generate_candidate_description_ai(candidate: dict, uid: int) -> str:
    """Génère une description riche d'un candidat via Ollama en analysant son DC PDF.

    Retourne la description HTML ou chaîne vide en cas d'échec. Cache le
    résultat dans la colonne `description_push` de la table candidates.
    """
    ai_config = _load_ai_config()
    max_chars = int(ai_config.get("candidate_pdf_max_chars") or 6000)

    dc_path = _resolve_dc_pdf_path(candidate, uid)
    if not dc_path:
        logger.info("Pas de DC PDF pour le candidat %s (id=%s)", candidate.get("name"), candidate.get("id"))
        return ""

    pdf_text = _extract_pdf_text(dc_path, max_chars=max_chars)
    if not pdf_text:
        logger.warning("Impossible d'extraire le texte du DC PDF: %s", dc_path)
        return ""

    prenom = (candidate.get("prenom") or "").strip()
    if not prenom:
        name_parts = (candidate.get("name") or "").split()
        # Noms souvent stockés en format "NOM Prénom" → prendre le dernier mot comme prénom
        prenom = name_parts[-1] if len(name_parts) > 1 else (name_parts[0] if name_parts else "Candidat")

    annees_exp = str(candidate.get("annees_experience") or candidate.get("years_experience") or "").strip()

    custom_prompt = (ai_config.get("candidate_description_prompt") or "").strip()
    if custom_prompt:
        prompt = custom_prompt.replace("{prenom}", prenom).replace("{pdf_text}", pdf_text)
    else:
        annees_instruction = (
            f"- Mentionne ses années d'expérience : utilise le chiffre EXACT du dossier ({annees_exp} ans selon sa fiche — ne pas modifier ce chiffre)"
            if annees_exp else
            "- Mentionne ses années d'expérience : utilise le chiffre EXACT écrit dans le dossier, ne pas inventer ni arrondir"
        )
        prompt = f"""Tu es un commercial senior dans une société de conseil en ingénierie. Tu dois rédiger une présentation percutante pour un email de prospection B2B — l'objectif est de DONNER ENVIE au client de rencontrer le candidat.

Rédige EXACTEMENT 2 phrases à partir du dossier de compétences ci-dessous.

PHRASE 1 — Présentation générale (identité + titre + expérience) :
- Commence OBLIGATOIREMENT par le prénom en gras HTML : <b>{prenom}</b> — utilise UNIQUEMENT ce prénom, jamais le nom de famille
- Donne son vrai titre de poste (ingénieur, développeur, architecte, chef de projet… — jamais « consultant »)
{annees_instruction}
- Cite ses domaines principaux d'intervention ou sa spécialité distinctive
- Style : clair, professionnel, direct

PHRASE 2 — Accroche vendeuse (réalisation concrète) :
- Ton dynamique avec un verbe d'action ("a conçu", "a piloté", "a développé", "a validé", "a déployé"…)
- S'appuie sur une réalisation ou mission concrète citée dans le dossier
- Met en avant la valeur apportée ou le résultat obtenu si disponible
- Peut citer 1 à 2 technologies clés pour rassurer le client

Règles ABSOLUES :
- Commence TOUJOURS par <b>{prenom}</b> (le prénom, jamais le nom de famille)
- Tout le contenu doit venir EXCLUSIVEMENT du dossier ci-dessous
- En français — ne pas écrire "il/elle est disponible" ni "il/elle cherche un poste"
- Les 2 phrases ensemble font 70-100 mots max

Exemple de structure attendue :
"<b>Prénom</b>, [titre réel] avec [X] ans d'expérience, spécialisé(e) en [domaine(s) réel(s) du dossier]. Il/Elle a [réalisation concrète issue du dossier], [résultat ou point fort différenciant]."

Dossier de compétences :
{pdf_text}

Réponds UNIQUEMENT avec les 2 phrases, sans guillemets, sans tiret au début, sans commentaire."""

    try:
        result = _call_ai(prompt, timeout=90)
        desc = result.strip()
        desc = re.sub(r'^[\s"\'\\-–—•]+', '', desc)
        desc = re.sub(r'[\s"\']+$', '', desc)
        desc = re.sub(r'\s*\n+\s*', ' ', desc)
        if len(desc) < 20:
            logger.warning("Description IA trop courte pour candidat %s: %s", candidate.get("id"), desc)
            return ""

        try:
            cand_id = candidate.get("id")
            if cand_id:
                with _conn() as conn:
                    conn.execute(
                        "UPDATE candidates SET description_push=? WHERE id=? AND owner_id=?;",
                        (desc, cand_id, uid)
                    )
                    conn.commit()
        except Exception as cache_err:
            logger.warning("Erreur cache description_push: %s", cache_err)

        return desc
    except Exception as e:
        logger.warning("Erreur génération description IA pour candidat %s: %s", candidate.get("id"), e)
        return ""


def _build_candidate_descriptions(candidates_data: list) -> list:
    """Construit la liste des descriptions HTML des candidats (IA ou format statique)."""
    ORANGE = '#E07020'
    lines = []
    for cand in candidates_data:
        if cand.get("description_ai"):
            # Remplacer <b>Prénom</b> par prénom en orange (généré par le prompt IA)
            line = re.sub(
                r'<b>([^<]{1,30})</b>',
                lambda m: f'<span style="color:{ORANGE};font-weight:bold;">{m.group(1)}</span>',
                cand["description_ai"], count=1
            )
            lines.append(line)
        else:
            prenom = cand.get("prenom") or (cand.get("name", "").split()[0] if cand.get("name") else "")
            titre = cand.get("titre") or cand.get("role", "")
            annees = cand.get("annees_experience") or cand.get("years_experience") or ""
            domaine = cand.get("domaine_principal") or cand.get("sector", "")
            line = f'<span style="color:{ORANGE};font-weight:bold;">{prenom}</span>, {titre}'
            if annees:
                line += f" avec {annees} ans d’expérience"
            if domaine:
                line += f" en {domaine}"
            line += " — disponible immédiatement."
            lines.append(line)
    return lines
