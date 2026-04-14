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
Tu es un expert RH spécialisé dans les CVs de consultants français.
Analyse ce CV et retourne UNIQUEMENT un objet JSON valide. Aucun markdown, aucune explication, aucun texte avant ou après le JSON.

═══════════════════════════════════════════════════════
RÈGLES ABSOLUES :
═══════════════════════════════════════════════════════

1. COMPÉTENCES = résumé GLOBAL des savoirs techniques du candidat
   ✓ À inclure : langages de programmation, frameworks, outils, BDD, cloud, méthodes, normes, secteurs
   ✗ À EXCLURE : toute description de mission, résultat, réalisation, contexte client
   → Maximum 6 catégories, maximum 10 items par catégorie

2. EXPÉRIENCES = liste des missions/projets (max 12)
   → Une entrée = une mission distincte chez un client ou employeur
   → "titre_projet" : nom du projet ou de la mission
     Ex: "Refonte espace client GMF", "Projet DevOps CI/CD", "Stage Contrôle-Commande DAB"
     Si pas de nom explicite → "{rôle} chez {entreprise}", ex: "Chef de Projet chez EFS"
   → "sous_missions" : réalisations de la mission
     • Si liste simple → utiliser "bullets" : ["réalisation 1", "réalisation 2"]
     • Si réalisations organisées en sous-parties → utiliser "groupes" :
       [{{"titre": "Sous-partie", "items": ["item 1", "item 2"]}}]

3. FORMATIONS = diplômes et formations académiques UNIQUEMENT (pas les certifications pro)

4. CERTIFICATIONS = certifications professionnelles (AWS, PRINCE2, etc.)

═══════════════════════════════════════════════════════
STRUCTURE JSON EXACTE (respecter les noms de clés) :
═══════════════════════════════════════════════════════
{{
  "nom": "NOM_EN_MAJUSCULES",
  "prenom": "Prénom",
  "titre_poste": "Chef de Projet / Expert DevOps",
  "annees_experience": "18 ans d'expérience",
  "competences": [
    {{"categorie": "Langages & Frameworks", "items": ["Java J2EE", "Spring", "JSF 2.0", "Python", "SQL"]}},
    {{"categorie": "Outils & DevOps", "items": ["Jenkins", "Docker", "Kubernetes", "Git", "Maven", "Ansible"]}},
    {{"categorie": "Bases de données", "items": ["Oracle", "DB2", "SQL Server", "PL/SQL"]}},
    {{"categorie": "Cloud & Infrastructure", "items": ["Azure", "AWS", "Linux", "Terraform"]}},
    {{"categorie": "Méthodes", "items": ["Agile/Scrum", "DevOps", "PRINCE2", "Cycle en V"]}},
    {{"categorie": "Secteurs", "items": ["Finance", "Assurance", "Énergie", "Santé"]}}
  ],
  "experiences": [
    {{
      "titre_projet": "Refonte espace client GMF",
      "entreprise": "GMF Assurances",
      "dates": "08/2012 à 08/2013",
      "duree": "(12 mois)",
      "secteur": "Assurance",
      "poste": "Architecte, Référent technique",
      "sous_missions": [
        {{
          "titre": "Réalisations",
          "bullets": [
            "Refonte de l'espace sociétaire sur gmf.fr",
            "Développement d'IHMs JSF 2.0 offrant de nouveaux services",
            "Expertise JSF 2.0 et correction d'anomalies"
          ]
        }}
      ],
      "outils": "Java J2EE, JSF 2.0, PrimeFaces, Maven, Eclipse, DB2"
    }},
    {{
      "titre_projet": "Projet DevOps CI/CD HSBC",
      "entreprise": "HSBC Paris",
      "dates": "05/2015 à 04/2017",
      "duree": "(21 mois)",
      "secteur": "Finance",
      "poste": "Expert DevOps",
      "sous_missions": [
        {{
          "titre": "Réalisations",
          "groupes": [
            {{
              "titre": "Intégration continue",
              "items": [
                "Mise en place du serveur Jenkins",
                "Automatisation des tests unitaires et d'intégration",
                "Analyse automatisée de la qualité du code"
              ]
            }},
            {{
              "titre": "Déploiement automatisé",
              "items": [
                "Mise en place d'environnements de tests avec Docker",
                "Déploiements automatisés en SIT et UAT"
              ]
            }}
          ]
        }}
      ],
      "outils": "Jenkins, Maven, SONAR, Docker, Linux, Puppet, Ansible, AWS"
    }}
  ],
  "formations": [
    {{"label": "Formation", "texte": "Diplôme d'ingénieur – École Centrale Paris", "annee": "2006"}}
  ],
  "langues": [
    {{"langue": "Anglais", "niveau": "Courant"}},
    {{"langue": "Français", "niveau": "Langue maternelle"}}
  ],
  "certifications": [
    "AWS Certified Solutions Architect – Associate",
    "PRINCE2 Foundation Certificate in Project Management"
  ]
}}

