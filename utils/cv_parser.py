#!/usr/bin/env python3
"""
Parse un CV (DOCX ou PDF) et retourne un dict structuré.
Ne lève jamais d'exception — dégradation gracieuse si champ absent.
"""
import os, re

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
            print(f"CVParser error: {e}")
            return self._empty()

    def _empty(self):
        return {
            "nom": "", "prenom": "", "titre_poste": "",
            "annees_experience": "",
            "email": "", "telephone": "", "localisation": "",
            "competences": [],
            "experiences": [],
            "formations": [],
            "langues": [],
            "certifications": []
        }

    def _parse_docx(self, filepath: str) -> dict:
        from docx import Document
        doc = Document(filepath)
        texte = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        return self._parse_text(texte)

    def _parse_pdf(self, filepath: str) -> dict:
        try:
            from pypdf import PdfReader
            reader = PdfReader(filepath)
            texte = "\n".join(page.extract_text() or "" for page in reader.pages)
            return self._parse_text(texte)
        except Exception:
            return self._empty()

    def _parse_text(self, texte: str) -> dict:
        data = self._empty()
        lignes = [l.strip() for l in texte.split('\n') if l.strip()]

        # Nom / prénom : heuristique — première ligne non vide en majuscules
        for l in lignes[:5]:
            mots = l.split()
            if 1 <= len(mots) <= 4 and any(m.isupper() or m.istitle() for m in mots):
                parties = l.rsplit(' ', 1)
                if len(parties) == 2:
                    data['prenom'], data['nom'] = parties[0], parties[1]
                else:
                    data['nom'] = l
                break

        # Email
        email_match = re.search(r'[\w.\-+]+@[\w.\-]+\.\w+', texte)
        if email_match:
            data['email'] = email_match.group()

        # Téléphone
        tel_match = re.search(r'(\+?\d[\d\s.\-]{7,14}\d)', texte)
        if tel_match:
            data['telephone'] = tel_match.group().strip()

        # Années d'expérience
        exp_match = re.search(r'(\d+)\s*an[s]?\s*d.exp\u00e9rience', texte, re.IGNORECASE)
        if exp_match:
            data['annees_experience'] = f"{exp_match.group(1)} ans d'expérience"

        # Titre poste : ligne après le nom, avant l'expérience
        for i, l in enumerate(lignes[1:8], 1):
            if re.search(r'ing\u00e9nieur|d\u00e9veloppeur|manager|chef|responsable|technicien|consultant', l, re.I):
                data['titre_poste'] = l
                break

        # Sections par mots-clés
        sections = self._split_sections(lignes)

        # Compétences
        if 'competences' in sections:
            data['competences'] = self._parse_competences_section(sections['competences'])

        # Expériences
        if 'experiences' in sections:
            data['experiences'] = self._parse_experiences_section(sections['experiences'])

        # Formations
        if 'formations' in sections:
            data['formations'] = self._parse_formations_section(sections['formations'])

        # Langues
        if 'langues' in sections:
            for l in sections['langues']:
                parts = re.split(r'[:\-\u2013]', l, 1)
                if len(parts) == 2:
                    data['langues'].append({
                        "langue": parts[0].strip(),
                        "niveau": parts[1].strip()
                    })

        # Certifications
        if 'certifications' in sections:
            data['certifications'] = [l for l in sections['certifications'] if l]

        return data

    def _split_sections(self, lignes):
        """Découpe le texte en sections par mots-clés."""
        KEYWORDS = {
            'competences':    r'comp\u00e9tences?|skills?|outils?',
            'experiences':    r'exp\u00e9riences?\s*professionnelles?|parcours|missions?',
            'formations':     r'formation|dipl\u00f4me|\u00e9tudes|education',
            'langues':        r'langues?|languages?',
            'certifications': r'certifications?|certificats?',
        }
        sections = {}
        current = None
        buf = []

        for l in lignes:
            matched = None
            for key, pattern in KEYWORDS.items():
                if re.search(pattern, l, re.I) and len(l) < 60:
                    matched = key
                    break
            if matched:
                if current and buf:
                    sections[current] = buf
                current = matched
                buf = []
            elif current:
                buf.append(l)

        if current and buf:
            sections[current] = buf

        return sections

    def _parse_competences_section(self, lignes):
        competences = []
        cat_courante = {"categorie": "Compétences", "items": []}
        for l in lignes:
            if len(l) < 50 and l.endswith(':'):
                if cat_courante['items']:
                    competences.append(cat_courante)
                cat_courante = {"categorie": l.rstrip(':'), "items": []}
            else:
                item = l.lstrip('\u2022-\u2013 ')
                if item:
                    cat_courante['items'].append(item)
        if cat_courante['items']:
            competences.append(cat_courante)
        return competences

    def _parse_experiences_section(self, lignes):
        experiences = []
        exp = None
        for l in lignes:
            date_match = re.search(
                r'(janvier|f\u00e9vrier|mars|avril|mai|juin|juillet|ao\u00fbt|'
                r'septembre|octobre|novembre|d\u00e9cembre|\d{4})', l, re.I)
            if date_match and len(l) < 80:
                if exp:
                    experiences.append(exp)
                exp = {
                    "entreprise": l, "dates": l, "duree": "",
                    "secteur": "", "poste": "",
                    "sous_missions": [{"titre": "Réalisations", "bullets": []}],
                    "outils": ""
                }
            elif exp:
                low = l.lower()
                if 'secteur' in low:
                    exp['secteur'] = l
                elif 'mission' in low or 'poste' in low or 'ing\u00e9nieur' in low:
                    exp['poste'] = l
                elif re.search(r'logiciels?|outils?|stack', low):
                    exp['outils'] = l
                else:
                    item = l.lstrip('\u2022-\u2013 ')
                    if item:
                        exp['sous_missions'][0]['bullets'].append(item)
        if exp:
            experiences.append(exp)
        return experiences

    def _parse_formations_section(self, lignes):
        formations = []
        for l in lignes:
            annee_match = re.search(r'(20\d{2}|19\d{2})', l)
            annee = annee_match.group(1) if annee_match else ""
            label = "Formation"
            if re.search(r'certif|brevet', l, re.I):
                label = "Certification"
            elif re.search(r'langue|anglais|fran\u00e7ais|espagnol', l, re.I):
                label = "Langue"
            formations.append({"label": label, "texte": l, "annee": annee})
        return formations

    def merge_with_candidate(self, cv_data: dict, candidate_db: dict) -> dict:
        """Les données DB ont la priorité si non vides."""
        merged = dict(cv_data)
        for key in ['nom', 'prenom', 'titre_poste', 'email', 'telephone', 'localisation']:
            db_val = candidate_db.get(key, '')
            if db_val and str(db_val).strip():
                merged[key] = db_val
        if not merged.get('annees_experience') and candidate_db.get('experience_years'):
            merged['annees_experience'] = f"{candidate_db['experience_years']} ans d'expérience"
        return merged
