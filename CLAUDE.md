# ProspUp — CRM Prospection B2B (Up Technologies)

## Stack technique
- **Backend** : Flask (app.py ~7000 lignes), SQLite, Waitress WSGI en prod
- **Frontend** : Vanilla JS (pas de framework), 20 pages HTML standalone
- **CSS** : Glassmorphism dark theme, `prefers-color-scheme` pour light mode
- **PWA** : Service Worker (sw.js), manifest.json, offline.html
- **Hebergement** : Cloudflare Tunnel → prospup.work, port 8000
- **Tests E2E** : Playwright (Chromium), 38 tests (desktop + mobile Pixel 5)

## Architecture fichiers
```
app.py                  # Backend Flask — routes, API, auth, DB
static/
  css/style.css         # ~7200 lignes, tout le style
  js/app.js             # ~7200 lignes, logique globale (showToast, fetch wrappers…)
  js/page-*.js          # Un fichier JS par page (page-dashboard.js, page-focus.js…)
  js/v8-features.js     # Features transversales (SW registration, bottom nav, haptic, error states)
  js/metiers-data.js    # Donnees metiers statiques
  js/notifications.js   # Push notifications
  sw.js                 # Service Worker (cache shell + API runtime cache)
  manifest.json         # PWA manifest (shortcuts, share_target, maskable icon)
*.html                  # 20 pages (index, dashboard, focus, login, entreprises…)
offline.html            # Fallback hors-ligne
tests/e2e/              # Tests Playwright
  auth.setup.js         # Auth session persistee
  *.spec.js             # login, dashboard, prospects, focus, navigation, mobile, pwa
minify.py               # Script de minification CSS/JS (rjsmin, csscompressor)
playwright.config.js    # Config Playwright (2 projets: desktop-chrome, mobile-pixel5)
```

## Auth
- Session cookie Flask (`session['user_id']`)
- `@app.before_request` protege toutes les routes sauf /login, /static, /api/auth/
- Login via POST `/api/auth/login` avec `{username, password}` JSON
- Roles : **admin** (accès total) et **editor** (lecture + modification) uniquement
- Multi-tenant : `owner_id` sur chaque enregistrement ; DB isolée par user dans `data/user_<id>/prospects.db` si elle existe

## Conventions
- `APP_VERSION` dans app.py (actuellement "25.0") — incrementer a chaque release
- Cache busters automatiques : app.py calcule les hash MD5 des fichiers statiques au demarrage et remplace `?v=XXXX` dans le HTML
- Pas de bundler/build system — fichiers servis directement par Flask
- Scripts avec `defer` sur toutes les pages (sauf Chart.js CDN dans stats.html)
- Service Worker : network-first pour HTML/API, cache-first pour static assets
- Toast notifications via `window.showToast(msg, type, duration)` dans app.js
- Haptic feedback via `window.haptic(ms)` dans v8-features.js

## Ollama (IA locale)
- Tous les flux IA passent par **Ollama** sur le PC (proxy backend) : le navigateur appelle Flask, Flask appelle `http://127.0.0.1:11434`. Aucun appel direct du front à Ollama (compatible « Expose Ollama to the network » désactivé).
- Variables d'environnement : `OLLAMA_URL` (défaut `http://127.0.0.1:11434`), `OLLAMA_MODEL` (défaut `llama3.2`), `OLLAMA_TIMEOUT` (secondes, défaut 120).
- Route backend : `POST /api/ollama/generate` avec `{ "prompt": "..." }` ; renvoie `{ "ok": true, "text": "..." }`. Helper front : `callOllama(prompt)` dans app.js.

### Entrées IA implémentées (boutons / flux)
| Où | Bouton / action | Comportement |
|----|-----------------|--------------|
| Page Prospects (ligne) | « Scrapping IA » | Un clic : envoie le prompt enrichissement prospect à Ollama, ouvre la modale avec le texte généré, analyse (Accepter / Ignorer) puis applique. Fallback : modale vide pour collage manuel si Ollama indisponible. |
| Fiche entreprise (index) | « Scrapping IA » | Même principe pour une entreprise (prompt + modale import). |
| Page Candidats (fiche) | « Scrapping IA » | Même principe pour un candidat (page-candidate.js + app.js). |
| Page Prospects (ligne) | « Après réunion IA » | Un clic : prompt compte-rendu RDV → Ollama → modale avec JSON, analyse puis applique. |
| Page Prospects (barre d’actions) | « Email IA » / « Tel IA » | Ouvre la modale bulk ; bouton « Générer avec Ollama » remplit la zone résultat et lance l’analyse (email ou téléphone en masse). |
| Page Prospects | « Ajout IA » | Modale Quick Add : choix type (Prospect / Entreprise / Candidat), puis « Générer avec Ollama (un seul) » ou « (plusieurs) » ; résultat pré-rempli, analyse puis création. Boutons « Copier » en secours. |
| Import liste (étape mapping) | « Suggérer le mapping avec Ollama » | Envoie les en-têtes Excel à Ollama, reçoit un JSON header→champ, pré-remplit les listes déroulantes de mapping. |
| Import liste (étape aperçu) | « Reformater [champ] » | Modale avec prompt de normalisation ; bouton « Générer avec Ollama » remplit la zone résultat (une valeur par ligne). |

