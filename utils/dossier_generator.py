#!/usr/bin/env python3
"""
DossierGenerator — Remplissage du template template_dc.docx.

Approche : ouvre le template tel quel, remplace les {{placeholders}},
duplique le bloc {{#EXPERIENCES}}…{{/EXPERIENCES}} pour chaque mission.
Mise en page Word préservée à 100%.

Placeholders attendus dans le template :
  {{PRENOM_NOM}}, {{TITRE_POSTE}}, {{ANNEES_EXPERIENCE}}
  {{COMPETENCES}}, {{OUTILS}}, {{SECTEURS}}
  {{FORMATIONS}}, {{Année d'obtention}}, {{LANGUES}}
  {{#EXPERIENCES}} … {{/EXPERIENCES}} avec à l'intérieur :
    {{EXP_TITRE}}, {{EXP_SECTEUR}}, {{EXP_MISSION}},
    {{EXP_REALISATIONS}}, {{EXP_OUTILS}}
"""

import copy
import os
import re

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

# Chemin du template (relatif à ce fichier → ../sample/template_dc.docx)
_HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(_HERE, '..', 'sample', 'template_dc.docx')


# ── Formatage des données ─────────────────────────────────────────────────────

def _s(v) -> str:
    """Retourne str(v).strip() ou ''."""
    return str(v).strip() if v else ''


def _fmt_prenom_nom(data: dict) -> str:
    prenom = _s(data.get('prenom'))
    nom    = _s(data.get('nom')).upper()
    return f"{prenom} {nom}".strip()


def _fmt_annees(data: dict) -> str:
    """Extrait le nombre d'années (le template ajoute déjà ' ans d'expérience')."""
    val = _s(data.get('annees_experience'))
    m = re.match(r'^(\d+)', val)
    return m.group(1) if m else val


def _categorize_competences(competences: list) -> tuple:
    """Répartit les catégories de compétences en (domaines, outils, secteurs)."""
    domaines, outils_cats, secteurs_cats = [], [], []

    OUTILS_KEYS  = ('outil', 'langag', 'framework', 'technolog', 'cloud',
                    'base de donn', 'web', 'normes', 'logiciel', 'infrastructure',
                    'développement', 'conception', 'certification', 'méthode')
    SECTEUR_KEYS = ('secteur',)
    DOMAINE_KEYS = ('domaine', 'compét', 'expertise', 'savoir')

    for cat in competences:
        name = _s(cat.get('categorie')).lower()
        if any(k in name for k in SECTEUR_KEYS):
            secteurs_cats.append(cat)
        elif any(k in name for k in OUTILS_KEYS):
            outils_cats.append(cat)
        elif any(k in name for k in DOMAINE_KEYS) or cat.get('groupes'):
            domaines.append(cat)
        else:
            outils_cats.append(cat)

    # Fallback : si aucune catégorie triée, tout → domaines
    if not domaines and not outils_cats and not secteurs_cats:
        domaines = list(competences)

    return domaines, outils_cats, secteurs_cats


def _fmt_competences_text(cats: list) -> str:
    lines = []
    for cat in cats:
        name = _s(cat.get('categorie'))
        if cat.get('groupes'):
            lines.append(f"{name} :")
            for g in cat['groupes']:
                titre = _s(g.get('titre'))
                items = [_s(x) for x in (g.get('items') or []) if x]
                if titre and items:
                    lines.append(f"  {titre} : {', '.join(items)}")
                elif items:
                    lines.append(f"  {', '.join(items)}")
        elif cat.get('items'):
            items = [_s(x) for x in cat['items'] if x]
            lines.append(f"{name} : {', '.join(items)}")
    return '\n'.join(lines)


def _fmt_items_flat(cats: list) -> str:
    items = []
    for cat in cats:
        for x in (cat.get('items') or []):
            if x:
                items.append(_s(x))
        for g in (cat.get('groupes') or []):
            for x in (g.get('items') or []):
                if x:
                    items.append(_s(x))
    return ', '.join(items)


