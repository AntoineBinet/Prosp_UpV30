#!/usr/bin/env python3
"""
Extraction structurée d'un CV via Ollama.
Approche en 2 passes avec détection de sections pour éviter
que les expériences parasitent les compétences.
"""
import json
import re
import urllib.request
import urllib.error

# ── Prompts ───────────────────────────────────────────────────────────────────

_PROMPT_COMPETENCES = """\
Tu es un expert RH. À partir du texte de CV ci-dessous, extrais les informations du candidat.

RÈGLES POUR "competences" :
- Compétences techniques GLOBALES : langages, frameworks, outils, BDD, cloud, méthodes, certifications
- Max 8 catégories — labels GÉNÉRIQUES obligatoires : "Langages", "Frameworks", "Outils & DevOps", "Bases de données", "Cloud & Infrastructure", "Méthodes", "Secteurs", "Domaines de compétences", "Web", "Conception", "Certifications"
- INTERDIT comme catégorie : un nom d'outil seul (SQL, Docker…), un nom de client, un fragment de mission
- NE PAS inclure les réalisations ou descriptions de missions dans les compétences
- Utilise "groupes" pour les catégories à sous-domaines, "items" pour les listes simples

RÈGLES POUR "formations" :
- Tous les diplômes, BTS, licences, masters, certifications académiques — ordre décroissant (le plus récent en premier)
- Si l'année n'est pas précisée, laisser "annee" vide ("")
- "label" = type de diplôme (ex: "Master", "BTS", "Licence", "Diplôme d'ingénieur")
- "texte" = intitulé complet + établissement (ex: "Master Informatique – Université Paris VI")

RÈGLES POUR "langues" :
- Toutes les langues mentionnées avec leur niveau si précisé
- Niveaux acceptés : Natif, Courant, Professionnel, Intermédiaire, Notions, A1/A2/B1/B2/C1/C2

Retourne UNIQUEMENT ce JSON valide, sans markdown ni explication :
{{
  "nom": "DUPONT",
  "prenom": "Jean",
  "titre_poste": "Chef de Projet / Expert DevOps",
  "annees_experience": "18 ans d'expérience",
  "competences": [
    {{
      "categorie": "Domaines de compétences",
      "groupes": [
        {{"titre": "Architecture logicielle", "items": ["Microservices", "API REST", "Event-driven"]}},
        {{"titre": "Développement backend", "items": ["Java J2EE", "Spring Boot", "Python"]}}
      ]
    }},
    {{"categorie": "Outils & DevOps", "items": ["Jenkins", "Docker", "Kubernetes", "Git"]}},
    {{"categorie": "Cloud & Infrastructure", "items": ["Azure", "AWS", "Linux"]}},
    {{"categorie": "Méthodes", "items": ["Agile/Scrum", "DevOps", "PRINCE2"]}},
    {{"categorie": "Secteurs", "items": ["Finance", "Assurance", "Énergie"]}}
  ],
  "formations": [
    {{"label": "Master", "texte": "Master Informatique – Université Paris VI", "annee": "2006"}},
    {{"label": "BTS", "texte": "BTS Informatique de Gestion – Lycée X", "annee": "2004"}}
  ],
  "langues": [
    {{"langue": "Français", "niveau": "Natif"}},
    {{"langue": "Anglais", "niveau": "Courant"}}
  ],
  "certifications": ["AWS Certified Solutions Architect", "PRINCE2"]
}}

TEXTE DU CV :
{cv_text}"""

_PROMPT_EXPERIENCES = """\
Tu es un expert RH. À partir du texte de CV ci-dessous, extrais TOUTES les expériences professionnelles.

RÈGLES STRICTES :
- Une entrée = un poste ou une mission chez un employeur ou client
- "entreprise" OBLIGATOIRE : nom de l'employeur ou du client final. JAMAIS vide.
- "dates" OBLIGATOIRE : période (ex: "01/2022 – 07/2023", "Depuis 09/2020", "2018 – 2021")
- "titre_projet" = nom du projet ou de la mission. Si absent → "{poste} chez {entreprise}"
- "poste" = rôle ou fonction du candidat (ex: "Développeur Senior", "Chef de Projet", "Consultant")
- "secteur" = secteur d'activité de l'entreprise (ex: "Banque", "Assurance", "Industrie", "Retail")
- "duree" = durée calculée si possible (ex: "(18 mois)", "(2 ans)")
- "sous_missions" = liste des activités, réalisations ou responsabilités décrites dans le CV
  Format : liste de bullets simples
- "outils" = technologies et outils utilisés dans CETTE mission, séparés par des virgules
- Extraire TOUTES les expériences du CV sans limite de nombre
- NE PAS inventer de données absentes du CV
- Si une expérience n'a pas d'entreprise identifiable, NE PAS la créer

Retourne UNIQUEMENT ce JSON valide, sans markdown ni explication :
{{
  "experiences": [
    {{
      "titre_projet": "Refonte portail client",
      "entreprise": "BNP Paribas",
      "dates": "03/2022 à 09/2023",
      "duree": "(18 mois)",
      "secteur": "Banque",
      "poste": "Chef de Projet",
      "sous_missions": [
        {{
          "titre": "Réalisations",
          "bullets": [
            "Pilotage d'une équipe de 8 développeurs",
            "Rédaction des spécifications fonctionnelles",
            "Suivi des livraisons et recette utilisateur"
          ]
        }}
      ],
      "outils": "Java, Spring Boot, Oracle, Jira, Git"
    }}
  ]
}}

TEXTE DU CV :
{cv_text}"""

