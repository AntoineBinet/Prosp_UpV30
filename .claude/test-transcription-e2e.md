# Mission : Faire fonctionner l'outil de transcription de réunions ProspUp

> Ce fichier est un brief autonome pour une session **Claude Code locale** lancée
> sur le PC hébergeur. Quand tu lis ce fichier, exécute le plan ci-dessous sans
> demander confirmation à l'utilisateur entre chaque étape — avance, debug,
> recommence, jusqu'à un workflow E2E fonctionnel.

Tu tournes sur le PC hébergeur (Windows, Python 3.13, RTX 3060 Laptop 6 GB VRAM,
torch 2.11.0+cu128, GPU CUDA actif). Tu peux modifier le code, redémarrer Flask,
ouvrir le navigateur sur prospup.work ou http://127.0.0.1:8000, lire les logs.
Branche cible : `main`. Vérifie d'abord avec `git log --oneline main -5` que tu
as au moins le commit v32.9 « workflow copy-paste IA externe ». Sinon `git pull
origin main`.

## Mission

L'outil de transcription est codé (versions 32.1 → 32.9) mais **jamais validé en
E2E visuellement après les fix v32.8/9**. Tu testes, tu corriges les bugs au fur
et à mesure, tu pousses sur main quand tout marche.

## Contrainte économique CRITIQUE

L'utilisateur n'a **pas de crédits API Anthropic** (forfait Claude.ai Max 5×
qui ne couvre pas l'API). Donc :
- ❌ Le bouton « Re-analyser (Claude API) » DOIT retourner « Crédits épuisés ».
  C'est attendu, ne le considère pas comme un bug.
- ✅ Tester le workflow **copy-paste depuis claude.ai web** (modal « Analyser
  via IA externe »).
- ✅ Tester aussi Ollama local en fallback (llama3.2:3B installé, qwen2.5:7b
  serait mieux — `ollama pull qwen2.5:7b` si non installé).

## État au démarrage

### Devrait fonctionner (vérifier)
- Whisper a déjà transcrit une réunion 1h03 (`Ec1 Alex Drouet`, transcription
  id=1 en DB). Status=done, transcript_text rempli.
- Pre-flight HF dans Paramètres retourne OK (user `Toniolasticot`).
- GPU CUDA visible dans Paramètres → État GPU.
- Token HF dans `data/ai_config.json` : `hf_bQYmy...`.

### Jamais testé E2E (à valider/corriger)
1. **Diarisation pyannote** : sur la transcription existante = un seul
   « Speaker 1 » (= échec silencieux). Fix HF login forcé v32.8 dans
   `services/transcription.py:_load_diarization`. À retester en cliquant
   « Relancer pipeline » sur la fiche existante.
2. **Modal upload pre-flight** v32.8 (`GET /api/transcription/preflight`).
   Doit afficher Claude/HF/GPU avec icônes ✓/⚠/✗ avant lancement.
3. **Modal « Analyser via IA externe »** v32.9 — 3 étapes copy-paste.
   Endpoints : `GET /external-prompt` + `POST /external-analysis`.
4. **Boutons « Re-analyser », « Relancer pipeline », « Analyser via IA
   externe »** : visibilité conditionnelle (cf. v32.4-9) — vérifier qu'ils
   apparaissent bien sur status=done.
5. **Ollama 2 passes** v32.9 : chunking pour transcripts > 12k chars.

## Stack

- Backend : `app.py` (~22k lignes), `routes/transcription.py`, `routes/ai.py`,
  `services/transcription.py`.
- DB : SQLite, table `transcriptions`.
- Frontend v30 : `templates/v30/transcription{,_detail}.html`,
  `static/js/v30/transcription{,_detail}.js`,
  `static/css/v30/transcription.css`.
- Config IA : `data/ai_config.json` (gitignored).
- Logs : `logs/prospup.log`.
- Audio uploadé : `data/audio_uploads/user_<id>/`.
- Lancer : `python app.py` (dev) ou `python app.py --prod` (Waitress).

## Plan de test E2E (suis-le dans l'ordre)

### 1. État initial
- `git pull origin main && python app.py --prod`
- Connexion admin/admin sur http://127.0.0.1:8000.
- Paramètres → Configuration IA → vérifier que les valeurs sont conformes,
  noter le badge GPU.
- Sidebar → Transcription → la liste contient au moins Ec1 Alex Drouet.

### 2. Pré-flight modal upload
- Clique « Nouveau fichier audio ». Modal s'ouvre.
- **Attendu** : panneau « Vérification… » avec :
  - Claude API ✗ Crédits épuisés
  - HuggingFace ✓ Accès validé
  - GPU CUDA ✓ avec nom et VRAM
- Bouton « Lancer la transcription » désactivé.
- Boutons « Recharger crédits Claude » + « Ouvrir Paramètres IA » visibles.
- **Si KO** : debug `runPreflight` / `updatePreflightUI` dans
  `static/js/v30/transcription.js` et endpoint `api_preflight` dans
  `routes/transcription.py`.

### 3. Diarisation pyannote
- Sur la fiche détail Ec1 Alex Drouet, clique « Relancer pipeline ».
- Toast « Lancement… » immédiat. Stage progresse jusqu'à « Diarisation… ».
- **Si pyannote 401 reproduit** :
  - `tail -100 logs/prospup.log` après le crash.
  - Test manuel hors Flask (script Python ci-dessous) pour isoler le bug.
  - Probable cause : cache `~/.cache/huggingface/token` contient un autre
    token. Solutions :
    a) `huggingface-cli logout` puis `huggingface-cli login` avec le bon.
    b) Supprimer le cache : `rm ~/.cache/huggingface/token`
       (Windows : `%USERPROFILE%\.cache\huggingface\token`).
  - Test manuel :
    ```python
    import os
    os.environ['HF_TOKEN'] = 'hf_bQYmy...'  # token réel depuis ai_config.json
    from huggingface_hub import login
    login(token='hf_bQYmy...', add_to_git_credential=False)
    from pyannote.audio import Pipeline
    p = Pipeline.from_pretrained('pyannote/speaker-diarization-3.1',
                                  token='hf_bQYmy...')
    print('OK', p)
    ```
  - Si ce script marche en standalone mais pas dans Flask : variable d'env
    héritée de la session shell qui lance Flask, ou ordre d'import. Forcer
    le `os.environ` côté `app.py` au démarrage si besoin.
