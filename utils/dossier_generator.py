#!/usr/bin/env python3
"""
Génère un DOCX dossier de compétences au format Up Technologies.
Utilise python-docx pour une fidélité maximale au template Word officiel.
Sortie : fichier .docx (éditable dans Word/LibreOffice).
"""
import os
import re
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# ── Couleurs Up Technologies ──────────────────────────────────────────────────
ORANGE     = RGBColor(0xE8, 0x77, 0x22)
DARK       = RGBColor(0x1A, 0x1A, 0x1A)
GREY       = RGBColor(0x5A, 0x5A, 0x5A)
LGREY      = RGBColor(0xCC, 0xCC, 0xCC)

ORANGE_HEX = 'E87722'
LGREY_HEX  = 'CCCCCC'
WHITE_HEX  = 'FFFFFF'

BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_HEADER = os.path.join(BASE_DIR, 'static', 'up_assets', 'up_logo_header.png')
LOGO_FOOTER = os.path.join(BASE_DIR, 'static', 'up_assets', 'up_logo_footer.png')

# ── Helpers XML ───────────────────────────────────────────────────────────────

def _set_cell_borders(cell, **sides):
    """sides: top/left/bottom/right → {'color': hex, 'sz': int, 'val': str}"""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for old in tcPr.findall(qn('w:tcBorders')):
        tcPr.remove(old)
    borders = OxmlElement('w:tcBorders')
    for side, attrs in sides.items():
        e = OxmlElement(f'w:{side}')
        e.set(qn('w:val'),   attrs.get('val', 'single'))
        e.set(qn('w:sz'),    str(attrs.get('sz', 4)))
        e.set(qn('w:color'), attrs.get('color', 'auto'))
        e.set(qn('w:space'), '0')
        borders.append(e)
    tcPr.append(borders)


def _set_cell_borders_none(cell):
    """Remove all borders from a cell."""
    _set_cell_borders(cell,
        top={'val': 'none', 'color': 'auto', 'sz': 0},
        left={'val': 'none', 'color': 'auto', 'sz': 0},
        bottom={'val': 'none', 'color': 'auto', 'sz': 0},
        right={'val': 'none', 'color': 'auto', 'sz': 0})


def _set_cell_valign(cell, align='center'):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for old in tcPr.findall(qn('w:vAlign')):
        tcPr.remove(old)
    v = OxmlElement('w:vAlign')
    v.set(qn('w:val'), align)
    tcPr.append(v)


def _set_cell_margins(cell, top=60, left=60, bottom=60, right=60):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for old in tcPr.findall(qn('w:tcMar')):
        tcPr.remove(old)
    mar = OxmlElement('w:tcMar')
    for side, val in [('top', top), ('left', left), ('bottom', bottom), ('right', right)]:
        e = OxmlElement(f'w:{side}')
        e.set(qn('w:w'), str(val))
        e.set(qn('w:type'), 'dxa')
        mar.append(e)
    tcPr.append(mar)


def _para_spacing(para, before=0, after=0, line=240):
    pPr = para._p.get_or_add_pPr()
    for old in pPr.findall(qn('w:spacing')):
        pPr.remove(old)
    sp = OxmlElement('w:spacing')
    sp.set(qn('w:before'), str(before))
    sp.set(qn('w:after'), str(after))
    sp.set(qn('w:line'), str(line))
    sp.set(qn('w:lineRule'), 'auto')
    pPr.append(sp)


def _para_border_bottom(para, color=LGREY_HEX, sz=4):
    """Trace une ligne sous le paragraphe (séparateur)."""
    pPr = para._p.get_or_add_pPr()
    for old in pPr.findall(qn('w:pBdr')):
        pPr.remove(old)
    bdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), str(sz))
    bottom.set(qn('w:color'), color)
    bdr.append(bottom)
    pPr.append(bdr)


