#!/usr/bin/env python3
"""
Parse un CV (DOCX ou PDF) et retourne un dict structuré.
Ne lève jamais d'exception — dégradation gracieuse si champ absent.
"""
import os
import re

_DATE_RE = re.compile(
    r'\b(\d{2}/\d{4}|\d{4}[-/]\d{2,4}|'
    r'(?:jan|f[eé]v|mar|avr|mai|juin|juil|ao[uû]t?|sep|oct|nov|d[eé]c)'
    r'[\w.]*\s+\d{4})',
    re.IGNORECASE
)
_EXP_LINE_RE = re.compile(
    r'\(\s*\d+\s*(mois|an)|r[ôo]le\s*:|poste\s*:|mission\s*:|contexte\s*:',
    re.IGNORECASE
)
# Bullet chars à supprimer en début d'item
_BULLET_STRIP = re.compile(
    r'^[\u2022\u2023\u25e6\u2043\u2219\u25cf\u25cb\u2714\u2713'
    r'\u279e\u27a4\u25b6\u2715\u2716\u27a2\u2023\u203a'
    r'\*\->\u27a4\u27a6\u27a1\u2192\u21e8'
    r'➤✦❖●◆▶►•\s]+'
)


class CVParser:

    def parse(self, filepath: str) -> dict:
        ext = os.path.splitext(filepath)[1].lower()
        try:
            if ext == '.docx':
                return self._parse_docx(filepath)
            elif ext == '.pdf':
                return self._parse_pdf(filepath)
            else:
                return self._empty()
        except Exception as e:
            print(f'CVParser error: {e}')
            return self._empty()

    def _empty(self):
        return {
            'nom': '', 'prenom': '', 'titre_poste': '',
            'annees_experience': '',
            'email': '', 'telephone': '', 'localisation': '',
            'competences': [],
            'experiences': [],
            'formations': [],
            'langues': [],
            'certifications': []
        }

    # ── Extraction PDF ────────────────────────────────────────────────────────
    def _extract_pdf_text(self, filepath: str) -> str:
        try:
            import pypdfium2 as pdfium
            pdf = pdfium.PdfDocument(filepath)
            pages = []
            for i in range(len(pdf)):
                tp = pdf[i].get_textpage()
                pages.append(tp.get_text_range())
            return '\n'.join(pages)
        except Exception:
            pass
        try:
            from pypdf import PdfReader
            return '\n'.join(p.extract_text() or '' for p in PdfReader(filepath).pages)
        except Exception:
            pass
        return ''

    def _parse_docx(self, filepath: str) -> dict:
        from docx import Document
        doc = Document(filepath)
        texte = '\n'.join(p.text for p in doc.paragraphs if p.text.strip())
        return self._parse_text(texte)

    def _parse_pdf(self, filepath: str) -> dict:
        texte = self._extract_pdf_text(filepath)
        return self._parse_text(texte) if texte.strip() else self._empty()

    # ── Prétraitement des lignes ──────────────────────────────────────────────
    def _preprocess(self, raw_lignes: list) -> list:
        """
        1. Supprime les bullets seuls (•), numéros de page.
        2. Fusionne les labels fragmentés sur 2 lignes.
        """
        result = []
        i = 0
        while i < len(raw_lignes):
            l = raw_lignes[i]

            # Supprimer pagination et bullets seuls
            if re.match(r'^page\s+\d', l, re.I):
                i += 1; continue
            if re.match(r'^[•\-–—*]\s*$', l):
                i += 1; continue

            next_l = raw_lignes[i + 1] if i + 1 < len(raw_lignes) else ''

            # Fusionner "X de/du/des/d'" + suite (ex: "Domaines de" + "compétences")
            if next_l and re.search(r"\s+d[eu]s?$|\s+de$|\s+d'$", l) and len(l) < 22:
                result.append(l.rstrip() + ' ' + next_l.lstrip())
                i += 2; continue

            # Fusionner ligne se terminant par virgule + courte suite
            # (ex: "Langages, Outils," + "Normes")
            if next_l and l.endswith(',') and len(l) < 28 and len(next_l) < 22:
                result.append(l.rstrip() + ' ' + next_l.lstrip())
                i += 2; continue

            # Fusionner mot seul court + "d'..." (ex: "Secteurs" + "d'activités")
            # Normaliser les apostrophes courbes (U+2018/U+2019) pour la comparaison
            _next_norm = next_l.replace('\u2019', "'").replace('\u2018', "'")
            if (next_l and len(l) <= 12
                    and not re.search(r'[•\d–\-]', l)
                    and not l.startswith('•')
                    and (_next_norm.lower().startswith("d'") or _next_norm.lower().startswith("de ") or _next_norm.lower().startswith("du "))):
                result.append(l.rstrip() + ' ' + next_l.lstrip())
                i += 2; continue

            result.append(l)
            i += 1
        return result

    # ── Parse principal ───────────────────────────────────────────────────────
    def _parse_text(self, texte: str) -> dict:
        data = self._empty()
        texte = re.sub(r'[^\S\n]+', ' ', texte)
        raw = [l.strip() for l in texte.split('\n') if l.strip()]
        lignes = self._preprocess(raw)

        # Nom / prénom
        for l in lignes[:8]:
            if re.match(r'^page\s+\d', l, re.I):
                continue
            mots = l.split()
            if 1 <= len(mots) <= 5 and len(l) < 60 and not re.search(r'[@\d/\\–]', l):
                up_ratio = sum(1 for m in mots if m[0].isupper()) / len(mots)
                if up_ratio >= 0.5:
                    parties = l.rsplit(' ', 1)
                    if len(parties) == 2:
                        data['prenom'], data['nom'] = parties[0], parties[1]
                    else:
                        data['nom'] = l
                    break

        # Email
        m = re.search(r'[\w.\-+]+@[\w.\-]+\.\w{2,}', texte)
        if m: data['email'] = m.group()

        # Téléphone
        m = re.search(r'(\+?\d[\d\s.\-()\u00a0]{7,16}\d)', texte)
        if m: data['telephone'] = re.sub(r'\s+', ' ', m.group()).strip()

        # Années d'expérience
        m = re.search(r'(\d+)\s*an[s]?\s*d.exp[ée]rience', texte, re.IGNORECASE)
        if m: data['annees_experience'] = f"{m.group(1)} ans d'expérience"

        # Titre poste
        TITLE_PAT = (
            r'ing[ée]nieur|d[ée]veloppeur|developer|manager|chef|responsable|'
            r'technicien|consultant|analyste|architecte|directeur|coordinateur|'
            r'expert|lead|senior|junior|stagiaire|apprenti|scrum|product\s+owner'
        )
        for l in lignes[1:12]:
            if re.search(TITLE_PAT, l, re.I) and 5 < len(l) < 120 and not _DATE_RE.search(l):
                data['titre_poste'] = l
                break

        # Sections
        sections = self._split_sections(lignes)

        if 'competences' in sections:
            data['competences'] = self._parse_competences(sections['competences'])

        if 'experiences' in sections:
            data['experiences'] = self._parse_experiences(sections['experiences'])

        if 'formations' in sections:
            data['formations'] = self._parse_formations(sections['formations'])

        if 'langues' in sections:
            # Mots qui ne sont pas des noms de langues (éviter faux positifs depuis expériences)
            _NON_LANGUE = re.compile(
                r'^(stage|mission|secteur|projet|poste|logiciels?|outils?|contexte'
                r'|r[ée]alisation|responsable|client|dur[ée]e|p[ée]riode|lieu|ville'
                r'|entreprise|soci[ée]t[ée]|groupe|page)',
                re.I
            )
            for l in sections['langues']:
                if re.search(r'–|—|-', l):
                    parts = re.split(r'\s*[–—\-]\s*', l, 1)
                else:
                    parts = re.split(r'\s*:\s*', l, 1)
                _niveau = parts[1].strip() if len(parts) == 2 else ''
                if (len(parts) == 2
                        and 2 < len(parts[0]) < 25
                        and not _DATE_RE.search(parts[0])
                        and not _DATE_RE.search(_niveau)  # niveau ne contient pas de date
                        and not _NON_LANGUE.search(parts[0])
                        and len(parts[0].split()) <= 3   # max 3 mots (ex: "Anglais américain")
                        and len(_niveau) < 50):  # niveaux courts (B2, Courant, Natif…)
                    data['langues'].append({
                        'langue': parts[0].strip(),
                        'niveau': parts[1].strip()
                    })

        if 'certifications' in sections:
            data['certifications'] = [l for l in sections['certifications'] if len(l) > 3]

        return data

    # ── Découpage en sections ─────────────────────────────────────────────────
    def _split_sections(self, lignes: list) -> dict:
        KEYWORDS = {
            'competences': (
                r'comp[ée]tences?|skills?|savoir[\s\-]faire|expertise|profil\s+technique'
            ),
            'experiences': (
                r'exp[ée]riences?|parcours(\s+professionnel)?|historique(\s+professionnel)?'
                # missions? seul ou "missions professionnelles" — exige fin de ligne pour
                # éviter de matcher "Mission : Stagiaire..." ou "• Suivi des missions"
                r'|missions?(\s+professionnelles?)?\s*$|carri[eè]re|postes?\s+occup'
            ),
            'formations': (
                # Ancrer chaque alternative pour éviter les faux positifs
                # ("Votre formation...", "bureau d'études"...)
                r'^formations?'
                r'|^dipl[ôo]mes?'
                r'|^[ée]tudes?(?:\s+sup[ée]rieures?)?$'
                r'|^education$|^cursus$'
                r'|formation,?\s+langues?'
            ),
            'langues': (
                r'^langues?(\s+[ée]trang|parl|ma[îi]tri)?$|^languages?$'
            ),
            'certifications': (
                r'^certifications?$|^certificats?$'
            ),
        }
        sections: dict = {}
        current = None
        buf: list = []

        for l in lignes:
            # Retirer les préfixes bullets pour la détection de section
            l_test = _BULLET_STRIP.sub('', l).strip()
            if len(l_test) <= 70:
                matched = None
                for key, pat in KEYWORDS.items():
                    if re.search(pat, l_test, re.I) and len(l_test.split()) <= 8:
                        matched = key
                        break
                if matched:
                    if matched == current:
                        # Déjà dans cette section : label de sous-catégorie → ajouter au buf
                        buf.append(l)
                    else:
                        if current and buf:
                            sections[current] = buf
                        current = matched
                        buf = []
                    continue
            if current:
                buf.append(l)

        if current and buf:
            sections[current] = buf
        return sections

    # ── Parse section compétences ─────────────────────────────────────────────
    def _parse_competences(self, lignes: list) -> list:
        """
        Produit une liste de {categorie, items}.
        Chaque catégorie devient une rangée dans le tableau du dossier.
        """
        # Labels de tableau Up Technologies (après fusion)
        UP_LABEL_RE = re.compile(
            r'^(domaines?\s+de\s+comp[ée]tences?'
            r'|langages?,?\s+outils?,?\s+normes?'
            r'|secteurs?\s+d.activit[ée]s?'
            r'|outils?\s+et\s+technologies?'
            r'|comp[ée]tences?\s+techniques?'
            r'|comp[ée]tences?\s+fonctionnelles?'
            r'|technologies?\s+et\s+environnement'
            r'|environnement\s+technique'
            r'|m[ée]thodes?\s+et\s+outils?'
            r')$',
            re.I
        )

        competences = []
        cat = {'categorie': 'Compétences', 'items': []}

        for l in lignes:
            # Filtres parasites
            if re.match(r'^page\s+\d', l, re.I): continue
            if re.match(r'^[•\-–]\s*$', l): continue
            if re.match(r'^\(\d+\s*mois\)', l): continue
            if _DATE_RE.search(l) and len(l) < 60 and len(l.split()) <= 5: continue
            if _EXP_LINE_RE.search(l): continue

            # Détecter un en-tête de catégorie
            is_header = False
            stripped = _BULLET_STRIP.sub('', l).strip()

            if UP_LABEL_RE.match(stripped):
                is_header = True
            elif len(stripped) < 65 and (stripped.endswith(':') or stripped.endswith(' :')):
                is_header = True
            elif len(stripped) < 55 and stripped == stripped.upper() and len(stripped.split()) <= 6 and len(stripped) > 3:
                is_header = True

            if is_header:
                label = stripped.rstrip(':').rstrip(' :').strip()
                if label and label != cat['categorie']:
                    if cat['items']:
                        competences.append(cat)
                    cat = {'categorie': label, 'items': []}
                continue

            # Item de compétence
            item = _BULLET_STRIP.sub('', l).strip()
            if not item or len(item) <= 2: continue
            if _DATE_RE.search(item) and len(item.split()) <= 6: continue
            if len(item) > 200: continue
            cat['items'].append(item)

        if cat['items']:
            competences.append(cat)
        return competences

    # ── Parse section expériences ─────────────────────────────────────────────
    def _parse_experiences(self, lignes: list) -> list:
        experiences = []
        exp = None

        for l in lignes:
            if re.match(r'^page\s+\d', l, re.I): continue
            if _DATE_RE.search(l) and len(l) < 100:
                if exp: experiences.append(exp)
                exp = {
                    'entreprise': l, 'dates': l, 'duree': '',
                    'secteur': '', 'poste': '',
                    'sous_missions': [{'titre': 'Réalisations', 'bullets': []}],
                    'outils': ''
                }
            elif exp:
                low = l.lower()
                if re.match(r'^secteur\s*:', low) and len(l) < 120:
                    exp['secteur'] = re.sub(r'^secteur\s*:\s*', '', l, flags=re.I).strip()
                elif re.match(r'^(r[ôo]le|poste|mission|fonction)\s*:', low) and len(l) < 120:
                    exp['poste'] = re.sub(r'^[^:]+:\s*', '', l).strip()
                elif re.search(r'logiciels?|outils?|stack|technos?', low) and len(l) < 150:
                    exp['outils'] = l
                elif re.match(r'^\(\d+\s*mois\)', l.strip()):
                    exp['duree'] = l.strip()
                else:
                    item = _BULLET_STRIP.sub('', l).strip()
                    if item and len(item) > 3:
                        exp['sous_missions'][0]['bullets'].append(item)

        if exp: experiences.append(exp)
        return experiences

    # ── Parse section formations ──────────────────────────────────────────────
    def _parse_formations(self, lignes: list) -> list:
        formations = []
        for l in lignes:
            if re.match(r'^page\s+\d', l, re.I): continue
            if len(l) < 4: continue
            # Ignorer les sous-titres "Formation" et "Langues" seuls
            if re.match(r'^(formation|langues?|dipl[ôo]mes?)\s*$', l, re.I): continue
            annee_m = re.search(r'(20\d{2}|19\d{2})', l)
            label = 'Certification' if re.search(r'certif|brevet|aws|azure|pmp|prince2|itil|cisco', l, re.I) else 'Formation'
            formations.append({'label': label, 'texte': l, 'annee': annee_m.group(1) if annee_m else ''})
        return formations

    # ── Merge candidat DB ─────────────────────────────────────────────────────
    def merge_with_candidate(self, cv_data: dict, candidate_db: dict) -> dict:
        merged = dict(cv_data)
        for key in ['nom', 'prenom', 'titre_poste', 'email', 'telephone', 'localisation']:
            db_val = candidate_db.get(key, '')
            if db_val and str(db_val).strip():
                merged[key] = db_val
        if not merged.get('annees_experience'):
            for field in ('annees_experience', 'experience_years', 'years_experience'):
                yrs = candidate_db.get(field)
                if yrs:
                    merged['annees_experience'] = f"{yrs} ans d'expérience"
                    break
        return merged
