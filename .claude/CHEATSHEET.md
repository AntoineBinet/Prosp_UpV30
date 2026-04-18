# Cheatsheet Claude Code — ProspUp

Commandes et patterns récurrents pour gagner du temps.

## Localiser quelque chose

```bash
# Route Flask
grep -rn "@app.route('/api/…')" app.py

# Fonction ou classe
grep -n "def mon_fonction" app.py

# Référence d'un fichier JS dans les templates
grep -rn "page-focus.js" templates/

# Utilisation d'une classe CSS
grep -rn "prospect-card-mobile" static/ templates/
```

## Patterns backend fréquents

### Vérifier qu'un utilisateur est propriétaire d'une ressource
```python
if not _prospect_owned(pid):
    return jsonify(ok=False, error="forbidden"), 403
```

### Ouvrir la DB du user courant
```python
with _conn() as conn:
    rows = conn.execute("SELECT … WHERE owner_id=?", (_uid(),)).fetchall()
```

### Route protégée admin
```python
@app.route("/api/admin/…", methods=["POST"])
@role_required("admin")
def api_admin_thing():
    …
```

### Ajouter une colonne à la DB (migration idempotente)
```python
try:
    conn.execute("ALTER TABLE prospects ADD COLUMN nouveau_champ TEXT")
except sqlite3.OperationalError:
    pass  # colonne déjà présente
```

## Patterns frontend fréquents

### Toast notification
```javascript
window.showToast("Prospect enregistré", "success");
window.showToast("Erreur", "error", 5000);
```

### Appel API avec erreur standard
```javascript
try {
  const r = await fetch('/api/…', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Erreur');
  showToast('OK', 'success');
} catch (e) {
  showToast(e.message, 'error');
}
```

### Haptic feedback (mobile uniquement)
```javascript
if (window.haptic) window.haptic(10);  // 10ms vibration
```

### Détection mobile
```javascript
const isMobile = window.matchMedia('(max-width: 900px)').matches;
```

### Appel IA (Ollama direct ou Ollama+Tavily)
```javascript
const result = await callOllama(prompt);                      // Ollama seul
const result = await callOllama(prompt, { webSearch: true }); // + Tavily
```

## Ajout d'une page

1. Créer `templates/ma_page.html` (extend `base.html`).
2. Créer `static/js/page-ma-page.js` (1 fichier par page).
3. Ajouter la route dans `app.py` : `@app.route('/ma-page')` qui fait `render_template('ma_page.html')`.
4. Ajouter dans `sidebar.js` (NAV_ITEMS) si desktop nav.
5. Ajouter dans `MOBILE_NAV` du même fichier si mobile bottom nav.
6. Ajouter entrée cache dans `static/sw.js` si page à cacher offline.

## Ajout d'un endpoint API

1. Dans `app.py`, préférer la section correspondante (par exemple à côté des autres endpoints prospects).
2. Décorateur `@app.route(..., methods=[...])`.
3. Vérifications : `@role_required` si admin, `_uid()` + filtre `owner_id` toujours.
4. Retour JSON : `return jsonify(ok=True, data=...)` ou `return jsonify(ok=False, error="…"), 400`.
5. Documenter dans la ligne au-dessus si non-trivial.

## Commandes git utiles

```bash
# État complet
git status
git log --oneline -10

# Modifier le dernier commit (PAS encore pushé)
git add <file>
git commit --amend --no-edit

# Voir le diff staged / unstaged
git diff                  # unstaged
git diff --staged         # staged

# Annuler un add
git restore --staged <file>

# Revenir sur un fichier (perdre modifs locales)
git restore <file>

# Push
git push origin main
```

## Debug rapide

### App ne démarre pas
```bash
python -c "import app"   # isole l'erreur d'import
python app.py            # démarre en debug
```

### Endpoint renvoie 500
1. Regarder `logs/prospup.log` (ou bouton « Voir les logs serveur » dans Paramètres).
2. Ajouter `traceback.print_exc()` dans le `except` si l'erreur est masquée.
3. Tester en debug : `python app.py` (sans `--prod`) pour voir la stacktrace en console.

### JS ne se charge pas
1. Console navigateur → erreurs chargement / syntaxe.
2. Hash buster : `GET /static/js/app.js?v=xxx` — si cache, DevTools > Disable cache.
3. SW interfère ? DevTools > Application > Service Workers > Unregister.

### DB corruption / schema mismatch
1. Snapshot DB avant toute action : Paramètres > Maintenance > Créer un snapshot.
2. Restaurer depuis `snapshots/` ou `backups/` (fichiers `.db` ou `.db.gz`).

## Anti-régression — checklist avant commit backend

- [ ] L'app démarre sans erreur
- [ ] Pas de breaking change sur un endpoint public (sinon bump minor version)
- [ ] Si migration DB : testée sur une copie de `prospects.db`
- [ ] APP_VERSION bumpé si changement notable
- [ ] Commit message descriptif (verbe + objet + raison)

## Anti-régression — checklist avant commit frontend

- [ ] Testé sur desktop ET mobile (DevTools > Device Mode Pixel 5)
- [ ] Dark mode ET light mode OK si CSS modifié
- [ ] Service Worker ne bloque pas un nouveau fichier (bump version si besoin)
- [ ] Pas de console.log / console.error en dev leftover
