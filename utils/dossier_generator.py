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
    LATO_DIR = '/usr/share/fonts/truetype/lato'
    try:
        pdfmetrics.registerFont(TTFont('Lato',        f'{LATO_DIR}/Lato-Regular.ttf'))
        pdfmetrics.registerFont(TTFont('Lato-Bold',   f'{LATO_DIR}/Lato-Bold.ttf'))
        pdfmetrics.registerFont(TTFont('Lato-Semi',   f'{LATO_DIR}/Lato-Semibold.ttf'))
        pdfmetrics.registerFont(TTFont('Lato-Italic', f'{LATO_DIR}/Lato-Italic.ttf'))
        return 'Lato', 'Lato-Bold', 'Lato-Semi', 'Lato-Italic'
    except Exception:
        return 'Helvetica', 'Helvetica-Bold', 'Helvetica-Bold', 'Helvetica-Oblique'

FONT_BODY, FONT_BOLD, FONT_SEMI, FONT_ITAL = _load_fonts()

# ── Styles ────────────────────────────────────────────────────────────────────
def _make_styles():
    s = {}
    def P(name, **kw): return ParagraphStyle(name, **kw)
    s['name']            = P('name',           fontName=FONT_BOLD, fontSize=18, leading=22, textColor=DARK,   spaceAfter=0)
    s['role']            = P('role',           fontName=FONT_BODY, fontSize=12, leading=15, textColor=DARK,   spaceAfter=0)
    s['exp']             = P('exp',            fontName=FONT_BODY, fontSize=12, leading=15, textColor=DARK,   spaceAfter=10)
    s['section_title']   = P('section_title',  fontName=FONT_ITAL, fontSize=14, leading=18, textColor=ORANGE, spaceAfter=4)
    s['label_cell']      = P('label_cell',     fontName=FONT_BODY, fontSize=9,  leading=12, textColor=GREY,   alignment=TA_CENTER)
    s['body']            = P('body',           fontName=FONT_BODY, fontSize=8.5,leading=12, textColor=DARK)
    s['body_bold']       = P('body_bold',      fontName=FONT_SEMI, fontSize=8.5,leading=12, textColor=DARK)
    s['bullet']          = P('bullet',         fontName=FONT_BODY, fontSize=8.5,leading=12, textColor=DARK,   leftIndent=8, spaceAfter=1)
    s['mission_title']   = P('mission_title',  fontName=FONT_BODY, fontSize=13, leading=16, textColor=DARK,   spaceAfter=3)
    s['mission_bold']    = P('mission_bold',   fontName=FONT_BOLD, fontSize=9,  leading=12, textColor=DARK,   spaceAfter=2)
    s['tools']           = P('tools',          fontName=FONT_BODY, fontSize=8.5,leading=12, textColor=DARK,   spaceAfter=6)
    s['formation_label'] = P('formation_label',fontName=FONT_BODY, fontSize=9,  leading=12, textColor=GREY,   alignment=TA_CENTER)
    s['formation_body']  = P('formation_body', fontName=FONT_BODY, fontSize=9,  leading=13, textColor=DARK)
    return s

ST = _make_styles()

# ── Helpers ───────────────────────────────────────────────────────────────────
def b(text, style='bullet'):
    return Paragraph(f'• {text}', ST[style])

def mission_hr():
    return HRFlowable(width=CONTENT_W, thickness=0.8, color=LGREY, spaceAfter=6, spaceBefore=0)

def competences_table(rows_data):
    table_rows = [[Paragraph(lbl, ST['label_cell']), content] for lbl, content in rows_data]
    col_w = [3.2*cm, CONTENT_W - 3.2*cm]
    t = Table(table_rows, colWidths=col_w, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('VALIGN',       (0,0), (-1,-1), 'MIDDLE'),
        ('VALIGN',       (1,0),  (1,-1), 'TOP'),
        ('BOX',          (0,0),  (0,-1), 1.5, ORANGE),
        ('BOX',          (1,0),  (1,-1), 0.5, BORDERGREY),
        ('LINEBELOW',    (0,0),  (0,-2), 0.5, BORDERGREY),
        ('LINEBELOW',    (1,0),  (1,-2), 0.5, BORDERGREY),
        ('TOPPADDING',   (0,0), (-1,-1), 8),
        ('BOTTOMPADDING',(0,0), (-1,-1), 8),
        ('LEFTPADDING',  (0,0),  (0,-1), 4),
        ('RIGHTPADDING', (0,0),  (0,-1), 4),
        ('LEFTPADDING',  (1,0),  (1,-1), 8),
        ('RIGHTPADDING', (1,0),  (1,-1), 6),
    ]))
    return t

