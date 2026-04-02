# Rapport d'Audit — Page Prospects & Mode Prosp

**Date** : 2026-04-02  
**Périmètre** : Lecture seule — aucune modification de code  
**Objectif** : Comprendre l'architecture avant refonte du Mode Prosp

---

## 1. Arborescence annotée des fichiers clés

```
/home/user/Prosp_UpV25/
├── templates/
│   └── index.html              ← Page Prospects principale (HTML, ~400 lignes)
│                                  Contient le slider de vues, les filtres, la modale
├── static/
│   ├── js/
│   │   ├── app.js              ← TOUT le code prospect (15 656 lignes)
│   │   │   ├── L.897          saveToServerAsync() — envoi API
│   │   │   ├── L.2033         filteredProspects[] (tableau global résultat filtres)
│   │   │   ├── L.3480         filterProspects() — moteur de filtrage
│   │   │   ├── L.4769         startStackMode() — code mort (legacy Tinder-style)
│   │   │   ├── L.5416         viewDetail(id) — ouverture fiche modale
│   │   │   ├── L.5986–5988    _prospSession, _currentView (état global)
│   │   │   ├── L.6119–6299    Fonctions Mode Prosp (navigation, session)
│   │   │   ├── L.6173         switchTableKanban(mode) — switcher de vues
│   │   │   ├── L.6301         renderKanban()
│   │   │   └── L.11593–11760  closeDetail(), resumeProspSession()
│   │   └── page-prospects.js   ← 13 lignes : appelle window.appBootstrap('prospects')
│   └── css/
│       └── style.css           ← ~13 000 lignes
│           ├── L.4563–4592    .prosp-cta-mobile, .prosp-resume-banner
│           ├── L.4596–4788    .kanban-board, .kanban-col, .kanban-card
│           ├── L.4801–4831    .prosp-mode-card, progress badge, hint text
│           └── L.4841–4857    Animations .prosp-enter, .prosp-swipe-left
├── app.py                      ← Backend Flask (~10 500 lignes)
│   ├── L.11715                GET /api/data — chargement prospects + companies
│   └── L.11811                POST /api/save — sauvegarde tout le dataset
└── static/js/page-prospects.js ← Bootstrap only (trivial, 13 lignes)
```

**Stack confirmée** : Vanilla JS (pas de framework), Flask backend, SQLite, pas de bundler.

---

## 2. Schéma du flux de données

```
┌─────────────────────────────────────────────────────────┐
│  Chargement initial                                     │
│  GET /api/data → data.prospects[] + data.companies[]    │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  filterProspects()   L.3480                             │
│  Lit data.prospects[], applique tous les filtres DOM    │
│  Produit → filteredProspects[] (tableau global)         │
│  Produit → IDs pour _prospSession.ids (si mode prosp)   │
└──────────┬────────────────────┬────────────────────────┘
           │                    │
           ▼                    ▼
  renderTable()          renderKanban()
  (vue Table)            (vue Kanban)
           │
           └──────────────────────────────────┐
                                              ▼
                               switchTableKanban('prosp')
                               → _prospSession = {
                                   active: true,
                                   ids: filteredProspects IDs,
                                   currentId: ids[0],
                                   currentIndex: 0
                                 }
                               → viewDetail(ids[0])
                                              │
                                              ▼
                               Modale #modalDetail
                               + classe .prosp-mode-card
                               + badge "X / Y"
                               + hint "Swipe left: next"
                                              │
                              ┌───────────────┴──────────────┐
                              │  Swipe gauche                │  Fermer / Swipe droite
                              ▼                              ▼
                     viewDetail(nextId)           closeDetail()
                     _syncProspCurrent()          → _currentView = 'table'
                     sessionStorage update        → showProspResumeBanner()
                              │
                              ▼
                  Modification d'un champ
                  → data.prospects[idx].field = val
                  → saveToServerAsync()
                  → POST /api/save (TOUT le dataset)
```

---

## 3. Inventaire complet du Mode Prosp

### 3.1 Variables globales (app.js)

| Variable | Ligne | Rôle |
|---|---|---|
| `_currentView` | L.5987 | `'table'` / `'prosp'` / `'kanban'` |
| `_prospSession` | L.5988 | Objet session Mode Prosp |
| `_prospManuallyExited` | (flag) | Détecte sortie volontaire |
| `PROSP_SESSION_STORAGE_KEY` | L.5986 | Clé sessionStorage |
| `filteredProspects` | L.2033 | Tableau résultat des filtres |

### 3.2 Structure de `_prospSession`

```javascript
{
  active: boolean,        // Mode prosp actif ?
  ids: number[],          // IDs prospects dans l'ordre filtré courant
  currentId: number,      // ID prospect affiché
  currentIndex: number,   // Position dans ids[]
  listScrollState: {      // Scroll capturé à l'entrée
    anchorId, tableScrollTop, windowY
  }
}
```

### 3.3 Fonctions exclusivement Mode Prosp (app.js)