def _fmt_formations(formations: list) -> str:
    lines = []
    for f in formations:
        label = _s(f.get('label'))
        texte = _s(f.get('texte'))
        parts = [p for p in [label, texte] if p]
        if parts:
            lines.append(' — '.join(parts))
    return '\n'.join(lines)


def _fmt_annees_obtention(formations: list) -> str:
    annees = [_s(f.get('annee')) for f in formations if f.get('annee')]
    return ' / '.join(annees)


def _fmt_langues(langues: list) -> str:
    parts = []
    for lang in langues:
        langue = _s(lang.get('langue'))
        niveau = _s(lang.get('niveau'))
        if langue:
            parts.append(f"{langue} ({niveau})" if niveau else langue)
    return ', '.join(parts)


def _fmt_exp_titre(exp: dict) -> str:
    titre      = _s(exp.get('titre_projet'))
    entreprise = _s(exp.get('entreprise'))
    dates      = _s(exp.get('dates'))
    duree      = _s(exp.get('duree'))

    parts = []
    if titre:
        parts.append(titre)
    if entreprise:
        parts.append(f"— {entreprise}" if titre else entreprise)
    date_parts = [p for p in [dates, duree] if p]
    if date_parts:
        parts.append(f"({' '.join(date_parts)})")
    return ' '.join(parts)


def _fmt_exp_mission(exp: dict) -> str:
    return _s(exp.get('poste'))


def _fmt_exp_realisations(exp: dict) -> str:
    lines = []
    for sm in (exp.get('sous_missions') or []):
        bullets = list(sm.get('bullets') or [])
        for g in (sm.get('groupes') or []):
            g_titre = _s(g.get('titre'))
            g_items = [_s(x) for x in (g.get('items') or []) if x]
            if g_titre:
                lines.append(f"{g_titre} :")
                lines.extend(f"  • {x}" for x in g_items)
            else:
                bullets.extend(g_items)
        for b in bullets:
            if _s(b):
                lines.append(f"• {_s(b)}")
    return '\n'.join(lines)


# ── Manipulation XML ──────────────────────────────────────────────────────────

def _get_para_text(para_elem) -> str:
    """Retourne le texte complet d'un w:p en joignant tous les w:t."""
    return ''.join(t.text or '' for t in para_elem.iter(qn('w:t')))


def _replace_in_para_elem(para_elem, replacements: dict):
    """
    Remplace les {{placeholders}} dans un élément w:p.
    Gère le fragment de placeholder sur plusieurs runs/w:t.
    Le texte multi-ligne (\\n) est injecté avec des w:br dans le premier run.
    """
    full = _get_para_text(para_elem)
    if not any(k in full for k in replacements):
        return

    new_text = full
    for k, v in replacements.items():
        new_text = new_text.replace(k, _s(v))

    t_elems = list(para_elem.iter(qn('w:t')))
    if not t_elems:
        return

    # Vider tous les w:t sauf le premier
    for t in t_elems[1:]:
        t.text = ''

    first_t = t_elems[0]

    if '\n' not in new_text:
        first_t.text = new_text
        if new_text.startswith(' ') or new_text.endswith(' '):
            first_t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        return

    # Texte multi-ligne → première ligne dans w:t, suivantes via w:br + w:t
    lines = new_text.split('\n')
    first_t.text = lines[0]

    first_r = first_t.getparent()
    if first_r is None:
        return

    for line in lines[1:]:
        br = OxmlElement('w:br')
        first_r.append(br)
        t_new = OxmlElement('w:t')
        t_new.text = line
        if line.startswith(' ') or line.endswith(' '):
            t_new.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        first_r.append(t_new)


def _replace_all_in_doc(doc: Document, replacements: dict):
    """Remplace les placeholders dans tous les paragraphes et cellules."""
    for para in doc.element.body.iter(qn('w:p')):
        _replace_in_para_elem(para, replacements)