# ── Header / Footer canvas ────────────────────────────────────────────────────
BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_HEADER  = os.path.join(BASE_DIR, 'static', 'up_assets', 'up_logo_header.png')
LOGO_FOOTER  = os.path.join(BASE_DIR, 'static', 'up_assets', 'up_logo_footer.png')

def _make_header_footer(canvas_obj, doc):
    canvas_obj.saveState()
    if os.path.exists(LOGO_HEADER):
        try:
            canvas_obj.drawImage(LOGO_HEADER,
                PAGE_W - MARGIN_R - 4.5*cm,
                PAGE_H - MARGIN_T - 1.5*cm + 0.3*cm,
                width=4.5*cm, height=1.5*cm,
                preserveAspectRatio=True, mask='auto')
        except Exception:
            pass
    else:
        canvas_obj.setFont(FONT_BOLD, 10)
        canvas_obj.setFillColor(ORANGE)
        canvas_obj.drawRightString(PAGE_W - MARGIN_R,
            PAGE_H - MARGIN_T - 0.5*cm, 'UP TECHNOLOGIES')

    if os.path.exists(LOGO_FOOTER):
        try:
            canvas_obj.drawImage(LOGO_FOOTER,
                (PAGE_W - 8.0*cm) / 2, 0.45*cm,
                width=8.0*cm, height=1.4*cm,
                preserveAspectRatio=True, mask='auto')
        except Exception:
            pass
    else:
        canvas_obj.setFont(FONT_BODY, 8)
        canvas_obj.setFillColor(LGREY)
        canvas_obj.drawCentredString(PAGE_W/2, 0.6*cm, 'UP TECHNOLOGIES')

    canvas_obj.setFont(FONT_BODY, 8)
    canvas_obj.setFillColor(LGREY)
    canvas_obj.drawRightString(PAGE_W - MARGIN_R, 0.5*cm, f"Page {doc.page}")
    canvas_obj.restoreState()