- **Critère succès** : transcript avec plusieurs speakers (Speaker_00,
  Speaker_01) colorés distinctement.

### 4. Workflow copy-paste claude.ai (priorité user)
- Fiche détail → bouton « Analyser via IA externe (copy-paste) ».
- **Étape 1** : « Copier dans le presse-papier ». Toast confirme.
  Coller dans un éditeur texte → vérifier prompt système (4-5 KB) +
  transcript (50-100 KB).
- **Étape 2** : ouvrir claude.ai/new (lien dans modal). L'utilisateur DOIT
  être connecté avec son compte Max 5×. Coller, attendre ~30s la réponse.
  NOTE : sur PC hébergeur tu n'as peut-être pas la session connectée.
  Si tu ne peux pas tester l'étape 2 toi-même, simule en collant à la
  place une réponse JSON de test à l'étape 3 (exemple ci-dessous).
- **Étape 3** : coller la réponse dans le textarea, sélectionner la source,
  cliquer « Appliquer l'analyse ». Fiche recharge, badge violet « ✦ Collé »,
  CR markdown rendu.
- **Réponse JSON de test** (à coller pour valider le parser) :
  ```json
  {
    "title": "Test E2E — entretien Alex Drouet",
    "synthesis": "Test de bout en bout du workflow copy-paste.",
    "narrative_markdown": "# Test E2E\n\n## Synthèse\nCeci est un test pour valider le parser et le rendu.\n\n## Section 1\nParagraphe avec **gras** et *italique*.\n\n- bullet 1\n- bullet 2\n\n## Prochaines étapes\n- Action 1\n- Action 2",
    "participants": [],
    "topics": ["test"],
    "decisions": [],
    "action_items": [],
    "next_steps": ["Action 1"],
    "sentiment": "neutre",
    "quality_score": 80,
    "key_quotes": []
  }
  ```
