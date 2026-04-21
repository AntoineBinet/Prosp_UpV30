# HANDOFF — ProspUp v30 → Claude Code

Tu lis ce fichier parce que tu es **Claude Code**, lancé dans le repo Flask de ProspUp (`Prosp_UpV25`). Ta mission : **migrer l'UI actuelle vers la v30** décrite ici, sans casser la DB ni les endpoints.

---

## 1. Ce que tu as sous les yeux

Ce dossier (`design/v30/` ou équivalent) contient :

```
HANDOFF.md              ← ce fichier (instructions opérationnelles)
SPEC.md                 ← spec UX/UI détaillée (direction, écrans, règles)
design-system/
  tokens.css            ← variables CSS (OKLCH, light + dark)
  components.css        ← .btn .card .badge .status .table etc.
ProspUp v30 — Refonte.html  ← référence visuelle globale (ouvre-la)
screens/
  _chrome.jsx           ← Topbar, Sidebar, Icon, ThemeToggle
  dashboard.jsx
  prospects.jsx
  prospect-detail.jsx
  entreprises.jsx
  push.jsx
  sourcing.jsx
  stats.jsx
  login-palette.jsx
design-canvas.jsx       ← wrapper présentation (ignore pour le port)
```

Le HTML de référence est **React + Babel inline** — ce n'est pas le code à committer tel quel. C'est la **source de vérité visuelle**. Tu dois reproduire ce rendu dans le stack Flask existant (Jinja2 + HTMX + vanilla JS).

---

## 2. Workflow Git — NON négociable

1. **Crée une branche** : `git checkout -b feat/ui-v30`
2. **Un commit par écran ou par morceau cohérent**. Messages en français, préfixe `ui(v30):`. Exemple :
   `ui(v30): tokens + components.css + theme toggle`
   `ui(v30): nouvelle navigation globale (topbar + sidebar)`
   `ui(v30): dashboard v3 (hero + bento)`
3. **Arrête-toi après chaque gros écran** pour que l'utilisateur valide avant de continuer.
4. **Pas de force-push**. Pas de rebase sur `main` sans demander.
5. À la fin : ouvre une **PR `feat/ui-v30` → `main`** avec un récap des changements et des captures.

---

## 3. Étapes — dans l'ordre

### Étape 0 · Préparation
- Lis `SPEC.md` en entier
- Liste les routes Flask et templates actuels (`templates/`, `static/`, `app.py` ou équivalent)
- Crée `CHECKLIST.md` à la racine avec la liste des écrans à migrer, coche au fur et à mesure