| Fonction | Ligne | Rôle |
|---|---|---|
| `switchTableKanban('prosp')` | L.6173 | Entrée dans le mode |
| `_syncProspCurrent(id)` | L.6119 | MAJ position courante dans la session |
| `getProspProgress(id)` | L.6126 | Retourne `{index, total}` |
| `getProspNextId(id)` | L.6133 | ID suivant dans la session |
| `getProspPrevId(id)` | L.6141 | ID précédent |
| `syncProspSessionWithFilteredList()` | L.6149 | Resync IDs quand un filtre change |
| `_saveProspSessionToStorage()` | (appelée) | Persistance en sessionStorage |
| `resumeProspSession()` | L.11696 | Reprendre session après sortie |
| `closeDetail({keepProspMode})` | L.11593 | Fermeture + exit mode |

### 3.4 Routes backend spécifiques Mode Prosp

**Aucune.** Le Mode Prosp est 100% client-side. Il réutilise les mêmes routes que les autres vues :
- `GET /api/data` (L.11715) — chargement initial
- `POST /api/save` (L.11811) — sauvegarde (envoie TOUT le dataset)

### 3.5 CSS exclusif Mode Prosp (style.css)

| Sélecteur | Ligne | Rôle |
|---|---|---|
| `.prosp-cta-mobile` | L.4563 | Bouton mobile "Mode Prosp" |
| `.prosp-resume-banner` | L.4566 | Bannière "Reprendre session" |
| `.modal-content.prosp-mode-card` | L.4801 | Bordure orange modale prosp |
| `.detail-prosp-progress` | L.4812 | Badge "X / Y" |
| `.detail-prosp-hint` | L.4826 | Texte "Swipe left: next · Swipe right: close" |
| `.prosp-enter` | L.4841 | Animation entrée (slide from right + scale up, 0.18s) |
| `.prosp-swipe-left` | L.4845 | Animation sortie (slide to left + scale down, 0.16s) |

### 3.6 HTML dédié Mode Prosp (index.html)

| Élément | Ligne | Rôle |
|---|---|---|
| `#btnViewProsp` | L.206 | Bouton "Mode Prosp" dans le slider de vues |
| `#prospResumeBanner` | L.292 | Bannière "Reprendre" après sortie |
| `#modalDetail` | (modale) | Modale réutilisée, classe `.prosp-mode-card` injectée dynamiquement |

---

## 4. Système de filtres

### 4.1 Filtres disponibles (index.html)

| Filtre | ID DOM | Type |
|---|---|---|
| Recherche texte | `#searchInput` | Texte libre (nom, entreprise, tél, email, notes, tags) |
| Entreprise | `#companyFilter` | Select |
| Statut | `#statusFilter` | Select |
| Pertinence | `#pertinenceFilter` | Select (étoiles) |
| A un téléphone | `#phoneFilter` | Checkbox |
| A un email | `#emailFilter` | Checkbox |
| A un LinkedIn | `#linkedinFilter` | Checkbox |
| Push email | `#pushFilter` | Checkbox |
| Relance due | `#followupFilter` | Checkbox |
| Priorité | `#priorityFilter` | Select |
| Tags/compétences | `#filterTagsInput` | Input multi-tags (logique AND) |
| Exclure statuts | `#excludePanel` | Multi-checkboxes |

### 4.2 Logique de filtrage (app.js L.3480–3577)

1. Capture de l'état scroll courant
2. Lecture de tous les filtres DOM
3. Base : `data.prospects[]`
4. Filtre archives : `_showArchived` → archives seulement / actifs seulement
5. Filtre urgent : relances dues
6. Application séquentielle de tous les filtres (AND entre filtres)
7. Tri via `applySort()`
8. Reset pagination
9. **Si Mode Prosp actif** : `syncProspSessionWithFilteredList()` resynchronise les IDs
10. Rendu table/kanban

### 4.3 État des filtres

**Pas de store central.** L'état vit directement dans les éléments DOM (`element.value`, `element.checked`). `filteredProspects[]` est le résultat calculé, recalculé à chaque changement.

**Pour obtenir la liste filtrée courante depuis n'importe où** : lire directement `window.filteredProspects` (variable globale).

---

## 5. Persistance & synchronisation

### 5.1 Sauvegarde

- **Déclencheur** : modification d'un champ dans la modale → `saveToServerAsync()`
- **Mécanisme** : POST vers `/api/save` avec `{companies: [...], prospects: [...]}` — **dataset complet**
- **Pas de debounce** sur les champs texte
- **Pas de PATCH** unitaire par prospect — tout est écrasé à chaque save
- **Pas de gestion de conflit** : dernier appel POST gagne

### 5.2 Persistence Mode Prosp

- Stockée dans `sessionStorage` (clé `prospup_last_prosp_session`)
- Survit au refresh de page
- Perdue à la fermeture de l'onglet
- Restaurée via le bouton "Reprendre" dans `#prospResumeBanner`

### 5.3 Temps réel & multi-tabs

