#!/usr/bin/env python3
"""
Génère un PDF dossier de compétences au format Up Technologies.
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Couleurs Up Technologies ──────────────────────────────────────────────────
ORANGE     = colors.HexColor('#E87722')
DARK       = colors.HexColor('#1A1A1A')
GREY       = colors.HexColor('#5A5A5A')
LGREY      = colors.HexColor('#AAAAAA')
BORDERGREY = colors.HexColor('#CCCCCC')

PAGE_W, PAGE_H = A4
MARGIN_L  = 2.0*cm; MARGIN_R = 2.0*cm
MARGIN_T  = 2.2*cm; MARGIN_B = 2.5*cm
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

# ── Polices : Lato système > Helvetica fallback ───────────────────────────────
def _load_fonts():
    candidates = [
        '/usr/share/fonts/truetype/lato',
        '/usr/share/fonts/lato',
        os.path.join(os.environ.get('WINDIR', ''), 'Fonts') if os.name == 'nt' else '',
    ]
    for lato_dir in candidates:
        if not lato_dir:
            continue
        try:
            r = os.path.join(lato_dir, 'Lato-Regular.ttf')
            b = os.path.join(lato_dir, 'Lato-Bold.ttf')
            if not os.path.exists(r):
                continue
            pdfmetrics.registerFont(TTFont('Lato',        r))
            pdfmetrics.registerFont(TTFont('Lato-Bold',   b))
            semi = os.path.join(lato_dir, 'Lato-Semibold.ttf')
            ital = os.path.join(lato_dir, 'Lato-Italic.ttf')
            pdfmetrics.registerFont(TTFont('Lato-Semi',   semi if os.path.exists(semi) else b))
            pdfmetrics.registerFont(TTFont('Lato-Italic', ital if os.path.exists(ital) else r))
            return 'Lato', 'Lato-Bold', 'Lato-Semi', 'Lato-Italic'
        except Exception:
            pass
    return 'Helvetica', 'Helvetica-Bold', 'Helvetica-Bold', 'Helvetica-Oblique'

FONT_BODY, FONT_BOLD, FONT_SEMI, FONT_ITAL = _load_fonts()

# ── Styles ────────────────────────────────────────────────────────────────────
def _make_styles():
    s = {}
    def P(name, **kw): return ParagraphStyle(name + '_dc', **kw)
    s['name']            = P('name',           fontName=FONT_BOLD, fontSize=18, leading=22, textColor=DARK,   spaceAfter=0)
    s['role']            = P('role',           fontName=FONT_BODY, fontSize=12, leading=15, textColor=DARK,   spaceAfter=0)
    s['exp']             = P('exp',            fontName=FONT_BODY, fontSize=12, leading=15, textColor=DARK,   spaceAfter=10)
    s['section_title']   = P('section_title',  fontName=FONT_ITAL, fontSize=14, leading=18, textColor=ORANGE, spaceAfter=4)
    s['label_cell']      = P('label_cell',     fontName=FONT_BODY, fontSize=9,  leading=12, textColor=GREY,   alignment=TA_CENTER)
    s['body']            = P('body',           fontName=FONT_BODY, fontSize=8.5,leading=12, textColor=DARK)
    s['body_bold']       = P('body_bold',      fontName=FONT_SEMI, fontSize=8.5,leading=12, textColor=DARK)
    s['bullet']          = P('bullet',         fontName=FONT_BODY, fontSize=8.5,leading=13, textColor=DARK,   leftIndent=10, spaceAfter=1)
    s['mission_title']   = P('mission_title',  fontName=FONT_BODY, fontSize=13, leading=16, textColor=DARK,   spaceAfter=3)
    s['mission_bold']    = P('mission_bold',   fontName=FONT_BOLD, fontSize=9,  leading=12, textColor=DARK,   spaceAfter=2)
    s['tools']           = P('tools',          fontName=FONT_BODY, fontSize=8.5,leading=12, textColor=DARK,   spaceAfter=6)
    s['formation_label'] = P('formation_label',fontName=FONT_BODY, fontSize=9,  leading=12, textColor=GREY,   alignment=TA_CENTER)
    s['formation_body']  = P('formation_body', fontName=FONT_BODY, fontSize=9,  leading=13, textColor=DARK)
    return s

ST = _make_styles()

# ── Helpers ───────────────────────────────────────────────────────────────────
def _bullet(text):
    """Bullet point propre — supprime les prefixes parasites du texte extrait."""
    import re
    cleaned = re.sub(r'^[\u2022\u2023\u25e6\u2043\u2219\*\-\>\u279e\u27a4\u25b6\u2714\u2713\u2715\u2716\s]+', '', text).strip()
    return Paragraph(f'\u2022 {cleaned}', ST['bullet'])

def _bold_header(text):
    return Paragraph(f'<b>{text}</b>', ST['body_bold'])

def mission_hr():
    return HRFlowable(width=CONTENT_W, thickness=0.8, color=LGREY, spaceAfter=6, spaceBefore=0)

# ── Table compétences : UNE RANGÉE PAR CATÉGORIE ────────────────────────────
def competences_table(rows_data):
    """
    rows_data : liste de (label_str, [flowables])
    Chaque tuple devient UNE rangée dans le tableau.
    """
    col_w = [3.2*cm, CONTENT_W - 3.2*cm]
    table_rows = [
        [Paragraph(lbl, ST['label_cell']), content]
        for lbl, content in rows_data
    ]
    n = len(table_rows)
    t = Table(table_rows, colWidths=col_w, hAlign='LEFT')

    style_cmds = [
        ('VALIGN',       (0, 0), (-1, -1), 'MIDDLE'),
        ('VALIGN',       (1, 0),  (1, -1), 'TOP'),
        # Bordure orange sur toute la colonne gauche
        ('BOX',          (0, 0),  (0, -1), 1.5, ORANGE),
        # Bordure grise sur la colonne droite
        ('BOX',          (1, 0),  (1, -1), 0.5, BORDERGREY),
        # Padding
        ('TOPPADDING',   (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 8),
        ('LEFTPADDING',  (0, 0),  (0, -1), 4),
        ('RIGHTPADDING', (0, 0),  (0, -1), 4),
        ('LEFTPADDING',  (1, 0),  (1, -1), 8),
        ('RIGHTPADDING', (1, 0),  (1, -1), 6),
    ]
    # Séparateurs horizontaux entre rangées (sauf la dernière)
    for i in range(n - 1):
        style_cmds.append(('LINEBELOW', (0, i), (-1, i), 0.5, BORDERGREY))

    t.setStyle(TableStyle(style_cmds))
    return t

# ── Header / Footer canvas ────────────────────────────────────────────────────
BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_HEADER  = os.path.join(BASE_DIR, 'static', 'up_assets', 'up_logo_header.png')
LOGO_FOOTER  = os.path.join(BASE_DIR, 'static', 'up_assets', 'up_logo_footer.png')

def _make_header_footer(canvas_obj, doc):
    canvas_obj.saveState()
    # ── Header logo ──
    if os.path.exists(LOGO_HEADER):
        try:
            canvas_obj.drawImage(
                LOGO_HEADER,
                PAGE_W - MARGIN_R - 4.5*cm,
                PAGE_H - MARGIN_T - 1.5*cm + 0.3*cm,
                width=4.5*cm, height=1.5*cm,
                preserveAspectRatio=True, mask='auto'
            )
        except Exception:
            _draw_text_logo_header(canvas_obj)
    else:
        _draw_text_logo_header(canvas_obj)

    # ── Footer logo ──
    if os.path.exists(LOGO_FOOTER):
        try:
            canvas_obj.drawImage(
                LOGO_FOOTER,
                (PAGE_W - 8.0*cm) / 2, 0.45*cm,
                width=8.0*cm, height=1.4*cm,
                preserveAspectRatio=True, mask='auto'
            )
        except Exception:
            _draw_text_logo_footer(canvas_obj)
    else:
        _draw_text_logo_footer(canvas_obj)

    # ── Numéro de page ──
    canvas_obj.setFont(FONT_BODY, 8)
    canvas_obj.setFillColor(LGREY)
    canvas_obj.drawRightString(PAGE_W - MARGIN_R, 0.5*cm, f'Page {doc.page}')
    canvas_obj.restoreState()

def _draw_text_logo_header(canvas_obj):
    canvas_obj.setFont(FONT_BOLD, 10)
    canvas_obj.setFillColor(ORANGE)
    canvas_obj.drawRightString(PAGE_W - MARGIN_R, PAGE_H - MARGIN_T - 0.5*cm, 'UP TECHNOLOGIES')

def _draw_text_logo_footer(canvas_obj):
    canvas_obj.setFont(FONT_BODY, 8)
    canvas_obj.setFillColor(LGREY)
    canvas_obj.drawCentredString(PAGE_W / 2, 0.6*cm, 'UP TECHNOLOGIES')

# ── Classe principale ─────────────────────────────────────────────────────────
class DossierGenerator:

    def generate(self, data: dict, output_path: str) -> str:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        story = self._build_story(data)
        doc = SimpleDocTemplate(
            output_path, pagesize=A4,
            leftMargin=MARGIN_L, rightMargin=MARGIN_R,
            topMargin=MARGIN_T + 1.8*cm, bottomMargin=MARGIN_B + 1.8*cm,
            title=f"Dossier de Compétences \u2013 {data.get('nom', '')} \u2013 Up Technologies",
            author='Up Technologies'
        )
        doc.build(story, onFirstPage=_make_header_footer, onLaterPages=_make_header_footer)
        return output_path

    def _build_story(self, data: dict):
        story = []

        # ── PAGE 1 : Identité + Compétences + Formation ──────────────────────
        story.append(Spacer(1, 0.2*cm))

        nom_complet = f"{data.get('prenom', '')} {data.get('nom', '')}".strip() or 'Candidat'
        story.append(Paragraph(f'<b>{nom_complet}</b>', ST['name']))

        if data.get('titre_poste'):
            story.append(Paragraph(data['titre_poste'], ST['role']))
        if data.get('annees_experience'):
            story.append(Paragraph(data['annees_experience'], ST['exp']))
        else:
            story.append(Spacer(1, 0.3*cm))

        story.append(Paragraph(
            "Comp\u00e9tences, Outils &amp; Secteurs d'intervention",
            ST['section_title']
        ))

        # ── Tableau compétences — UNE RANGÉE PAR CATÉGORIE ──────────────────
        competences = data.get('competences', [])
        if competences:
            table_rows = []
            for cat in competences:
                items = cat.get('items', [])
                if not items:
                    continue
                flowables = []
                for item in items:
                    if item and item.strip():
                        flowables.append(_bullet(item))
                if flowables:
                    # Wrap liste de flowables dans une sous-table pour compatibilité
                    inner = Table([[f] for f in flowables],
                                  colWidths=[CONTENT_W - 3.2*cm - 0.3*cm],
                                  hAlign='LEFT')
                    inner.setStyle(TableStyle([
                        ('TOPPADDING',    (0,0), (-1,-1), 0),
                        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
                        ('LEFTPADDING',   (0,0), (-1,-1), 0),
                        ('RIGHTPADDING',  (0,0), (-1,-1), 0),
                    ]))
                    table_rows.append((cat['categorie'], inner))

            if table_rows:
                story.append(competences_table(table_rows))
        else:
            story.append(Paragraph('(Comp\u00e9tences \u00e0 renseigner)', ST['body']))

        story.append(Spacer(1, 0.5*cm))

        # ── Formation / Langues / Certifications ─────────────────────────────
        formations = data.get('formations', [])
        langues    = data.get('langues', [])
        certifs    = data.get('certifications', [])

        if formations or langues or certifs:
            story.append(Paragraph('Formation, Langues', ST['section_title']))
            form_rows = []

            if formations:
                form_texte = '<br/>'.join(f['texte'] for f in formations if f.get('texte'))
                form_annee = '<br/>'.join(f['annee'] for f in formations if f.get('annee'))
                if form_texte:
                    form_rows.append(('Formation', form_texte, form_annee))

            if langues:
                lang_texte = '<br/>'.join(
                    f"{l['langue']} \u2013 {l['niveau']}" for l in langues
                )
                form_rows.append(('Langues', lang_texte, ''))

            if certifs:
                cert_texte = '<br/>'.join(certifs)
                form_rows.append(('Certifications', cert_texte, ''))

            if form_rows:
                col_w2 = [3.2*cm, CONTENT_W - 3.2*cm - 2.0*cm, 2.0*cm]
                ftable = Table(
                    [[Paragraph(lbl, ST['formation_label']),
                      Paragraph(txt, ST['formation_body']),
                      Paragraph(annee, ST['formation_body'])]
                     for lbl, txt, annee in form_rows],
                    colWidths=col_w2, hAlign='LEFT'
                )
                n_f = len(form_rows)
                fstyle = [
                    ('VALIGN',       (0, 0), (-1, -1), 'MIDDLE'),
                    ('VALIGN',       (1, 0),  (1, -1), 'TOP'),
                    ('BOX',          (0, 0),  (0, -1), 1.5, ORANGE),
                    ('BOX',          (1, 0),  (2, -1), 0.5, BORDERGREY),
                    ('LINEAFTER',    (1, 0),  (1, -1), 0.5, BORDERGREY),
                    ('TOPPADDING',   (0, 0), (-1, -1), 8),
                    ('BOTTOMPADDING',(0, 0), (-1, -1), 8),
                    ('LEFTPADDING',  (0, 0),  (0, -1), 4),
                    ('LEFTPADDING',  (1, 0),  (1, -1), 8),
                    ('LEFTPADDING',  (2, 0),  (2, -1), 6),
                ]
                for i in range(n_f - 1):
                    fstyle.append(('LINEBELOW', (0, i), (-1, i), 0.5, BORDERGREY))
                ftable.setStyle(TableStyle(fstyle))
                story.append(ftable)

        story.append(PageBreak())

        # ── PAGES 2-N : Expériences ───────────────────────────────────────────
        experiences = data.get('experiences', [])
        for i, exp in enumerate(experiences):
            story.append(Spacer(1, 0.3*cm))

            titre = exp.get('entreprise', f'Mission {i+1}')
            dates = exp.get('dates', '')
            duree = exp.get('duree', '')
            ligne_titre = titre
            if dates and dates != titre:
                ligne_titre += f" \u2013 {dates}"
            if duree:
                ligne_titre += f" \u2013 {duree}"
            story.append(Paragraph(ligne_titre, ST['mission_title']))
            story.append(mission_hr())

            if exp.get('secteur'):
                story.append(Paragraph(f'<b>Secteur :</b> {exp["secteur"]}', ST['body']))
            if exp.get('poste'):
                story.append(Paragraph(f'<b>Mission :</b> {exp["poste"]}', ST['body']))
            story.append(Spacer(1, 0.2*cm))

            for sous in exp.get('sous_missions', []):
                titre_sous = sous.get('titre', '')
                if titre_sous and titre_sous != 'R\u00e9alisations':
                    story.append(_bold_header(titre_sous))
                elif titre_sous:
                    story.append(Paragraph('<b>R\u00e9alisations :</b>', ST['mission_bold']))
                for bullet_text in sous.get('bullets', []):
                    if bullet_text and bullet_text.strip():
                        story.append(_bullet(bullet_text))
                story.append(Spacer(1, 4))

            if exp.get('outils'):
                story.append(Paragraph(
                    f'<b>Logiciels / Outils :</b> {exp["outils"]}', ST['tools']
                ))

            if i < len(experiences) - 1:
                story.append(PageBreak())

        return story
