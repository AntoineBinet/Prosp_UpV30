#!/usr/bin/env python3
"""
Extraction structurée d'un CV via Ollama.
Retourne un dict compatible avec DossierGenerator.
Ne lève jamais d'exception — retourne None si indisponible.
"""
import json
import re
import urllib.request
import urllib.error


_PROMPT_TEMPLATE = """\
Analyse ce CV et retourne UNIQUEMENT un objet JSON valide (pas de markdown, pas d'explication).

Structure JSON exacte requise :
{{
  "nom": "NOM",
  "prenom": "Prénom",
  "titre_poste": "Chef de Projet",
  "annees_experience": "18 ans d'expérience",
  "email": "",
  "telephone": "",
  "competences": [
    {{"categorie": "Langages & Frameworks", "items": ["Java J2EE", "Spring", "JSF 2.0"]}},
    {{"categorie": "Outils", "items": ["Eclipse", "Maven", "Git"]}},
    {{"categorie": "Bases de données", "items": ["Oracle", "DB2", "SQL"]}},
    {{"categorie": "Méthodes", "items": ["UML", "Cycle en V", "Agile"]}},
    {{"categorie": "Secteurs d'activité", "items": ["Finance", "Assurance"]}}
  ],
  "experiences": [
    {{
      "entreprise": "Nom client / entreprise",
      "dates": "2010 – 2012",
      "duree": "(2 ans)",
      "secteur": "Assurance",
      "poste": "Développeur J2EE",
      "sous_missions": [{{"titre": "Réalisations", "bullets": ["Action 1", "Action 2"]}}],
      "outils": "Java, JSF, DB2"
    }}
  ],
  "formations": [{{"label": "Formation", "texte": "Diplôme – École", "annee": "2006"}}],
  "langues": [{{"langue": "Anglais", "niveau": "Courant"}}],
  "certifications": []
}}

Règles :
- "competences" = UNIQUEMENT les savoirs techniques (langages, frameworks, outils, BDD, méthodes, secteurs) — PAS les descriptions de missions
- "experiences" = une entrée par mission/client distincte, avec réalisations et outils
- Max 8 items par catégorie de compétences, max 10 expériences
- Laisse vide ("") les champs absents — ne les invente pas

CV :
{cv_text}"""


def extract(cv_text: str, ollama_url: str = 'http://127.0.0.1:11434',
            model: str = 'llama3.2', timeout: int = 120) -> dict | None:
    """
    Envoie cv_text à Ollama pour extraction structurée.
    Retourne un dict ou None si échec.
    """
    # Tronquer à 6000 caractères pour tenir dans le contexte du modèle
    cv_truncated = cv_text[:6000]
    if len(cv_text) > 6000:
        cv_truncated += '\n[... texte tronqué ...]'

    prompt = _PROMPT_TEMPLATE.format(cv_text=cv_truncated)

    payload = json.dumps({
        'model':  model,
        'prompt': prompt,
        'stream': False,
        'options': {
            'temperature': 0.1,
            'num_predict': 3000,
        }
    }).encode('utf-8')

    url = ollama_url.rstrip('/') + '/api/generate'
    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8')
            result = json.loads(raw)
            response_text = result.get('response', '')
    except Exception as e:
        print(f'[OllamaExtractor] connexion échouée : {e}')
        return None

    # Extraire le JSON de la réponse (parfois entouré de markdown)
    return _parse_json_response(response_text)


def _parse_json_response(text: str) -> dict | None:
    """Extraire et valider le JSON dans la réponse Ollama."""
    # Supprimer les blocs markdown
    text = re.sub(r'```(?:json)?\s*', '', text).strip()
    text = text.replace('```', '').strip()

    # Trouver le premier { ... } complet
    start = text.find('{')
    if start == -1:
        print('[OllamaExtractor] pas de JSON trouvé dans la réponse')
        return None

    # Trouver la fin du JSON en comptant les accolades
    depth = 0
    end = -1
    for i, ch in enumerate(text[start:], start):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    if end == -1:
        # JSON incomplet — essayer quand même
        json_str = text[start:]
    else:
        json_str = text[start:end]

    try:
        data = json.loads(json_str)
    except json.JSONDecodeError:
        # Tentative de réparation : supprimer trailing commas
        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            print(f'[OllamaExtractor] JSON invalide : {e}')
            return None

    return _normalize(data)


def _normalize(data: dict) -> dict:
    """S'assurer que le dict a toutes les clés attendues avec les bons types."""
    def _str(v):  return str(v).strip() if v else ''
    def _list(v): return v if isinstance(v, list) else []

    competences = []
    for cat in _list(data.get('competences')):
        if isinstance(cat, dict):
            categorie = _str(cat.get('categorie') or cat.get('category', ''))
            items     = [_str(x) for x in _list(cat.get('items')) if x]
            if categorie and items:
                competences.append({'categorie': categorie, 'items': items})

    experiences = []
    for exp in _list(data.get('experiences')):
        if isinstance(exp, dict):
            sous = []
            for sm in _list(exp.get('sous_missions')):
                if isinstance(sm, dict):
                    bullets = [_str(b) for b in _list(sm.get('bullets')) if b]
                    sous.append({'titre': _str(sm.get('titre', 'Réalisations')), 'bullets': bullets})
            if not sous:
                sous = [{'titre': 'Réalisations', 'bullets': []}]
            experiences.append({
                'entreprise': _str(exp.get('entreprise')),
                'dates':      _str(exp.get('dates')),
                'duree':      _str(exp.get('duree')),
                'secteur':    _str(exp.get('secteur')),
                'poste':      _str(exp.get('poste')),
                'sous_missions': sous,
                'outils':     _str(exp.get('outils')),
            })

    formations = []
    for f in _list(data.get('formations')):
        if isinstance(f, dict):
            formations.append({
                'label': _str(f.get('label', 'Formation')),
                'texte': _str(f.get('texte')),
                'annee': _str(f.get('annee')),
            })

    langues = []
    for l in _list(data.get('langues')):
        if isinstance(l, dict):
            langue = _str(l.get('langue'))
            niveau = _str(l.get('niveau'))
            if langue:
                langues.append({'langue': langue, 'niveau': niveau})

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
        'certifications':    [_str(c) for c in _list(data.get('certifications')) if c],
    }
