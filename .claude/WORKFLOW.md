# Workflow Claude Code — ProspUp

> **Lire avant toute modification.** Ce doc résume les règles non-négociables pour ne rien casser.

## Règle n°1 — Branche unique
- **TOUJOURS** travailler sur `main`. Si `git status` affiche autre chose : `git checkout main` avant tout.
- **JAMAIS** créer de branche feature/hotfix, même temporaire.
- Raison : le bouton « Mettre à jour et redémarrer » du PC hébergeur tire uniquement depuis `origin/main`. Toute branche autre n'arrivera jamais en prod.

## Cycle type d'une modification

```bash
# 0. Vérifier l'état
git status
git log --oneline -5

# 1. Faire la modif (Edit/Write)
# …

# 2. Bumper APP_VERSION si changement notable (app.py:38)
#    Incrément patch : 29.6 → 29.7 pour bugfix / petit nettoyage
#    Incrément minor : 29.6 → 30.0 pour feature majeure ou breaking change

# 3. Commit + push (obligatoire avant de rendre la main à l'utilisateur)
git add -A
git commit -m "feat: …" -m "…détails…"
git push origin main
```

## Vérifications obligatoires avant commit

Avant chaque commit **qui touche au backend** :
1. L'app démarre-t-elle ? `python -c "import app"` ou `python app.py` pendant 5 s puis Ctrl+C.
2. Si endpoint modifié : un `curl` rapide ou test via le browser.
3. Si DB schema modifié : migration idempotente (IF NOT EXISTS, try/except).

Avant chaque commit **qui touche au frontend** :
1. Le fichier est-il bien référencé dans un template ? `grep -r "<fichier.js>" templates/`
2. Pas de console.error leftover en dev.
3. Pas de `cache: 'no-store'` sur les fetch (interdit, gère par SW).

## Anti-patterns à éviter

### ❌ Créer des fichiers de test ou debug dans le repo
```bash
# NON
python test_my_thing.py
python debug_endpoint.py
```
→ Test rapide : utiliser un REPL Python, pas un fichier.
→ Vrai test : l'ajouter dans `tests/` (pytest) ou `tests/e2e/` (Playwright).

### ❌ Modifier uniquement `APP_VERSION` sans changelog
→ Si bump de version : documenter dans `CHANGELOG.md` ou message de commit détaillé.

### ❌ Committer sans push
→ Sans push, le PC hébergeur ne peut pas mettre à jour. Toujours push.

### ❌ Laisser des fichiers temporaires non-ignorés
→ Si besoin d'un fichier local : vérifier qu'il est dans `.gitignore` (`logs/`, `.env`, `*.db`, `node_modules/`, `backups/`, `snapshots/`, etc.).

### ❌ Utiliser `--no-verify` ou bypass
→ Si un hook échoue, corriger la cause, pas la contourner.

## Gestion des dépendances

### Python (requirements.txt)
- Ajouter : modifier `requirements.txt`, tester `pip install -r requirements.txt`, commit les deux.
- Supprimer : vérifier qu'aucun `import` ne reste (grep sur tout le repo), puis retirer de `requirements.txt`.

### Node (package.json)
- Utilisé **uniquement** pour Playwright (tests E2E).
- Ne pas ajouter de deps runtime — le frontend est vanilla JS servi directement.
- `node_modules/` est gitignored. Re-cloner = `npm install`.

## Nettoyage périodique

Quand du code mort ou des fichiers orphelins s'accumulent :
1. Vérifier chaque suppression avec `grep -r "<nom>" .` pour s'assurer qu'elle n'est pas référencée.
2. Confiance HIGH seulement si : (a) aucun match ou (b) tous les matches sont dans des docs/archives déjà désignées à supprimer.
3. Committer les suppressions séparément des features, avec un message `chore: cleanup …`.

## Tests

- **Tests E2E locaux** : `npx playwright test` (Chromium desktop + mobile Pixel 5).
- **Tests Python** : `python -m pytest tests/` — exécuter les test_*.py utiles au contexte.
- **Audit multi-user** : `PYTHONIOENCODING=utf-8 python -m tests.audit_multi_user`.
- **Smoke test démarrage** : `python app.py` puis Ctrl+C après 3 s.

## Environnement Windows / OneDrive

- Chemins avec espaces → toujours quoter : `python "C:\Users\binet\Desktop\Prosp_UpV25\app.py"`.
- Python 3.14 ici, console cp1252 → `PYTHONIOENCODING=utf-8` pour tout script qui print de l'UTF-8.
- Shell bash (Git Bash) dispo → préférer les commandes Unix (`ls`, `grep` via Grep tool, `rm`).
- Jamais de `.bat` nouveaux sans raison — les existants couvrent déjà lancement, tunnel, relance.

## Si quelque chose casse en prod

1. Le bouton « Mettre à jour et redémarrer » affiche une erreur → page 404 avec auto-rollback.
2. L'app ne démarre plus → superviseur détecte crash loop (3 crashs/120 s) et rollback sur `.last_commit_hash`.
3. Rollback manuel : bouton dans Paramètres > Maintenance, ou depuis la page 404.
4. Si vraiment bloqué : SSH/RDP sur le PC hébergeur, `git reset --hard origin/main~1` puis relancer `python app.py --prod`.