# ── Détection de sections ─────────────────────────────────────────────────────

_SECTION_PATTERNS = {
    'competences': [
        r'(?im)^[ \t]*(?:COMP[EÉ]TENCES?(?:\s+TECHNIQUES?)?|TECHNICAL\s+SKILLS?|SAVOIRS?\s*FAIRE?|EXPERTISE\s+TECHNIQUE)\s*:?\s*$',
        r'(?im)^[ \t]*(?:COMP[EÉ]TENCES?(?:\s+PRINCIPALES?)?|SKILLS?|HARD\s+SKILLS?)\b[^\n]{0,30}$',
        r'(?im)^[ \t]*(?:TECHNOLOGIES?|OUTILS?\s+ET\s+TECHNOLOGIES?|TECHNICAL\s+EXPERTISE)\s*:?\s*$',
    ],
    'experiences': [
        r'(?im)^[ \t]*(?:EXP[EÉ]RIENCES?\s+PROFESSIONNELLES?|PARCOURS\s+PROFESSIONNEL|EXP[EÉ]RIENCES?\s+(?:DE\s+)?TRAVAIL)\s*:?\s*$',
        r'(?im)^[ \t]*(?:EXP[EÉ]RIENCES?|MISSIONS?\s+PROFESSIONNELLES?)\s*:?\s*$',
        r'(?im)^[ \t]*(?:PROFESSIONAL\s+EXPERIENCE|WORK\s+EXPERIENCE|CAREER\s+HISTORY)\s*:?\s*$',
        r'(?im)^[ \t]*EXP[EÉ]RIENCE\s*$',
    ],
    'formations': [
        r'(?im)^[ \t]*(?:FORMATIONS?\s+(?:ET\s+)?DIPL[OÔ]MES?|FORMATIONS?\s+ACAD[EÉ]MIQUES?|PARCOURS\s+(?:ACAD[EÉ]MIQUE|SCOLAIRE)|EDUCATION)\s*:?\s*$',
        r'(?im)^[ \t]*(?:FORMATIONS?|DIPL[OÔ]MES?|STUDIES?|CURSUS)\s*:?\s*$',
        r'(?im)^[ \t]*(?:EDUCATION\s+AND\s+TRAINING|ACADEMIC\s+BACKGROUND)\s*:?\s*$',
    ],
}


def _find_section_bounds(cv_text: str) -> dict:
    """Retourne {section: (start, end)} pour les sections détectées."""
    found = {}
    for section, patterns in _SECTION_PATTERNS.items():
        for pat in patterns:
            m = re.search(pat, cv_text)
            if m:
                found[section] = m.start()
                break

    # Trier par position et calculer les bornes
    sorted_secs = sorted(found.items(), key=lambda x: x[1])
    bounds = {}
    for i, (name, start) in enumerate(sorted_secs):
        end = sorted_secs[i + 1][1] if i + 1 < len(sorted_secs) else len(cv_text)
        bounds[name] = (start, end)
    return bounds


def _split_cv(cv_text: str) -> dict:
    """
    Sépare le CV en sections (compétences, expériences).
    Retourne un dict avec les textes isolés pour chaque section.
    """
    bounds = _find_section_bounds(cv_text)
    result = {}
    total = len(cv_text)
    # En-tête du CV (nom, titre, contact) = premiers 600 chars
    header = cv_text[:600].strip()

    # Section compétences
    if 'competences' in bounds:
        s, e = bounds['competences']
        pre_section = cv_text[:s].strip()
        comp_section = cv_text[s:e].strip()
        result['competences'] = (pre_section + '\n\n' + comp_section).strip() if pre_section else comp_section
    else:
        # Aucune section détectée : envoyer tout le CV (le modèle extrait lui-même)
        # Limité à 5000 chars pour rester dans le contexte
        result['competences'] = (header + '\n\n' + cv_text).strip()[:5000]

    # Section expériences
    if 'experiences' in bounds:
        s, e = bounds['experiences']
        result['experiences'] = cv_text[s:e].strip()
    elif 'formations' in bounds:
        # Tout ce qui précède les formations = probablement les expériences
        s_form = bounds['formations'][0]
        result['experiences'] = cv_text[:s_form].strip()
    else:
        # Aucune section détectée : envoyer tout le CV
        result['experiences'] = cv_text.strip()

    return result