- **Pas de WebSocket** — architecture polling/manuel uniquement
- **Pas de BroadcastChannel** — chaque onglet est isolé
- **Pas de SharedWorker**
- Un changement dans l'onglet A n'est jamais répercuté dans l'onglet B
- `window.open()` : présent dans l'app mais pas sur la page Prospects pour les fiches

---

## 6. Points d'attention pour la refonte

### Critiques

**A. `app.js` = monolithe de 15 656 lignes**  
Tout (filtres, rendu, navigation, gestures, sauvegarde, Mode Prosp) est dans un seul fichier sans isolation des responsabilités. Toute modification risque des régressions.

**B. Sauvegarde = envoi du dataset complet**  
`POST /api/save` sérialise et envoie TOUS les prospects + toutes les entreprises à chaque modification. Avec 500 prospects, chaque clic "Enregistrer" envoie plusieurs centaines d'enregistrements. Pas de debounce sur les champs texte.

**C. Pas de sync cross-tab**  
`_prospSession` est en `sessionStorage` — propre à chaque onglet. Un `window.open()` sur une fiche ouvre une page sans accès à la session Mode Prosp de l'onglet parent. Les modifications dans un onglet ne se répercutent pas dans un autre.

**D. `_currentView` = variable globale non persistée**  
L'état du mode actif n'est ni dans l'URL (`?view=prosp`) ni dans localStorage. Un refresh remet en mode Table. Impossible de partager un lien "prospects en mode prosp avec ces filtres".

**E. `startStackMode()` (L.4769) = code mort**  
Fonction legacy style Tinder, distincte du Mode Prosp actuel. CSS et handlers potentiellement en conflit avec une refonte.

### Importants

**F. Navigation clavier absente**  
Pas de navigation clavier (←/→) dans Mode Prosp sur desktop. Uniquement swipe mobile. Ergonomie desktop dégradée.

**G. Pas de gestion de conflit**  
Dernier `POST /api/save` gagne. En multi-onglets ou multi-utilisateurs, les données peuvent s'écraser silencieusement.

**H. `_showArchived` = flag global partagé**  
Ce flag unique contrôle deux comportements orthogonaux (archives ET "urgent relances") — logique fragile à refactoriser.

---

## 7. Recommandations techniques pour la suite

### 7.1 Extraire Mode Prosp dans son propre module JS

Créer `static/js/mode-prosp.js` avec état encapsulé. Interface minimale avec app.js :

```javascript
// API publique proposée
initProspMode(filteredIds)    // Entrée dans le mode
destroyProspMode()            // Sortie propre
navigateTo(id)                // Navigation
onProspectChange(callback)    // Hook pour synchronisation
```

Cela permet de modifier/remplacer le mode sans toucher au reste de app.js.

### 7.2 Clarifier les trois niveaux de données

```
data.prospects[]          ← Source de vérité (chargée depuis API, jamais modifiée directement)
filteredProspects[]       ← Vue calculée (dérivée de data + filtres, read-only)
_prospSession             ← État UI du mode (dérivé de filteredProspects, éphémère)
```

Aujourd'hui ces trois niveaux sont couplés dans les mêmes fonctions.

### 7.3 URL comme source de vérité pour le mode actif

Stocker `?view=prosp&id=123` dans l'URL via `history.pushState()` + écoute `popstate`. Bénéfices :
- Partageabilité des liens
- Restauration au refresh
- Navigation back/forward navigateur native

### 7.4 Synchronisation cross-tab via BroadcastChannel

Si une fiche ouverte dans un onglet secondaire doit se synchroniser avec la navigation Mode Prosp de l'onglet principal :

```javascript
// Onglet principal (Mode Prosp)
const bc = new BroadcastChannel('prosp-mode');
bc.postMessage({ type: 'navigate', id: 123 });

// Onglet secondaire (fiche ouverte)
bc.onmessage = (e) => {
  if (e.data.type === 'navigate') viewDetail(e.data.id);
};
```

`BroadcastChannel` est supporté dans tous les navigateurs modernes (Chrome 54+, Firefox 38+, Safari 15.4+).

### 7.5 PATCH unitaire au lieu du POST complet

Remplacer le POST complet par `PATCH /api/prospects/:id` avec uniquement les champs modifiés. Élimine le risque d'écrasement et réduit le payload de ~99%.

### 7.6 Périmètre minimal supprimable sans risque

Ce qui peut être retiré sans impacter les vues Liste et Kanban :

| Élément | Fichier | Lignes |
|---|---|---|
| `_prospSession` et ses fonctions | app.js | L.5986–5988, L.6119–6171 |
| `startStackMode()` (code mort) | app.js | L.4769–4801 |
| Logique `isProspMode` dans `viewDetail()` | app.js | L.5422–5432 |
| `resumeProspSession()` | app.js | L.11696–11760 |
| CSS `.prosp-*` et `.detail-prosp-*` | style.css | L.4563–4592, L.4801–4857 |
| `#prospResumeBanner` | index.html | L.292 |

---

*Rapport généré le 2026-04-02 — Lecture seule, aucune modification effectuée.*