### Étape 1 · Design system (prérequis de tout le reste)
- Copie `design/v30/design-system/tokens.css` → `static/css/tokens.css`
- Copie `design/v30/design-system/components.css` → `static/css/components.css`
- Importe les deux dans le layout Jinja de base (`base.html` ou équivalent), dans cet ordre
- Ajoute le preconnect + `<link>` Google Fonts pour **Inter**, **Instrument Serif**, **JetBrains Mono** (cf. `ProspUp v30 — Refonte.html` pour l'URL exacte)
- Mets `data-theme="dark"` par défaut sur `<html>`
- Ajoute un **script d'init thème** inline en `<head>` (avant render) :
  ```html
  <script>
    (function(){
      try {
        var t = localStorage.getItem('theme');
        if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
      } catch(e) {}
    })();
  </script>
  ```
- Supprime ou archive l'ancien CSS (dans un dossier `static/css/legacy/` au cas où)
- **Commit** : `ui(v30): design system (tokens + components + fonts + theme init)`

### Étape 2 · Navigation globale
Reproduis `screens/_chrome.jsx` en **Jinja partials** :
- `templates/_partials/topbar.html` — breadcrumbs, commandK placeholder, Créer, bell, avatar
- `templates/_partials/sidebar.html` — Navigate / Records / Épinglés, compteurs, footer avec `ThemeToggle` + version
- `templates/_partials/theme_toggle.html` — bouton soleil/lune qui bascule `document.documentElement.dataset.theme` et persiste en localStorage
- Les icônes : convertir le dict `Icon` en un **partial `{% include %}` + `{% macro icon(name, size=14) %}`** qui génère le SVG. Utilise exactement les mêmes paths que dans `_chrome.jsx`.
- Intègre dans `base.html` avec `<div class="app-shell">` contenant `topbar` + `<div class="app-body">{sidebar + main}</div>`
- **Commit** : `ui(v30): navigation globale (topbar + sidebar + theme toggle)`

### Étape 3 · Écrans, un par un
**Ordre recommandé** :
1. **Login** (`screens/login-palette.jsx` → `templates/auth/login.html`)
2. **Dashboard** (`screens/dashboard.jsx` → `templates/dashboard.html`)
3. **Prospects** (liste table + fiche) (`screens/prospects.jsx` + `prospect-detail.jsx`)
4. **Entreprises** (`screens/entreprises.jsx`)
5. **Push** (`screens/push.jsx`)
6. **Sourcing** (`screens/sourcing.jsx` → candidats)
7. **Stats & Rapport** (`screens/stats.jsx`)

Pour chaque écran :
- Lis le JSX, reproduis la structure exacte en Jinja
- Mappe les données mockées vers les vraies requêtes SQLAlchemy existantes
- Préserve les endpoints Flask — pas de changement de routes sans demander
- Ajoute HTMX pour les interactions live (tri, filtres, drawer fiche prospect)
- **Commit par écran** avec capture avant/après

### Étape 4 · Command Palette ⌘K
Voir `SPEC.md` §"Command Palette". Fetch unifié sur prospects + entreprises + candidats + actions. Raccourci clavier global.

### Étape 5 · Polish & PR
- Vérifie responsive (desktop 1440 prioritaire, mais rien ne doit casser <1280)
- Lance les tests existants, corrige si cassé
- Ouvre la PR avec récap Markdown et captures light + dark

---

## 4. Règles de reproduction visuelle

1. **Fidélité pixel** — tailles, espacements, weights, couleurs = ceux du JSX de référence. Rien d'inventé.
2. **Toutes les couleurs passent par les tokens** (`var(--text)`, `var(--accent)`, etc.). Jamais de hex en dur dans les templates.
3. **Pas d'emoji**, pas d'icônes inventées. Utilise uniquement les SVG du dict `Icon`.
4. **Fonts** : Inter (UI), Instrument Serif (grands chiffres éditoriaux du dashboard, login, titres de section), JetBrains Mono (numéros, mono).
5. **Light et dark doivent marcher** à l'identique (les tokens le garantissent si tu n'ajoutes pas de hex en dur).
6. **Pas de nouvelle dépendance JS** sans demander. HTMX OK si déjà présent.

---

## 5. Ce que tu NE fais pas sans demander

- ❌ Modifier le schéma DB ou les migrations
- ❌ Renommer / supprimer des routes Flask
- ❌ Ajouter un framework (React, Vue, Tailwind, etc.)
- ❌ Toucher à l'auth ou aux permissions
- ❌ Force-push, rebase sur `main`, merge tout seul
- ❌ Inventer du contenu (copy, labels) — reprends ceux du JSX

## 6. Ce que tu peux faire librement

- ✅ Refactorer le CSS ancien en le remplaçant par tokens + components
- ✅ Créer des partials Jinja pour factoriser
- ✅ Ajouter des endpoints HTMX pour interactions (tri, filtres, toggle statut…)
- ✅ Améliorer la perf (lazy-load, cache queries)
- ✅ Proposer dans la PR des améliorations supplémentaires (en section "Suggestions")

---

## 7. Points d'attention spécifiques

- **Thème dark** par défaut (l'utilisateur le préfère). Toggle persiste en localStorage.
- **Colonne Mobile** dans la liste prospects : numéro cliquable `tel:` + pastille dispo (vert/ambre/gris).
- **Pas de notion d'argent** sur le dashboard (ni €, ni CA, ni pipe en valeur). Uniquement nombre de prospects / conversions / RDV / pushes.
- **Pas de login Google**. Seulement email + password.
- Si une donnée mock du JSX n'existe pas en DB (ex: "pertinence" 1-5) : soit tu l'ajoutes en colonne nullable avec migration, soit tu demandes. Ne l'invente pas silencieusement.

---

## 8. Communication

Après chaque étape majeure, écris un court récap dans le chat :
- Ce qui est fait ✅
- Ce qui reste 🔜
- Blocages éventuels ❓

Bon travail.
