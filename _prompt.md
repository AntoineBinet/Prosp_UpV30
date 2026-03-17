Lis CLAUDE.md avant toute chose.

## CONTEXTE PROJET
- App : ProspUp CRM B2B — Flask/Python, SQLite, Vanilla JS, 20 pages HTML
- Stack : app.py (~10500 lignes), style.css (~7200 lignes), app.js (~7200 lignes)
- Hébergement : prospup.work via Cloudflare Tunnel, port 8000
- Git : toujours sur main, jamais de branches
- APP_VERSION actuelle : 27.0 (dans app.py) — incrémenter à chaque modification

## RÈGLES ABSOLUES
- Ne jamais créer de branches Git
- Ne jamais écraser la DB
- Toujours quoter les chemins (espaces dans OneDrive)
- Conserver le design glassmorphism dark theme
- Conserver la sidebar et bottom nav identiques sur toutes les pages
- Tester que le serveur démarre sans erreur avant de push

## MA MODIFICATION
[ÉCRIRE ICI]

## MÉTHODE DE TRAVAIL
1. Planifie : liste tous les fichiers à modifier et les changements prévus dans chacun
2. Valide le plan avec moi avant de coder
3. Implémente fichier par fichier
4. Si la tâche est complexe, utilise des sous-agents en parallèle :
   - Sous-agent 1 : modifications frontend (HTML/CSS/JS)
   - Sous-agent 2 : modifications backend (app.py)
   - Sous-agent 3 : tests et vérification
5. Vérifie qu'il n'y a pas d'erreur Python (syntax check)

## FIN DE SESSION — TOUJOURS FAIRE
1. Incrémenter APP_VERSION dans app.py
2. git add -A
3. git commit -m "type(scope): description courte"
4. git push origin main
5. Confirmer avec le hash du commit