def _smart_truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    last_nl = cut.rfind('\n', max_chars - 500, max_chars)
    if last_nl > max_chars - 600:
        cut = cut[:last_nl]
    return cut + '\n\n[... tronqué ...]'


# ── Appel Ollama ──────────────────────────────────────────────────────────────

def _call_ollama(prompt: str, ollama_url: str, model: str, timeout: int) -> str | None:
    payload = json.dumps({
        'model':   model,
        'prompt':  prompt,
        'stream':  False,
        'options': {
            'temperature': 0.05,
            'num_predict': 4096,
            'num_ctx':     8192,
        }
    }).encode('utf-8')

    url = ollama_url.rstrip('/') + '/api/generate'
    try:
        req = urllib.request.Request(
            url, data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw  = resp.read().decode('utf-8')
            data = json.loads(raw)
            return data.get('response', '')
    except Exception as e:
        print(f'[OllamaExtractor] erreur : {e}')
        return None


# ── Validation de l'extraction ────────────────────────────────────────────────

_BAD_CATEGORY_RE = re.compile(
    r'(?i)(réalisat|sinistre|assurance|iard|déclaration|projet\s+de|mission\s+de'
    r'|client|espace|société|entreprise\s+\w+|refonte|personnalisat)',
)
_TOOL_AS_CATEGORY_RE = re.compile(
    r'^(?:SQL|DB2|Oracle|Java|Python|Eclipse|Maven|Jira|Docker|Git|Spring'
    r'|Subversion|SVN|Jenkins|Linux|Unix|COBOL|Angular|React)\.?\s*$',
    re.IGNORECASE
)
_EXPERIENCE_AS_CATEGORY_RE = re.compile(
    r'(?i)(technologies\s+et\s+outils\s+utilis|utilisés\s+au\s+quotidien'
    r'|\d+\s*/\s*\d+|^\d{4}\s+à\s+\d{4})',
)


def _is_valid_competences(data: dict) -> bool:
    """Détecte si les compétences extraites sont en réalité du contenu d'expériences."""
    cats = data.get('competences', [])
    if not cats:
        return True  # Pas de compétences = pas faux, juste vide

    bad = 0
    for cat in cats:
        name = cat.get('categorie', '')
        if (_BAD_CATEGORY_RE.search(name)
                or _TOOL_AS_CATEGORY_RE.match(name)
                or _EXPERIENCE_AS_CATEGORY_RE.search(name)):
            bad += 1
        # Vérifier aussi les titres de groupes si présents
        for g in cat.get('groupes', []):
            g_name = g.get('titre', '')
            if (_BAD_CATEGORY_RE.search(g_name) or _TOOL_AS_CATEGORY_RE.match(g_name)):
                bad += 0.5  # Demi-pénalité pour les groupes

    # Si plus du tiers des catégories semblent mauvaises → invalide
    return bad <= len(cats) * 0.33


def _is_valid_experiences(data: dict) -> bool:
    """Une liste d'expériences est valide si la majorité des entrées ont
    au moins une entreprise ou un titre de projet non vide."""
    exps = data.get('experiences', [])
    if not exps:
        return True
    invalid = 0
    for e in exps:
        if not isinstance(e, dict):
            invalid += 1; continue
        ent = str(e.get('entreprise', '')).strip()
        tit = str(e.get('titre_projet', '')).strip()
        if not ent and not tit:
            invalid += 1
    return invalid <= len(exps) * 0.3


def _dedupe_experiences(exps: list) -> list:
    """Supprime les doublons (même entreprise + mêmes dates)."""
    seen = set()
    out = []
    for e in exps:
        if not isinstance(e, dict):
            continue
        key = (str(e.get('entreprise', '')).strip().lower(),
               str(e.get('dates', '')).strip().lower())
        if key == ('', '') or key not in seen:
            seen.add(key)
            out.append(e)
    return out


# ── Extraction principale ─────────────────────────────────────────────────────

def extract(cv_text: str, ollama_url: str = 'http://127.0.0.1:11434',
            model: str = 'llama3.2', timeout: int = 180) -> dict | None:
    """
    Extraction en 2 passes :
    1. Passe compétences : identité + compétences sur la section dédiée
    2. Passe expériences : liste des missions sur la section dédiée
    Combine et normalise les résultats.
    """
    sections = _split_cv(cv_text)
    print(f'[OllamaExtractor] section compétences : {len(sections["competences"])} chars')
    print(f'[OllamaExtractor] section expériences : {len(sections["experiences"])} chars')

    # ── Passe 1 : Compétences ─────────────────────────────────────────────────
    comp_text = _smart_truncate(sections['competences'], 6000)
    prompt1 = _PROMPT_COMPETENCES.format(cv_text=comp_text)
    raw1 = _call_ollama(prompt1, ollama_url, model, min(timeout, 120))
    comp_data = {}
    if raw1:
        comp_data = _parse_json_response(raw1) or {}
        if not _is_valid_competences(comp_data):
            print('[OllamaExtractor] compétences invalides (contenu d\'expériences détecté), retry...')
            # Retry avec seulement le début du CV (header + 2000 chars)
            short_text = _smart_truncate(cv_text, 2500)
            raw1b = _call_ollama(_PROMPT_COMPETENCES.format(cv_text=short_text),
                                 ollama_url, model, min(timeout, 90))
            comp_data = (_parse_json_response(raw1b) or {}) if raw1b else {}

    # ── Passe 2 : Expériences ─────────────────────────────────────────────────
    exp_text = _smart_truncate(sections['experiences'], 10000)
    prompt2 = _PROMPT_EXPERIENCES.format(cv_text=exp_text)
    raw2 = _call_ollama(prompt2, ollama_url, model, timeout)
    exp_data = {}
    if raw2:
        exp_data = _parse_json_response(raw2) or {}
        if not _is_valid_experiences(exp_data):
            print('[OllamaExtractor] expériences invalides (entreprise/titre manquants), retry...')
            raw2b = _call_ollama(prompt2, ollama_url, model, min(timeout, 120))
            if raw2b:
                retry = _parse_json_response(raw2b) or {}
                if _is_valid_experiences(retry):
                    exp_data = retry

    # Filtrer les expériences vides
    raw_exps = exp_data.get('experiences', []) if isinstance(exp_data, dict) else []
    clean_exps = []
    for e in raw_exps:
        if not isinstance(e, dict):
            continue
        ent = str(e.get('entreprise', '')).strip()
        tit = str(e.get('titre_projet', '')).strip()
        dates = str(e.get('dates', '')).strip()
        if not ent and not tit and not dates:
            continue
        clean_exps.append(e)
    clean_exps = _dedupe_experiences(clean_exps)

    # ── Fusion ────────────────────────────────────────────────────────────────
    combined = {**comp_data}  # nom, prenom, titre_poste, annees_experience, competences, formations, langues, certifications
    combined['experiences'] = clean_exps

    if not (combined.get('nom') or combined.get('competences') or combined.get('experiences')):
        return None

    result = _normalize(combined)

    # Signaler les champs manquants pour le feedback frontend
    missing = []
    if not result.get('nom') and not result.get('prenom'):
        missing.append('identité')
    if not result.get('competences'):
        missing.append('compétences')
    if not result.get('experiences'):
        missing.append('expériences')
    if not result.get('formations'):
        missing.append('formations')
    if not result.get('langues'):
        missing.append('langues')
    if missing:
        result['_missing'] = missing

    return result


# ── Parsing JSON ──────────────────────────────────────────────────────────────

def _parse_json_response(text: str) -> dict | None:
    if not text:
        return None
    # Supprimer blocs markdown
    text = re.sub(r'```(?:json)?\s*', '', text).strip()
    text = text.replace('```', '').strip()

    start = text.find('{')
    if start == -1:
        return None

    depth = 0; end = -1; in_str = False; esc = False
    for i, ch in enumerate(text[start:], start):
        if esc:       esc = False; continue
        if ch == '\\' and in_str: esc = True; continue
        if ch == '"':  in_str = not in_str; continue
        if in_str:     continue
        if ch == '{':  depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0: end = i + 1; break

    json_str = text[start:end] if end != -1 else text[start:]

    def _try_parse(s: str) -> dict | None:
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return None

    result = _try_parse(json_str)
    if result is not None:
        return result

    # Tentatives de réparation successives
    fixed = json_str
    # 1. Virgules traînantes avant } ou ]
    fixed = re.sub(r',\s*([}\]])', r'\1', fixed)
    result = _try_parse(fixed)
    if result is not None:
        return result

    # 2. Sauts de ligne littéraux dans les chaînes → \n
    fixed = re.sub(r'(?<="[^"]{0,500})\n(?=[^"]{0,500}")', r'\\n', fixed)
    result = _try_parse(fixed)
    if result is not None:
        return result

    # 3. Clore un JSON tronqué (num_predict atteint) en fermant les accolades manquantes
    depth2 = 0
    for ch in fixed:
        if ch == '{': depth2 += 1
        elif ch == '}': depth2 -= 1
    if depth2 > 0:
        # Supprimer la dernière entrée incomplète (peut-être tronquée)
        last_comma = fixed.rfind(',')
        if last_comma > 0:
            truncated = fixed[:last_comma] + ('}' * depth2)
            result = _try_parse(re.sub(r',\s*([}\]])', r'\1', truncated))
            if result is not None:
                print('[OllamaExtractor] JSON réparé (tronqué)')
                return result

    print(f'[OllamaExtractor] JSON invalide après réparation')
    return None


# ── Normalisation ─────────────────────────────────────────────────────────────

def _normalize(data: dict) -> dict:
    def _str(v):  return str(v).strip() if v else ''
    def _lst(v):  return v if isinstance(v, list) else []

    competences = []
    for cat in _lst(data.get('competences')):
        if not isinstance(cat, dict):
            continue
        cat_name = _str(cat.get('categorie') or cat.get('category', ''))
        if not cat_name:
            continue
        raw_groupes = _lst(cat.get('groupes'))
        if raw_groupes:
            # Structure groupée : titre (gras) + sous-items
            groupes = []
            for g in raw_groupes:
                if isinstance(g, dict):
                    g_titre = _str(g.get('titre', ''))
                    g_items = [_str(x) for x in _lst(g.get('items')) if x and str(x).strip()]
                    if g_items:
                        groupes.append({'titre': g_titre, 'items': g_items[:10]})
            if groupes:
                competences.append({'categorie': cat_name, 'groupes': groupes})
        else:
            items = [_str(x) for x in _lst(cat.get('items')) if x and str(x).strip()]
            if items:
                competences.append({'categorie': cat_name, 'items': items[:12]})

    experiences = []
    for exp in _lst(data.get('experiences')):
        if not isinstance(exp, dict):
            continue
        sous = []
        for sm in _lst(exp.get('sous_missions')):
            if not isinstance(sm, dict):
                continue
            bullets = [_str(b) for b in _lst(sm.get('bullets')) if b and str(b).strip()]
            groupes = []
            for g in _lst(sm.get('groupes')):
                if isinstance(g, dict):
                    g_items = [_str(x) for x in _lst(g.get('items')) if x and str(x).strip()]
                    if g_items:
                        groupes.append({'titre': _str(g.get('titre', '')), 'items': g_items})
            entry = {'titre': _str(sm.get('titre', 'Réalisations')), 'bullets': bullets}
            if groupes:
                entry['groupes'] = groupes
            if bullets or groupes:
                sous.append(entry)
        if not sous:
            sous = [{'titre': 'Réalisations', 'bullets': []}]
        experiences.append({
            'titre_projet': _str(exp.get('titre_projet')),
            'entreprise':   _str(exp.get('entreprise')),
            'dates':        _str(exp.get('dates')),
            'duree':        _str(exp.get('duree')),
            'secteur':      _str(exp.get('secteur')),
            'poste':        _str(exp.get('poste')),
            'sous_missions': sous,
            'outils':       _str(exp.get('outils')),
        })

    formations = []
    for f in _lst(data.get('formations')):
        if isinstance(f, dict):
            formations.append({
                'label': _str(f.get('label', 'Formation')),
                'texte': _str(f.get('texte')),
                'annee': _str(f.get('annee')),
            })

    langues = []
    for l in _lst(data.get('langues')):
        if isinstance(l, dict):
            langue = _str(l.get('langue'))
            if langue:
                langues.append({'langue': langue, 'niveau': _str(l.get('niveau'))})

    return {
        'nom':               _str(data.get('nom')),
        'prenom':            _str(data.get('prenom')),
        'titre_poste':       _str(data.get('titre_poste')),
        'annees_experience': _str(data.get('annees_experience')),
        'email':             _str(data.get('email')),
        'telephone':         _str(data.get('telephone')),
        'localisation':      _str(data.get('localisation')),
        'competences':       competences,
        'experiences':       experiences,
        'formations':        formations,
        'langues':           langues,
        'certifications':    [_str(c) for c in _lst(data.get('certifications')) if c],
    }
