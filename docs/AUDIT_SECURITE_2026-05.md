# Audit cybersécurité approfondi — Prosp'Up v32.x

> **Date** : 19 mai 2026
> **Périmètre** : application Flask `prospup.work` (PC personnel + Cloudflare Tunnel)
> **Méthode** : revue de code statique des modules `app.py` (8 928 lignes), `routes/*.py`, `utils/*.py`, `services/*.py`, `scripts/*.py`, `templates/v30/*.html`, `static/js/v30/*.js`, `404.html`, `.gitignore`, et historique git.
> **Auditeur** : 5 agents d'exploration spécialisés (auth, déploiement, multi-tenant, secrets, OWASP).
> **But** : identifier les failles ; les corrections font l'objet d'une seconde phase.

---

## TL;DR — verdict global

L'app est **globalement bien structurée** pour une app artisanale : hash de mot de passe robuste (PBKDF2 600k itérations), cookies sécurisés, isolation multi-tenant solide, headers de sécurité présents, secrets pas hardcodés dans le code Python.

**Mais** la surface d'attaque la plus dangereuse est exactement celle que tu redoutais : la **chaîne de déploiement Git**. Trois endpoints publics (`/api/deploy/pull-from-404`, `/api/deploy/rollback`, plus les boutons dans `404.html`) permettent à n'importe qui visitant une page 404 de déclencher un `git pull` puis un redémarrage. Combiné à l'absence de vérification GPG sur les commits, **un compromis du compte GitHub = code arbitraire exécuté sur ton PC en moins d'une minute**.

**Bilan chiffré** : 1 fuite git critique (credentials Cloudflare), 4 failles critiques d'exécution distante, 6 failles élevées (auth, IDOR, SSRF, CORS, mdp défaut, etc.), 12+ failles moyennes/faibles.

---

## 1. Réponses à tes inquiétudes précises

### 1.1 « GitHub est une faille pour faire les MAJ »
✅ **Tu as raison.** Le vecteur que tu as utilisé (déclencher un redémarrage à distance) est **encore plus large que ce que tu pensais** :

| Vecteur | Status actuel | Difficulté d'exploitation |
|---|---|---|
| Page 404 avec bouton « MAJ + Redémarrage » | Public, aucune auth | 1 clic depuis n'importe quel navigateur |
| `POST /api/deploy/pull-from-404` | Public (seule protection : header `Origin`) | `curl` sans `Origin` = bypass |
| `POST /api/deploy/rollback` | Public, idem | Idem |
| `git pull --ff-only` | Pas de vérif signature GPG | Si GitHub compromis → code exécuté au reboot |
| `subprocess` avec `shell=True` dans le superviseur | Variables d'env non sanitizées | Si quelqu'un set `PROSPUP_APP_CMD="malware.exe"` |

**Scénario réaliste 60 secondes :**
1. Attaquant phishe ton mot de passe GitHub.
2. Pousse un commit innocent qui ajoute un import malveillant dans `app.py` (ou modifie `requirements.txt`).
3. Envoie un lien `https://prospup.work/anything-404` à toi (ou à n'importe quel user).
4. Le user clique sur « MAJ + Redémarrage ».
5. Code exécuté sur ton PC.

Pire : il **n'a même pas besoin de te phisher** pour ouvrir le lien — il peut juste `curl -X POST` directement.

### 1.2 « Encryption end-to-end »
❌ **Pas possible dans l'architecture actuelle**, et **probablement pas pertinent** pour ton cas :
- E2E ne fait sens que si le serveur **ne doit pas pouvoir lire les données** (ex. Signal, ProtonMail). Ici ton serveur **doit** lire pour faire des requêtes SQL, des stats, du scrapping IA, des exports DOCX.
- Ce qui est *réalisable et utile* : **chiffrement at-rest** (SQLite chiffrée, backups GPG) et **chiffrement en transit** (déjà fait via Cloudflare TLS).
- État actuel :
  - 🟢 Transit : OK via Cloudflare Tunnel (TLS 1.3).
  - 🟠 At-rest : **DB non chiffrée**, backups `.gz` **non chiffrés**, fichiers générés (PDF, DOCX) **non chiffrés**, `data/ai_config.json` (clés API) **non chiffré**.

### 1.3 « Respect des datas des différents users »
🟢 **Bonne nouvelle** : l'isolation multi-tenant est **solidement implémentée**. Les helpers `_prospect_owned()`, `_candidate_owned()`, `_company_owned()` sont systématiquement appelés. ~95 % des routes vérifient `owner_id`.

🟠 **Une seule fuite confirmée** : `GET /api/auth/avatar/<int:user_id>` ne vérifie pas l'identité du demandeur — n'importe quel user authentifié peut récupérer la photo de profil d'un autre user (sévérité limitée mais c'est un IDOR de manuel).