═══════════════════════════════════════════════════════
CV À ANALYSER :
═══════════════════════════════════════════════════════
{cv_text}"""


def extract(cv_text: str, ollama_url: str = 'http://127.0.0.1:11434',
            model: str = 'llama3.2', timeout: int = 180) -> dict | None:
    """
    Envoie cv_text à Ollama pour extraction structurée.
    Retourne un dict ou None si échec.
    """
    cv_truncated = _smart_truncate(cv_text, 10000)

    prompt = _PROMPT_TEMPLATE.format(cv_text=cv_truncated)

    payload = json.dumps({
        'model':  model,
        'prompt': prompt,
        'stream': False,
        'options': {
            'temperature': 0.05,
            'num_predict': 4096,
            'num_ctx':     8192,
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

    return _parse_json_response(response_text)


def _smart_truncate(text: str, max_chars: int) -> str:
    """Tronque le CV en conservant le début (identité + compétences) et les premières missions."""
    if len(text) <= max_chars:
        return text

    # Couper sur un saut de ligne propre
    cut = text[:max_chars]
    last_nl = cut.rfind('\n', max_chars - 500, max_chars)
    if last_nl > max_chars - 500:
        cut = cut[:last_nl]

    return cut + '\n\n[... CV tronqué – analyse basée sur les premières sections ...]'


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
    in_string = False
    escape_next = False
    for i, ch in enumerate(text[start:], start):
        if escape_next:
            escape_next = False
            continue
        if ch == '\\' and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    json_str = text[start:end] if end != -1 else text[start:]

    try:
        data = json.loads(json_str)
    except json.JSONDecodeError:
        # Tentative de réparation : trailing commas
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

    # ── Compétences ──────────────────────────────────────────────────────
    competences = []
    for cat in _list(data.get('competences')):
        if isinstance(cat, dict):
            categorie = _str(cat.get('categorie') or cat.get('category', ''))
            items     = [_str(x) for x in _list(cat.get('items')) if x and str(x).strip()]
            if categorie and items:
                competences.append({'categorie': categorie, 'items': items[:10]})

    # ── Expériences ───────────────────────────────────────────────────────
    experiences = []
    for exp in _list(data.get('experiences')):
        if not isinstance(exp, dict):
            continue

        # Normaliser les sous_missions (avec support groupes)
        sous = []
        for sm in _list(exp.get('sous_missions')):
            if not isinstance(sm, dict):
                continue

            bullets  = [_str(b) for b in _list(sm.get('bullets')) if b and str(b).strip()]
            groupes  = []
            for g in _list(sm.get('groupes')):
                if isinstance(g, dict):
                    g_items = [_str(x) for x in _list(g.get('items')) if x and str(x).strip()]
                    if g_items:
                        groupes.append({
                            'titre': _str(g.get('titre', '')),
                            'items': g_items,
                        })

            sm_entry = {
                'titre':   _str(sm.get('titre', 'Réalisations')),
                'bullets': bullets,
            }
            if groupes:
                sm_entry['groupes'] = groupes

            if bullets or groupes:
                sous.append(sm_entry)

        if not sous:
            sous = [{'titre': 'Réalisations', 'bullets': []}]

        experiences.append({
            'titre_projet':  _str(exp.get('titre_projet')),
            'entreprise':    _str(exp.get('entreprise')),
            'dates':         _str(exp.get('dates')),
            'duree':         _str(exp.get('duree')),
            'secteur':       _str(exp.get('secteur')),
            'poste':         _str(exp.get('poste')),
            'sous_missions': sous,
            'outils':        _str(exp.get('outils')),
        })

    # ── Formations ────────────────────────────────────────────────────────
    formations = []
    for f in _list(data.get('formations')):
        if isinstance(f, dict):
            formations.append({
                'label': _str(f.get('label', 'Formation')),
                'texte': _str(f.get('texte')),
                'annee': _str(f.get('annee')),
            })

    # ── Langues ───────────────────────────────────────────────────────────
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