def _set_col_width(table, col_idx, width_cm):
    """Force la largeur d'une colonne via XML."""
    for row in table.rows:
        cell = row.cells[col_idx]
        tc = cell._tc
        tcPr = tc.get_or_add_tcPr()
        for old in tcPr.findall(qn('w:tcW')):
            tcPr.remove(old)
        tcW = OxmlElement('w:tcW')
        twips = int(width_cm * 567)
        tcW.set(qn('w:w'), str(twips))
        tcW.set(qn('w:type'), 'dxa')
        tcPr.append(tcW)


def _strip_bullet(text):
    return re.sub(
        r'^[\u2022\u2023\u25e6\u2043\u2219\u25cf\u25cb\u2714\u2713'
        r'\u279e\u27a4\u25b6\u2715\u2716\u27a2\u2023\u203a'
        r'\*\->\u27a4\u27a6\u27a1\u2192\u21e8\u27a4\u27a6\u27a1'
        r'➤✦❖●◆▶►•o\s]+',
        '', text
    ).strip()


# ── Classe principale ─────────────────────────────────────────────────────────

class DossierGenerator:

    def generate(self, data: dict, output_path: str) -> str:
        """Génère un fichier .docx et retourne le chemin."""
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        doc = Document()
        self._setup_page(doc)
        self._add_header_footer(doc)
        self._build_content(doc, data)
        doc.save(output_path)
        return output_path

    # ── Setup page ────────────────────────────────────────────────────────────
    def _setup_page(self, doc):
        section = doc.sections[0]
        section.page_width    = Cm(21.0)
        section.page_height   = Cm(29.7)
        section.left_margin   = Cm(2.0)
        section.right_margin  = Cm(2.0)
        section.top_margin    = Cm(3.2)
        section.bottom_margin = Cm(3.0)
        doc.styles['Normal'].font.name = 'Calibri'
        doc.styles['Normal'].font.size = Pt(10)

    def _add_header_footer(self, doc):
        section = doc.sections[0]

        # ── Header ────────────────────────────────────────────────────────────
        header = section.header
        header.is_linked_to_previous = False
        for p in header.paragraphs:
            p.clear()
        if os.path.exists(LOGO_HEADER):
            try:
                hp = header.paragraphs[0]
                hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                _para_spacing(hp, 0, 0)
                run = hp.add_run()
                run.add_picture(LOGO_HEADER, width=Cm(4.2))
            except Exception:
                _add_text_logo(header.paragraphs[0])
        else:
            _add_text_logo(header.paragraphs[0])

        # ── Footer ────────────────────────────────────────────────────────────
        footer = section.footer
        footer.is_linked_to_previous = False
        for p in footer.paragraphs:
            p.clear()
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _para_spacing(fp, 0, 0)
        if os.path.exists(LOGO_FOOTER):
            try:
                run = fp.add_run()
                run.add_picture(LOGO_FOOTER, width=Cm(7.0))
            except Exception:
                fp.add_run('Up Technologies').font.color.rgb = LGREY
        else:
            fp.add_run('Up Technologies').font.color.rgb = LGREY

    # ── Contenu principal ─────────────────────────────────────────────────────
    def _build_content(self, doc, data):
        nom_complet = (
            f"{data.get('prenom', '')} {data.get('nom', '')}".strip()
            or 'Candidat'
        )

        # ── Identité ──────────────────────────────────────────────────────────
        p = doc.add_paragraph()
        _para_spacing(p, 0, 20)
        r = p.add_run(nom_complet)
        r.bold = True
        r.font.size = Pt(20)
        r.font.color.rgb = DARK

        if data.get('titre_poste'):
            p = doc.add_paragraph()
            _para_spacing(p, 0, 10)
            r = p.add_run(data['titre_poste'])
            r.font.size = Pt(12)
            r.font.color.rgb = DARK

        if data.get('annees_experience'):
            p = doc.add_paragraph()
            _para_spacing(p, 0, 80)
            r = p.add_run(data['annees_experience'])
            r.font.size = Pt(12)
            r.font.color.rgb = DARK

        # ── Titre section compétences ─────────────────────────────────────────
        p = doc.add_paragraph()
        _para_spacing(p, 0, 60)
        r = p.add_run("Comp\u00e9tences, Outils & Secteurs d\u2019intervention")
        r.bold = True
        r.italic = True
        r.font.size = Pt(13)
        r.font.color.rgb = ORANGE

        # ── Tableau compétences ───────────────────────────────────────────────
        competences = [c for c in data.get('competences', []) if c.get('items')]
        if competences:
            self._add_competences_table(doc, competences)
        else:
            p = doc.add_paragraph('(Comp\u00e9tences \u00e0 renseigner)')
            _para_spacing(p, 0, 0)

        # ── Formation, Langues ────────────────────────────────────────────────
        formations  = data.get('formations', [])
        langues     = data.get('langues', [])
        certifs     = data.get('certifications', [])

        fl_rows = []
        if formations:
            form_lines = [f['texte'] for f in formations if f.get('texte')]
            if form_lines:
                fl_rows.append(('Formation', '\n'.join(form_lines), ''))
        if langues:
            lang_lines = [f"{l['langue']} \u2013 {l['niveau']}" for l in langues]
            fl_rows.append(('Langues', '\n'.join(lang_lines), ''))
        if certifs:
            fl_rows.append(('Certifications', '\n'.join(certifs), ''))

        if fl_rows:
            p = doc.add_paragraph()
            _para_spacing(p, 120, 60)
            r = p.add_run('Formation, Langues')
            r.bold = True
            r.italic = True
            r.font.size = Pt(13)
            r.font.color.rgb = ORANGE
            self._add_formation_table(doc, fl_rows)

        # ── Expériences (page break avant chaque) ────────────────────────────
        for i, exp in enumerate(data.get('experiences', [])):
            doc.add_page_break()
            self._add_experience(doc, exp, i)

    # ── Table compétences ─────────────────────────────────────────────────────
    def _add_competences_table(self, doc, competences):
        COL_L = 3.2   # cm — colonne label
        COL_R = 13.8  # cm — colonne items

        n = len(competences)
        tbl = doc.add_table(rows=n, cols=2)
        tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
        _set_col_width(tbl, 0, COL_L)
        _set_col_width(tbl, 1, COL_R)
        tbl.style = doc.styles['Table Grid']

        for i, cat in enumerate(competences):
            label = cat['categorie']
            items = [_strip_bullet(x) for x in cat['items'] if x and x.strip()]

            lc = tbl.rows[i].cells[0]
            rc = tbl.rows[i].cells[1]

            is_first = (i == 0)
            is_last  = (i == n - 1)

            _set_cell_borders(lc,
                top    = {'color': ORANGE_HEX, 'sz': 12} if is_first else {'color': LGREY_HEX, 'sz': 4},
                left   = {'color': ORANGE_HEX, 'sz': 12},
                bottom = {'color': ORANGE_HEX, 'sz': 12} if is_last  else {'color': LGREY_HEX, 'sz': 4},
                right  = {'color': LGREY_HEX, 'sz': 4},
            )
            _set_cell_borders(rc,
                top    = {'color': ORANGE_HEX, 'sz': 4} if is_first else {'color': LGREY_HEX, 'sz': 4},
                left   = {'color': LGREY_HEX, 'sz': 4},
                bottom = {'color': ORANGE_HEX, 'sz': 4} if is_last  else {'color': LGREY_HEX, 'sz': 4},
                right  = {'color': LGREY_HEX, 'sz': 4},
            )

            _set_cell_margins(lc, top=80, left=60, bottom=80, right=40)
            _set_cell_margins(rc, top=60, left=100, bottom=60, right=60)

            _set_cell_valign(lc, 'center')
            lp = lc.paragraphs[0]
            lp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _para_spacing(lp, 0, 0)
            lr = lp.add_run(label)
            lr.font.size  = Pt(9)
            lr.font.color.rgb = GREY

            _set_cell_valign(rc, 'top')
            first_item = True
            for item in items:
                if not item:
                    continue
                rp = rc.paragraphs[0] if first_item else rc.add_paragraph()
                first_item = False
                _para_spacing(rp, 0, 20)
                rp.paragraph_format.left_indent = Cm(0.15)
                rr = rp.add_run(f'\u2022\u00a0 {item}')
                rr.font.size  = Pt(8.5)
                rr.font.color.rgb = DARK

    # ── Table formation ───────────────────────────────────────────────────────
    def _add_formation_table(self, doc, fl_rows):
        n = len(fl_rows)
        tbl = doc.add_table(rows=n, cols=2)
        tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
        tbl.style = doc.styles['Table Grid']
        _set_col_width(tbl, 0, 3.2)
        _set_col_width(tbl, 1, 13.8)

        for i, (lbl, txt, _) in enumerate(fl_rows):
            is_first = (i == 0)
            is_last  = (i == n - 1)
            lc = tbl.rows[i].cells[0]
            rc = tbl.rows[i].cells[1]

            _set_cell_borders(lc,
                top    = {'color': ORANGE_HEX, 'sz': 12} if is_first else {'color': LGREY_HEX, 'sz': 4},
                left   = {'color': ORANGE_HEX, 'sz': 12},
                bottom = {'color': ORANGE_HEX, 'sz': 12} if is_last  else {'color': LGREY_HEX, 'sz': 4},
                right  = {'color': LGREY_HEX, 'sz': 4},
            )
            _set_cell_borders(rc,
                top    = {'color': ORANGE_HEX, 'sz': 4} if is_first else {'color': LGREY_HEX, 'sz': 4},
                left   = {'color': LGREY_HEX, 'sz': 4},
                bottom = {'color': ORANGE_HEX, 'sz': 4} if is_last  else {'color': LGREY_HEX, 'sz': 4},
                right  = {'color': LGREY_HEX, 'sz': 4},
            )
            _set_cell_margins(lc, top=80, left=60, bottom=80, right=40)
            _set_cell_margins(rc, top=60, left=100, bottom=60, right=60)

            _set_cell_valign(lc, 'center')
            lp = lc.paragraphs[0]
            lp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _para_spacing(lp, 0, 0)
            lr = lp.add_run(lbl)
            lr.font.size = Pt(9)
            lr.font.color.rgb = GREY

            _set_cell_valign(rc, 'top')
            first_line = True
            for line in txt.split('\n'):
                if not line.strip():
                    continue
                rp = rc.paragraphs[0] if first_line else rc.add_paragraph()
                first_line = False
                _para_spacing(rp, 0, 20)
                rr = rp.add_run(line.strip())
                rr.font.size = Pt(9)
                rr.font.color.rgb = DARK

    # ── Expérience ────────────────────────────────────────────────────────────
    def _add_experience(self, doc, exp, idx):
        entreprise   = exp.get('entreprise', '')
        dates        = exp.get('dates', '')
        duree        = exp.get('duree', '')

        # Titre du projet/mission (italique, gras, sombre) ─────────────────────
        # Choisir le meilleur titre disponible
        titre_projet = exp.get('titre_projet', '').strip()
        if not titre_projet:
            # Fallback : construire depuis poste + entreprise
            poste = exp.get('poste', '').strip()
            if poste and entreprise:
                titre_projet = f'{poste} chez {entreprise}'
            elif poste:
                titre_projet = poste
            elif entreprise:
                titre_projet = entreprise
            else:
                titre_projet = f'Mission {idx + 1}'

        p = doc.add_paragraph()
        _para_spacing(p, 0, 6)
        r = p.add_run(titre_projet)
        r.bold   = True
        r.italic = True
        r.font.size = Pt(14)
        r.font.color.rgb = DARK

        # Sous-titre : entreprise – dates – durée ──────────────────────────────
        subtitle_parts = [x for x in [entreprise, dates, duree] if x]
        if subtitle_parts:
            p = doc.add_paragraph()
            _para_spacing(p, 0, 0)
            r = p.add_run(' \u2013 '.join(subtitle_parts))
            r.font.size = Pt(11)
            r.font.color.rgb = GREY

        # Ligne de séparation ──────────────────────────────────────────────────
        p_hr = doc.add_paragraph()
        _para_spacing(p_hr, 60, 80)
        _para_border_bottom(p_hr, LGREY_HEX, sz=6)

        # Secteur / Poste ──────────────────────────────────────────────────────
        if exp.get('secteur'):
            p = doc.add_paragraph()
            _para_spacing(p, 0, 20)
            rb = p.add_run('Secteur\u00a0: ')
            rb.bold = True
            rb.font.size = Pt(9)
            r = p.add_run(exp['secteur'])
            r.font.size = Pt(9)
            r.font.color.rgb = DARK

        if exp.get('poste'):
            p = doc.add_paragraph()
            _para_spacing(p, 0, 80)
            rb = p.add_run('Mission\u00a0: ')
            rb.bold = True
            rb.font.size = Pt(9)
            r = p.add_run(exp['poste'])
            r.font.size = Pt(9)
            r.font.color.rgb = DARK

        # Sous-missions ────────────────────────────────────────────────────────
        for sous in exp.get('sous_missions', []):
            titre_sous = sous.get('titre', '')
            groupes    = sous.get('groupes', [])
            bullets    = [b for b in sous.get('bullets', []) if b and str(b).strip()]

            # Rien à afficher → passer
            if not bullets and not groupes:
                continue

            # En-tête de la sous-section
            if titre_sous:
                p = doc.add_paragraph()
                _para_spacing(p, 40, 20)
                rb = p.add_run(f'{titre_sous}\u00a0:')
                rb.bold = True
                rb.font.size = Pt(9)
                rb.font.color.rgb = DARK

            if groupes:
                # ── Bullets à deux niveaux ────────────────────────────────────
                # Niveau 1 : titre du groupe (• gras)
                # Niveau 2 : items du groupe (o grisé)
                for groupe in groupes:
                    g_titre = _strip_bullet(groupe.get('titre', ''))
                    g_items = [str(x).strip() for x in groupe.get('items', []) if x and str(x).strip()]

                    if not g_titre and not g_items:
                        continue

                    if g_titre:
                        p = doc.add_paragraph()
                        _para_spacing(p, 20, 8)
                        p.paragraph_format.left_indent = Cm(0.4)
                        rb = p.add_run(f'\u2022\u00a0 {g_titre}')
                        rb.bold = True
                        rb.font.size = Pt(9)
                        rb.font.color.rgb = DARK

                    for item in g_items:
                        clean = _strip_bullet(item)
                        if not clean:
                            continue
                        p = doc.add_paragraph()
                        _para_spacing(p, 0, 12)
                        p.paragraph_format.left_indent = Cm(1.2)
                        r = p.add_run(f'o\u00a0\u00a0{clean}')
                        r.font.size = Pt(8.5)
                        r.font.color.rgb = GREY

            else:
                # ── Bullets plats ─────────────────────────────────────────────
                for bullet in bullets:
                    clean = _strip_bullet(str(bullet))
                    if not clean:
                        continue
                    p = doc.add_paragraph()
                    _para_spacing(p, 0, 18)
                    p.paragraph_format.left_indent = Cm(0.5)
                    r = p.add_run(f'\u2022\u00a0\u00a0{clean}')
                    r.font.size = Pt(9)
                    r.font.color.rgb = DARK

        # Outils ───────────────────────────────────────────────────────────────
        if exp.get('outils'):
            p = doc.add_paragraph()
            _para_spacing(p, 80, 0)
            rb = p.add_run('Logiciels\u00a0/ Outils\u00a0: ')
            rb.bold = True
            rb.font.size = Pt(9)
            raw_outils = exp['outils']
            clean_outils = re.sub(
                r'^(logiciels?\s*/?\s*[Oo]utils?\s*:\s*)', '', raw_outils
            ).strip()
            r = p.add_run(clean_outils)
            r.font.size = Pt(9)
            r.font.color.rgb = DARK


def _add_text_logo(para):
    """Fallback texte si le logo image n'est pas disponible."""
    para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = para.add_run('UP TECHNOLOGIES')
    r.bold = True
    r.font.color.rgb = ORANGE