### 1.4 « Faille de hack facile à la page de connexion »
- 🔴 **Mot de passe par défaut `admin/admin`** affiché en clair dans la console au premier lancement (`app.py:1632`). Si l'app est exposée avant que tu changes le mdp → game over.
- 🟠 **Rate-limit faible** : 5 tentatives / 5 min par IP, **stocké en RAM** (perdu au restart), pas de lockout au niveau du compte, pas de CAPTCHA, pas de backoff exponentiel. Un attaquant patient testant 5 mdp / 5 min depuis 10 IP = 600 tentatives / heure.
- 🟠 **Pas de MFA**.
- 🟠 **Pas de reset password sécurisé** (lien `mailto:` uniquement).
- 🟢 Hash PBKDF2-SHA256 600 000 itérations (Werkzeug) avec salt auto — **conforme état de l'art**.
- 🟢 Timing-safe check (dummy hash sur user inexistant) — **bon**.

---

## 2. Failles classées par sévérité

### 🔴 CRITIQUE (à corriger en priorité)

#### C1 — `/api/deploy/pull-from-404` exécute du code arbitraire sans auth
- **Fichier** : `routes/deploy.py:55-148`
- **Détail** : route publique (whitelistée dans `app.py:305-308`), seule protection = `_require_same_origin()`. Exécute `git pull --ff-only origin main` puis schedule un restart.
- **Exploit** : `curl -X POST https://prospup.work/api/deploy/pull-from-404` (sans header `Origin` → la fonction `_require_same_origin` retourne `None` = pass, cf. `utils/auth.py:142`).
- **Impact** : exécution de code arbitraire au redémarrage si GitHub compromis.

#### C2 — `/api/deploy/rollback` même problème
- **Fichier** : `routes/deploy.py:151-228`
- **Détail** : public, lit `.last_commit_hash`, fait `git reset --hard <hash>`. Si un attaquant peut modifier `.last_commit_hash` (via une autre faille file-write), il peut pointer vers n'importe quel commit.