- **Critère succès** : fiche détail recharge avec le markdown rendu,
  badge violet, transcript toujours visible.
- **Tester aussi parser tolérant** : recommencer avec la même JSON wrappée
  dans ` ```json ... ``` ` et avec du markdown brut (sans wrapper JSON) →
  doit aussi être accepté (markdown brut → emballé dans `narrative_markdown`).

### 5. Ollama 2 passes (bonus si temps)
- Paramètres → Configuration IA → cocher « Fallback Ollama si Claude
  indisponible » → Enregistrer.
- Optionnel : `ollama pull qwen2.5:7b`, puis dans la même page changer
  « Modèle Ollama » de `llama3.2` à `qwen2.5:7b`.
- Sur la fiche → « Re-analyser (Claude API) » → Claude KO → fallback
  Ollama → log devrait montrer « Ollama analyse en 2 passes (transcript
  X chars) » dans `logs/prospup.log`.
- Critère succès : CR Ollama lisible (pas d'hallucinations massives type
  « Fouman »). Avec qwen2.5:7b, attendu acceptable. Avec llama3.2:3B,
  toujours faible (documenté).

## Bugs probables à anticiper

D'après l'historique :
- **CSS modal v30** : `.v30-modal-bd` a `opacity:0` par défaut, il FAUT ajouter
  la classe `.is-open` après reflow (pas juste `hidden=false`).
- **DOMContentLoaded race** avec `<script defer>` : utiliser le pattern
  `if (document.readyState === 'loading') { ... } else { init(); }`.
- **Drag & drop** : `input.files = dt2.files` échoue silencieusement sur Edge.
  La feature est censée stocker le fichier dans une closure JS plutôt
  que de relire l'input — vérifier que c'est bien le cas dans
  `transcription.js:currentFile`.

## Critères de succès finaux

Avant de pousser, valide ces points :
1. ✅ Pre-flight modal s'affiche avec statuts cohérents.
2. ✅ « Relancer pipeline » sur Ec1 → diarisation produit ≥ 2 speakers.
3. ✅ « Analyser via IA externe » → copy/paste/apply produit un CR rendu
   avec badge violet.
4. ✅ Le bouton « Re-analyser (Claude API) » retourne une erreur claire
   « Crédits épuisés » avec lien Recharger (comportement ATTENDU).
5. ✅ Aucune erreur JavaScript dans la console du navigateur sur les
   pages /v30/transcription et /v30/transcription/<id>.

## Workflow Git

Conventions ProspUp (cf. CLAUDE.md) :
- Travail direct sur `main`, jamais de branche feature.
- Petits commits descriptifs au fil des fix.
- À chaque fix significatif : `git add -A && git commit -m "fix(transcription):
  <description>" && git push origin main`.
- Bump APP_VERSION dans app.py (ligne 38) à chaque release significative
  (32.10, 32.11, …).
- Mise à jour CHANGELOG.md.

## Quand tu rends la main

Récap final à l'utilisateur en quelques phrases :
- Ce qui a été corrigé concrètement (bugs trouvés + fix).
- Ce qui marche maintenant en E2E (avec les commits référencés).
- Ce qui reste comme limite connue (ex. Ollama 3B faible — recommander
  qwen2.5:7b ; Claude API attend des crédits).
- Procédure pour le user : 1) déployer via « Mettre à jour et redémarrer »,
  2) tester le copy-paste sur sa session claude.ai Max 5×.