def _expand_experiences(doc: Document, experiences: list):
    """
    Trouve le bloc {{#EXPERIENCES}}…{{/EXPERIENCES}} dans les enfants directs
    du body, le supprime, puis insère autant de copies qu'il y a d'expériences.
    """
    body = doc.element.body
    start_elem = None
    end_elem   = None

    # Chercher uniquement parmi les enfants directs du body (pas dans les tables)
    for child in body:
        if child.tag != qn('w:p'):
            continue
        text = _get_para_text(child)
        if '{{#EXPERIENCES}}' in text:
            start_elem = child
        elif '{{/EXPERIENCES}}' in text and start_elem is not None:
            end_elem = child
            break

    if start_elem is None or end_elem is None:
        return

    # Collecter les éléments du bloc (enfants directs entre start et end exclus)
    block_elems = []
    collecting  = False
    for child in list(body):
        if child is start_elem:
            collecting = True
            continue
        if child is end_elem:
            break
        if collecting:
            block_elems.append(child)

    # Position d'insertion = index de start_elem dans body
    insert_pos = list(body).index(start_elem)

    # Supprimer marqueurs + bloc original
    body.remove(start_elem)
    for elem in block_elems:
        body.remove(elem)
    body.remove(end_elem)

    # Insérer une copie remplie du bloc pour chaque expérience
    for i, exp in enumerate(experiences):
        exp_replacements = {
            '{{EXP_TITRE}}':        _fmt_exp_titre(exp),
            '{{EXP_SECTEUR}}':      _s(exp.get('secteur')),
            '{{EXP_MISSION}}':      _fmt_exp_mission(exp),
            '{{EXP_REALISATIONS}}': _fmt_exp_realisations(exp),
            '{{EXP_OUTILS}}':       _s(exp.get('outils')),
        }
        offset = i * len(block_elems)
        for j, elem in enumerate(block_elems):
            new_elem = copy.deepcopy(elem)
            _replace_in_para_elem(new_elem, exp_replacements)
            body.insert(insert_pos + offset + j, new_elem)


# ── Générateur principal ──────────────────────────────────────────────────────

class DossierGenerator:
    def __init__(self, template_path: str = None):
        self.template_path = template_path or TEMPLATE_PATH

    def generate(self, data: dict, output_path: str) -> str:
        """
        Remplit le template avec *data* et sauvegarde le .docx en *output_path*.

        *data* suit la structure retournée par utils/ollama_extractor.py :
          nom, prenom, titre_poste, annees_experience,
          competences, experiences, formations, langues, certifications
        """
        if not os.path.exists(self.template_path):
            raise FileNotFoundError(f"Template introuvable : {self.template_path}")

        doc = Document(self.template_path)

        competences = data.get('competences') or []
        experiences = data.get('experiences') or []
        formations  = data.get('formations')  or []
        langues     = data.get('langues')     or []

        domaines, outils_cats, secteurs_cats = _categorize_competences(competences)

        # 1. Bloc expériences en premier (avant les remplacements simples)
        _expand_experiences(doc, experiences)

        # 2. Remplacements simples
        replacements = {
            '{{PRENOM_NOM}}':        _fmt_prenom_nom(data),
            '{{TITRE_POSTE}}':       _s(data.get('titre_poste')),
            '{{ANNEES_EXPERIENCE}}': _fmt_annees(data),
            '{{COMPETENCES}}':       _fmt_competences_text(domaines) or _fmt_competences_text(competences),
            '{{OUTILS}}':            _fmt_items_flat(outils_cats),
            '{{SECTEURS}}':          _fmt_items_flat(secteurs_cats),
            '{{FORMATIONS}}':        _fmt_formations(formations),
            "{{Ann\u00e9e d\u2019obtention}}": _fmt_annees_obtention(formations),
            '{{LANGUES}}':           _fmt_langues(langues),
        }
        _replace_all_in_doc(doc, replacements)

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        doc.save(output_path)
        return output_path