#### C3 — Boutons « MAJ + Redémarrage » et « Rollback » exposés dans `404.html`
- **Fichier** : `404.html`
- **Détail** : la page 404 (atteignable par n'importe quelle URL invalide, sans auth) contient deux boutons HTML qui appellent C1 et C2. Combiné avec C1/C2 = exploitation triviale via phishing.

#### C4 — Fuite git : `cloudflare-config.yml` versionné depuis le commit `09534f6` (mai 2026)
- **Fichier** : `cloudflare-config.yml:2`
- **Détail** : contient l'UUID du tunnel Cloudflare (`73a32dfa-e4e2-4bf1-a345-b811cd2a9666`) et le chemin local du fichier de credentials. Si le repo est public (ou devient public, ou est forké), la fuite est permanente dans l'historique.
- **Impact** : informations sur l'infra, identifiant de tunnel exploitable si le fichier `.json` Cloudflare fuit par ailleurs.
- **Action requise** : révoquer le tunnel + en créer un nouveau + `git filter-repo` pour purger l'historique + ajouter à `.gitignore`.

### 🟠 ÉLEVÉE

#### E1 — Mot de passe admin par défaut `admin/admin`
- **Fichier** : `app.py:1632`
- **Détail** : créé automatiquement si la table `users` est vide. Print en console : « Compte admin cree — login: admin / mdp: admin (a changer !) ».
- **Risque** : si l'app est exposée publiquement avant que tu te connectes pour changer → compromis instantané.
- **Fix proposé** : générer un mdp aléatoire au premier lancement, l'écrire dans un fichier local `.initial_admin_password` (chmod 600), forcer changement au premier login via le flag `must_change_password` déjà existant.

#### E2 — Pas de vérification GPG sur `git pull`
- **Fichier** : `routes/deploy.py` (toutes les routes deploy)
- **Détail** : `git pull --ff-only` accepte n'importe quel commit signé ou non. Aucun `git verify-commit`.
- **Risque** : compromis GitHub (token, mot de passe, session) = injection de code arbitraire.
- **Fix proposé** : signer tes commits avec GPG (`git commit -S`), config `commit.gpgsign = true`, et en post-pull faire `git verify-commit HEAD` qui échoue si non signé par ta clé connue.

#### E3 — `_require_same_origin()` bypassable
- **Fichier** : `utils/auth.py:139-152`
- **Détail** :
  ```python
  origin = (request.headers.get("Origin") or "").strip().rstrip("/")
  if not origin:
      return None  # ← BYPASS si pas de header Origin
  ```
  `curl`, scripts Python, fetch en mode `no-cors`, applications natives → pas de header `Origin` → la protection ne s'applique pas.
- **Risque** : amplifie C1, C2 et toutes les autres routes mutating qui s'appuient là-dessus comme CSRF.
- **Fix proposé** : si la route est sensible, exiger un Origin **présent et valide**. Ne pas retourner `None` quand absent.

#### E4 — IDOR sur `/api/auth/avatar/<int:user_id>`
- **Fichier** : `routes/auth.py:169-178`
- **Détail** : `@login_required` mais pas de check que `user_id == _uid()`. N'importe quel user authentifié récupère les avatars d'autres users.
- **Fix** : ajouter `if user_id != _uid(): return 403`.

#### E5 — CORS `Access-Control-Allow-Origin: *` quand Bearer JWT
- **Fichier** : `app.py:266`
- **Détail** : pour faciliter l'app mobile, le serveur renvoie `Allow-Origin: *` dès qu'un header `Authorization: Bearer ...` est présent. Combiné avec un JWT volé (XSS sur n'importe quel site), un attaquant peut faire des requêtes cross-origin et lire les réponses.
- **Fix** : whitelister un domaine spécifique pour l'app mobile (capacitor app id, custom scheme) au lieu de `*`.

#### E6 — SSRF sur `/api/calendar/ics-from-url`
- **Fichier** : `routes/calendar.py:408-412`
- **Détail** : prend une URL utilisateur, fait `urllib.request.urlopen(url, timeout=15)`. Aucun filtre sur les IP privées.
- **Exploit** : `GET /api/calendar/ics-from-url?url=http://127.0.0.1:11434/api/tags` → lit la liste des modèles Ollama. `?url=http://localhost:8000/api/users` (si quelqu'un fait tourner un autre service local). `?url=http://169.254.169.254/` sur cloud (metadata AWS/GCP).
- **Fix** : whitelister les domaines `https://calendar.google.com`, `https://outlook.office.com`, etc. OU faire une résolution DNS + check que l'IP n'est pas privée/loopback/link-local.

#### E7 — `shell=True` avec variables d'env non sanitizées dans le superviseur
- **Fichiers** : `scripts/supervise_prospup.py:162-171`, `scripts/auto_sync_pc.py:76-90`, `scripts/watch-prospup.py:200-217`
- **Détail** : `subprocess.Popen(app_cmd, shell=True)` où `app_cmd = os.environ["PROSPUP_APP_CMD"]`. Si un attaquant a un foothold local (ex. un autre programme sur ta machine) et peut modifier l'environnement du superviseur, il exécute du code arbitraire.
- **Note** : exploit nécessite déjà un accès local, donc impact réel moindre, mais c'est un pattern à éviter.
- **Fix** : `shlex.split(app_cmd)` + `shell=False`.

#### E8 — Backups DB compressés mais non chiffrés
- **Fichier** : `backup.py:36-59`
- **Détail** : `prospup_YYYYMMDD.db.gz` contient hash des mdp, refresh tokens hashés, tout le CRM en clair. Si le dossier `backups/` fuit (sync OneDrive, etc.) → exposition totale des données.
- **Fix** : chiffrer avec `gpg -c` (passphrase) ou `openssl enc -aes-256-cbc`.

### 🟡 MOYENNE

#### M1 — DB SQLite non chiffrée at-rest
- Pas de SQLCipher. Toutes les données (prospects, hash mdp, tokens) lisibles en clair pour qui accède au filesystem (notamment via OneDrive sync sur un autre PC).
- Fix : SQLCipher (binding `sqlcipher3` + clé dérivée d'un mot de passe maître).

#### M2 — `data/ai_config.json` contient les clés API en clair
- Tavily, Anthropic, HuggingFace, France Travail, Adzuna, Jobfly — toutes en plain text.
- Fix : `chmod 600` minimum. Pour mieux : chiffrer le fichier avec une clé dérivée du mdp maître admin.

#### M3 — Session ID pas régénéré après login (session fixation)
- `routes/auth.py:70-78` : `session['user_id'] = user['id']` sans `session.clear()` ou rotation.
- Fix : `session.clear()` avant de set les nouveaux champs, OU upgrade Flask et utiliser un session interface qui régénère.

#### M4 — Durée session 8h trop longue
- `app.py:210` : `PERMANENT_SESSION_LIFETIME = 8h`. Cookie volé reste valide 8h.
- Fix : 2-4h + sliding renewal.

#### M5 — Pas d'invalidation des sessions au changement de mot de passe
- `routes/auth.py:266-288` : modifie le hash mais n'invalide ni les sessions Flask actives, ni les refresh tokens JWT.
- Fix : `DELETE FROM refresh_tokens WHERE user_id=?` + invalider toutes les sessions de cet user.

#### M6 — Pas de MFA / 2FA
- Particulièrement gênant pour le rôle admin qui peut déployer du code (deploy, IA config, users).
- Fix proposé : TOTP via `pyotp`, obligatoire pour admin.

#### M7 — Pas de logout vraiment effectif côté JWT
- `routes/auth.py:253-263` : `/api/auth/revoke` révoque le refresh token mais l'access token JWT reste valide jusqu'à expiration naturelle (15 min).
- Fix : blacklist en mémoire/Redis pour les access tokens révoqués, OU réduire l'access token à 1-2 min.

#### M8 — Whitelist auth large dans `before_request`
- `app.py:305-308` : `/api/system/check-deployment`, `/api/system/logs`, `/api/tick`, `/api/deploy/*-from-404`, `/api/deploy/rollback`, `/api/deploy/validation-status`, `/api/deploy/confirm-validation`, `/prospects/mode-prosp`, `/api/mode-prosp/` sont tous bypassés.
- `api_system_logs` re-checke admin dans le handler (`routes/misc.py:1127`), c'est une défense en profondeur **acceptable** mais anti-pattern : un dev qui ajoute une route sans re-checker peut créer un trou silencieux.
- Fix : remplacer la whitelist par un décorateur `@public_route` explicite sur les routes vraiment publiques, et garder `before_request` strict par défaut.

#### M9 — XSS potentiel via `|safe` dans `templates/v30/sitemap.html:175`
- `window.SITEMAP_DATA = {{ sitemap_json | safe }};` — la donnée vient de `routes/pages.py:_build_sitemap_data()` qui est aujourd'hui 100 % du code statique côté serveur, donc **pas exploitable en l'état**. Mais si un jour le sitemap intègre du contenu user (labels custom, etc.), c'est une bombe.
- Fix : utiliser `tojson` (safe par défaut) au lieu de `|safe` : `window.SITEMAP_DATA = {{ sitemap_json | tojson }};`.

#### M10 — `MAX_CONTENT_LENGTH = 500 MB`
- `app.py:211` : tout endpoint accepte jusqu'à 500 MB. DoS facile (saturation RAM/disque).
- Fix : 50 MB global par défaut ; surcharger par route si besoin (transcriptions audio peuvent être grosses).

#### M11 — Multiples `f"ALTER TABLE {col} ADD COLUMN {ddl}"` (SQL injection théorique)
- ~25 occurrences dans `app.py`, `routes/*.py`, `services/transcription.py`. Tous les arguments interpolés viennent **aujourd'hui** de listes statiques ou de whitelists, donc **pas exploitable en l'état**. Mais si un dev ajoute une route qui prend un nom de colonne en input et l'envoie dans un de ces helpers, injection SQL immédiate.
- Fix proposé : `quote_ident()` helper qui n'accepte que `[a-zA-Z0-9_]+` et raise sinon. Mettre une assertion dans les helpers de migration.

#### M12 — Pas de rate limit sur autres endpoints sensibles
- Login (rate-limité, mais voir 1.4), changement de mdp (`/api/auth/change-password`), endpoints IA (`/api/ollama/generate-stream` — un user peut bourrer le GPU), `/api/calendar/ics-from-url` (amplifie SSRF).
- Fix : `Flask-Limiter` global avec des règles par route.

### 🟢 FAIBLE / NOTES

- **F1** — JWT en HS256 (secret partagé) plutôt qu'RS256. Pour une app interne mono-serveur c'est OK.
- **F2** — `XSS via innerHTML` dans plusieurs JS (`users.js`, `rapport.js`, `calendar.js`). Les données viennent du backend qui filtre `owner_id` et passe par `jsonify` (échappement JSON), donc pas exploitable en pratique sauf si un autre user injecte du contenu HTML dans un champ texte (notes prospects, titre RDV…). À auditer endpoint par endpoint si on veut être très propre. Un helper global `esc()` (déjà présent dans `users.js:15`) devrait être utilisé partout au lieu de concaténer du HTML.
- **F3** — Tentatives login échouées non persistées en DB (`audit_log`).
- **F4** — Pas de fingerprint device sur refresh tokens (le champ existe mais n'est pas utilisé pour détecter une connexion anormale).
- **F5** — CSP avec `'unsafe-inline'` pour scripts et styles. Réaliste pour l'archi actuelle, mais limite la protection XSS si une faille existe.
- **F6** — Logout côté Flask (web) : à vérifier qu'il y a bien une route `POST /api/auth/logout` qui `session.clear()`. (Non explicitement vu dans les rapports, à confirmer.)
- **F7** — Permissions de fichier sur `data/ai_config.json`, `.secret_key` : à mettre `chmod 600` explicitement.

---

## 3. Bonnes pratiques observées (à conserver)

| Domaine | État |
|---|---|
| Hash mdp | ✅ PBKDF2-SHA256 600k iter + salt (Werkzeug) |
| Timing attack login | ✅ Dummy hash sur user inexistant |
| Cookies | ✅ HttpOnly, Secure, SameSite=Lax |
| Secret Flask | ✅ Généré aléatoirement (`secrets.token_hex(32)`), persisté dans `.secret_key` (gitignored) |
| `.gitignore` | ✅ Excellent (`.env`, `.secret_key`, `*.db`, `logs/`, `data/`, `backups/`, `snapshots/`) — **sauf** `cloudflare-config.yml` qui devrait y être |
| Isolation multi-tenant | ✅ ~95 % des routes vérifient `owner_id` ; helpers `_prospect_owned()` etc. systématiques |
| Headers HTTP | ✅ `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `HSTS` (sous HTTPS), CSP |
| Upload validation | ✅ Extension + magic bytes + taille max + chemins isolés par `owner_id` |
| Audit log | ✅ Table `activity_logs`/`audit_log` enregistre actions sensibles |
| Role-based access | ✅ `@login_required` + `@role_required('admin')` sur deploy, settings, users |
| TLS en transit | ✅ Cloudflare Tunnel TLS 1.3 |
| Pas d'`eval()`, `pickle.load()`, `yaml.load()` non sûrs | ✅ |
| Refresh tokens hashés en DB (SHA256) | ✅ |
| Forme du mdp validée | ✅ min 8 chars, ≥ 1 chiffre + 1 lettre (`app.py:507-511`) |
| Snapshots DB avant chaque deploy | ✅ |

---

## 4. Plan d'action recommandé (par phase)

### Phase 1 — Stop the bleeding (1-2h de dev)
1. **C4** : Supprimer `cloudflare-config.yml` du repo, ajouter à `.gitignore`, **révoquer le tunnel Cloudflare actuel et en créer un nouveau** (sinon la fuite git reste exploitable même après suppression du fichier).
2. **C1 + C2** : Ajouter `@login_required` + `@role_required('admin')` sur `/api/deploy/pull-from-404` et `/api/deploy/rollback`. Retirer ces routes de la whitelist `before_request`. Si la fonction "réparation depuis 404 sans auth" est vraiment nécessaire : passer par un token à usage unique généré à chaque démarrage et affiché en console.
3. **C3** : Retirer les boutons MAJ/Rollback de `404.html`. Mettre à la place un lien vers `/v30/settings` où l'admin authentifié peut faire la même action.
4. **E1** : Désactiver la création d'admin par défaut, OU générer un mdp aléatoire écrit dans `.initial_admin_password` (chmod 600) et forcer changement au premier login.

### Phase 2 — Hardening auth (1 journée)
5. **E2** : Setup GPG sur ta clé git, signer tes commits, ajouter `git verify-commit HEAD` post-pull.
6. **E3** : Réécrire `_require_same_origin()` pour exiger un Origin présent + dans whitelist, sans bypass.
7. **E4** : Patch IDOR avatar (1 ligne).
8. **E5** : CORS strict : whitelister le custom scheme de l'app mobile au lieu de `*`.
9. **M3** : Régénération session ID après login (`session.clear()`).
10. **M5** : Invalidation des refresh tokens au changement de mot de passe.
11. **M4** : Durée session Flask → 2-4h.
12. **M6** : MFA TOTP obligatoire pour rôle admin.

### Phase 3 — Defense in depth (week-end)
13. **E6** : Anti-SSRF sur `/api/calendar/ics-from-url` (filtre IP privées).
14. **E7** : `shlex.split` + `shell=False` dans les scripts superviseur.
15. **E8 + M1** : Chiffrer les backups DB (`gpg -c`) et étudier SQLCipher pour la DB principale.
16. **M2** : Chiffrer `data/ai_config.json` ou au minimum `chmod 600`.
17. **M8** : Refactor whitelist `before_request` → décorateur explicite `@public_route`.
18. **M9** : `|safe` → `|tojson` dans sitemap.html.
19. **M10** : `MAX_CONTENT_LENGTH` → 50 MB.
20. **M12** : Installer `Flask-Limiter`, rate-limit toutes les routes sensibles.

### Phase 4 — Polish (continue)
21. **M11** : Helper `quote_ident()` pour tous les `f"ALTER TABLE ..."`.
22. **F1-F7** : finitions selon temps disponible.

---

## 5. Ambiguïtés relevées (à vérifier manuellement)

- **Logout web** : aucun rapport n'a explicitement listé une route `/api/auth/logout`. Vérifier qu'elle existe et qu'elle fait bien `session.clear()`.
- **`/api/system/check-deployment`** : whitelistée, j'ai vu le handler dans `routes/misc.py:1035` mais pas inspecté son contenu. À vérifier qu'il ne leak rien de sensible (versions, paths, état des services).
- **`/api/mode-prosp/*`** : whitelistées sans auth. Ce sont supposés être des endpoints du « mode prosp » deck 3D autonome — à confirmer qu'aucune route mutating sensible n'est dans ce préfixe.
- **`/prospects/mode-prosp`** : whitelistée. Vérifier que c'est juste la page HTML autonome et qu'elle ne donne pas accès aux données d'un user particulier.

---

## 6. Annexe — éléments hors scope

- **Audit des dépendances Python** (`pip audit`) : pas fait. Recommander de l'ajouter dans `verify.py` ou en CI.
- **Audit des dépendances JS** : pas applicable (pas de bundler, seul Playwright en devDep).
- **Test de pénétration actif** : non, seulement revue de code statique. Une vraie phase pentest exécuterait les exploits décrits ici.
- **Cloudflare Tunnel config** : `cloudflare-config.yml` audité côté contenu git mais pas son comportement (ex. règles d'accès Cloudflare Access, qui peuvent ajouter une couche d'auth devant l'app).
- **OneDrive sync** : le dossier projet est sur OneDrive (mentionné dans CLAUDE.md). Toute donnée sensible (DB, backups, `.env`, `.secret_key`) **est potentiellement synchronisée vers le cloud Microsoft** — à vérifier les règles d'exclusion OneDrive.
