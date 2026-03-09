# Audit cohérence UI et navigation — ProspUp

**Date :** mars 2025

## Correctifs appliqués

1. **Lien Aide (parametres.html)**  
   - `href="/aide"` remplacé par `href="/help"` pour cohérence avec la sidebar et les autres liens.

2. **Boutons fermeture modales (sourcing.html)**  
   - `close-btn` remplacé par `modal-close` (classe définie dans style.css) sur les deux modales (candidat et EC1), avec `aria-label="Fermer"`.

## Recommandations restantes (optionnel)

- **metiers.html :** utiliser les classes `btn btn-primary` / `btn-secondary` pour « Tout déplier », « Tout replier », « Ajouter » ; ajouter `app.js` si besoin des toasts.
- **help.html :** supprimer le script inline qui gère `.active` sur la nav (déjà géré par sidebar.js).
- **users.html / company.html / candidate.html :** remplacer les styles inline des bandeaux par une classe commune (ex. `.content-header .controls`) dans style.css.

## Structure validée

- **Sidebar et bottom nav :** une seule source (`sidebar.js`) ; `data-page` aligné sur toutes les pages.
- **Header :** logo + titre « ProspUp — … » + sous-titre ; cohérent sur les pages authentifiées.
- **Modales :** structure `.modal` → `.modal-content` → `modal-close` ; formulaires avec `filter-input`, `filter-select`, `form-grid`.

## Référence

Audit réalisé par exploration des 22 fichiers HTML et des scripts partagés (sidebar.js, v8-features.js, app.js).