# ── Classe principale ─────────────────────────────────────────────────────────
class DossierGenerator:

    def generate(self, data: dict, output_path: str) -> str:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        story = self._build_story(data)
        doc = SimpleDocTemplate(
            output_path, pagesize=A4,
            leftMargin=MARGIN_L, rightMargin=MARGIN_R,
            topMargin=MARGIN_T + 1.5*cm, bottomMargin=MARGIN_B + 1.5*cm,
            title=f"Dossier de Compétences – {data.get('nom','')} – Up Technologies",
            author='Up Technologies'
        )
        doc.build(story, onFirstPage=_make_header_footer, onLaterPages=_make_header_footer)
        return output_path

    def _build_story(self, data: dict):
        story = []

        # ── PAGE 1 : Identité + Compétences + Formation ──────────────────────
        story.append(Spacer(1, 0.3*cm))

        nom_complet = f"{data.get('prenom','')} {data.get('nom','')}".strip() or 'Candidat'
        story.append(Paragraph(f'<b>{nom_complet}</b>', ST['name']))

        if data.get('titre_poste'):
            story.append(Paragraph(data['titre_poste'], ST['role']))
        if data.get('annees_experience'):
            story.append(Paragraph(data['annees_experience'], ST['exp']))

        story.append(Paragraph("Compétences, Outils &amp; Secteurs d'intervention", ST['section_title']))

        # Tableau compétences
        competences = data.get('competences', [])
        if competences:
            dom_content = []
            for cat in competences:
                dom_content.append(Paragraph(f'<b>{cat["categorie"]}</b>', ST['body_bold']))
                for item in cat['items']:
                    dom_content.append(b(item))
                dom_content.append(Spacer(1, 4))
            story.append(competences_table([('Domaines de\ncompétences', dom_content)]))
        else:
            story.append(Paragraph('(Compétences à renseigner)', ST['body']))

        story.append(Spacer(1, 0.5*cm))

        # Formation
        formations = data.get('formations', [])
        langues    = data.get('langues', [])
        certifs    = data.get('certifications', [])

        story.append(Paragraph('Formation, Langues', ST['section_title']))

        form_rows = []
        if formations:
            form_texte = '<br/>'.join(f['texte'] for f in formations if f.get('texte'))
            form_annee = '<br/>'.join(f['annee'] for f in formations if f.get('annee'))
            form_rows.append(('Formation', form_texte, form_annee))

        if langues:
            lang_texte = '<br/>'.join(f"{l['langue']} – {l['niveau']}" for l in langues)
            form_rows.append(('Langues', lang_texte, ''))

        if certifs:
            cert_texte = '<br/>'.join(certifs)
            form_rows.append(('Certifications', cert_texte, '2025'))

        if form_rows:
            col_w2 = [3.2*cm, CONTENT_W - 3.2*cm - 2.0*cm, 2.0*cm]
            ftable = Table(
                [[Paragraph(lbl, ST['formation_label']),
                  Paragraph(txt, ST['formation_body']),
                  Paragraph(annee, ST['formation_body'])]
                 for lbl, txt, annee in form_rows],
                colWidths=col_w2, hAlign='LEFT'
            )
            ftable.setStyle(TableStyle([
                ('VALIGN',       (0,0), (-1,-1), 'MIDDLE'),
                ('VALIGN',       (1,0),  (1,-1), 'TOP'),
                ('BOX',          (0,0),  (0,-1), 1.5, ORANGE),
                ('BOX',          (1,0),  (2,-1), 0.5, BORDERGREY),
                ('LINEAFTER',    (1,0),  (1,-1), 0.5, BORDERGREY),
                ('LINEBELOW',    (0,0),  (0,-2), 0.5, BORDERGREY),
                ('LINEBELOW',    (1,0),  (2,-2), 0.5, BORDERGREY),
                ('TOPPADDING',   (0,0), (-1,-1), 8),
                ('BOTTOMPADDING',(0,0), (-1,-1), 8),
                ('LEFTPADDING',  (0,0),  (0,-1), 4),
                ('LEFTPADDING',  (1,0),  (1,-1), 8),
                ('LEFTPADDING',  (2,0),  (2,-1), 6),
            ]))
            story.append(ftable)

        story.append(PageBreak())

        # ── PAGES 2-N : Expériences (une par page) ───────────────────────────
        experiences = data.get('experiences', [])
        for i, exp in enumerate(experiences):
            story.append(Spacer(1, 0.3*cm))

            # Titre mission
            titre = exp.get('entreprise', f'Mission {i+1}')
            dates = exp.get('dates', '')
            duree = exp.get('duree', '')
            ligne_titre = titre
            if dates and dates != titre:
                ligne_titre += f" – {dates}"
            if duree:
                ligne_titre += f" – {duree}"
            story.append(Paragraph(ligne_titre, ST['mission_title']))
            story.append(mission_hr())

            if exp.get('secteur'):
                story.append(Paragraph(f"<b>Secteur :</b>  {exp['secteur']}", ST['body']))
            if exp.get('poste'):
                story.append(Paragraph(f"<b>Mission :</b>  {exp['poste']}", ST['body']))
            story.append(Spacer(1, 0.25*cm))

            # Sous-missions
            for sous in exp.get('sous_missions', []):
                if sous.get('titre') and sous['titre'] != 'Réalisations':
                    story.append(Paragraph(f'<b>{sous["titre"]}</b>', ST['body_bold']))
                elif sous.get('titre'):
                    story.append(Paragraph('<b>Réalisations :</b>', ST['mission_bold']))
                for bullet_text in sous.get('bullets', []):
                    story.append(b(bullet_text))
                story.append(Spacer(1, 4))

            if exp.get('outils'):
                story.append(Paragraph(f"<b>Logiciels / Outils :</b>  {exp['outils']}", ST['tools']))

            if i < len(experiences) - 1:
                story.append(PageBreak())

        return story