### Import Excel (nouvel utilisateur)
- Champs mappables : Nom, Prénom (combiné en « Prénom Nom »), Entreprise, Site, Fonction, Téléphone (plusieurs colonnes fusionnées, ex. TEL + PORTABLE), Email, LinkedIn, Notes, Tags, Pertinence, Statut, Date dernier contact.
- Détection auto des colonnes : `_guessMapping` dans app.js (NOM, PRENOM, GROUPE, SITE, TEL, PORTABLE, FONCTION, MAIL, COMMENTAIRE, LINKEDIN, ACTION, DATE DERNIER CONTACT, etc.).
- Fixture de test : `tests/fixtures/fichier_prosp_test_user.xlsx`. Plan de test manuel et E2E : `docs/PLAN_TEST_IMPORT_EXCEL.md`. Prompt de test complet (simulation nouvel utilisateur + IA) : `docs/PROMPT_TEST_NOUVEL_UTILISATEUR.md`.

## Commandes utiles
```bash
python app.py                    # Dev server (port 8000, debug=True)
python app.py --prod             # Prod avec Waitress
npx playwright test              # Lancer les 38 tests E2E
npx playwright test --headed     # Tests avec navigateur visible
python minify.py                 # Minifier CSS/JS
python scripts/watch-prospup.py  # Une vérification puis sortie
python scripts/watch-prospup.py --loop   # Surveillance toutes les 15 min, relance si down
```
- **Surveillance ProspUp** : `scripts/watch-prospup.py` vérifie que l’app répond (GET sur l’URL configurée). Si échec (timeout 10 s ou status ≠ 200), lance la commande de relance. Variables d’environnement : `PROSPUP_WATCH_URL` (défaut https://prospup.work), `PROSPUP_WATCH_CMD` (défaut `python app.py --prod`), `PROSPUP_WATCH_DIR` (répertoire de travail), `PROSPUP_WATCH_INTERVAL` (900), `PROSPUP_WATCH_TIMEOUT` (10). Sous Windows : tâche planifiée toutes les 15 min ou exécuter en arrière-plan avec `--loop`.

## Tracabilité — Correctif utilisateurs et DB (mars 2025)
- **Problème** : les DB per-user (`data/user_<id>/prospects.db`) étaient créées sans la colonne `deleted_at` (soft delete v23.5), ce qui provoquait `sqlite3.OperationalError: no such column: deleted_at` au chargement des données. La suppression d’un utilisateur échouait parfois (fichier verrouillé).
- **Modifications** :
  - **app.py** : `_init_user_db()` crée désormais les tables `companies`, `prospects`, `candidates` avec `deleted_at TEXT`. Ajout de `_migrate_user_db_schema(db_path)` qui ajoute `deleted_at` à ces tables si absent, et de `_migrate_all_user_dbs()` qui applique cette migration à toutes les DB dans `data/user_*/prospects.db` et supprime les dossiers orphelins (user_X dont l’id n’existe plus dans la table `users`). `_migrate_all_user_dbs()` est appelée au démarrage après `init_db()`.
  - **Rôles** : simplification à deux rôles uniquement — admin et editor. Suppression du rôle reader dans `ROLE_LEVELS`, dans les vérifications JWT/session et dans l’UI. Valeur par défaut à la création d’un utilisateur : `editor`. Migration au démarrage : `UPDATE users SET role='editor' WHERE role='reader'`.
  - **users.html** : liste des rôles limitée à Admin et Éditeur ; défaut « editor » dans le formulaire ; `ROLE_LABELS` / `ROLE_COLORS` sans reader.
- **Résultat** : les données par utilisateur s’affichent correctement ; la suppression d’un utilisateur supprime d’abord l’entrée dans `users`, et au prochain redémarrage les dossiers orphelins sont nettoyés si le `rmtree` avait échoué (fichier verrouillé).

## Audit multi-utilisateurs
- Script : `python -m tests.audit_multi_user` (à lancer avec `PYTHONIOENCODING=utf-8`).
- Rapports : `tests/audit_reports/audit_multi_user_*.json`.
- **Correctif save partiel** : dans `upsert_all`, PRAGMA foreign_keys = OFF pendant la transaction + suppression des prospects référençant les companies à supprimer avant les autres deletes ; réactivation des FK en finally.
- **Problème connu** : dossiers `data/user_X` orphelins sous Windows si DB encore ouverte ; nettoyés au redémarrage.

## Audits sécurité et UI
- **Sécurité** : `docs/AUDIT_SECURITE.md` — correctifs XSS sidebar, erreurs 500 génériques en prod, path traversal pushs, recommandations (CORS, rate limit, CSP).
- **UI / navigation** : `docs/AUDIT_UI_NAVIGATION.md` — lien Aide unifié (/help), boutons modales sourcing (modal-close), cohérence sidebar/bottom nav.

## Points d'attention
- Le dossier est sur OneDrive — les chemins contiennent des espaces, toujours quoter
- Python sur ce PC : Python 3.14, encodage console cp1252 → utiliser PYTHONIOENCODING=utf-8 pour Playwright
- Les identifiants de test par defaut sont admin/admin (configurable via PROSPUP_USER/PROSPUP_PASS)
- Ne jamais ajouter `cache: 'no-store'` aux fetch — le SW et les headers Cache-Control gerent le cache
