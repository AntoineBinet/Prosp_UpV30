# Rapport — Checklist de vérification UI (mars 2025)

**Date** : 9 mars 2025  
**Référence** : `docs/CHECKLIST_VERIF_UI_MARS2025.md`  
**Contexte** : Application Prosp'Up (Flask + HTML/JS/CSS, PWA), cible prospup.work ou http://127.0.0.1:8000.

---

## Résumé

| Section | Statut | Commentaire |
|--------|--------|-------------|
| 1. Bouton Ajout KPI manuel | **Non vérifié** | Tests E2E non exécutés (voir ci‑dessous). |
| 2. Boutons « Voir » en orange | **Non vérifié** | Idem. |
| 3. Tags statut | **Non vérifié** | Idem. |
| 4. Jours agrandissables (calendrier) | **Non vérifié** | Idem. |
| 5. Réduction sidebar | **Non vérifié** | Idem. |
| 6. Cohérence sidebar | **Non vérifié** | Idem. |

---

## 1. Bouton « Ajout KPI manuel » (placement)

- **Statut** : **Non vérifié**
- **Raison** : Suite E2E Playwright non exécutée (commande `npx` non reconnue dans l’environnement PowerShell utilisé).
- **Vérification code** : Le bouton « ➕ Ajout KPI manuel » est bien présent dans `dashboard.html` dans `#dashKpiActionsRow`, directement sous `#dashKpiRow` ; la modale `#manualKpiModal` est définie dans le même fichier et ouverte par `openManualKpiModal()` dans `page-dashboard.js`.
- **Pour valider** : Exécuter `npx playwright test tests/e2e/checklist-ui-mars2025.spec.js` (avec Node/npx disponible) ou suivre `docs/VERIF_MANUELLE_CHECKLIST_UI.md` sur https://prospup.work.

---

## 2. Boutons « Voir » en orange

- **Statut** : **Non vérifié**
- **Raison** : Tests E2E non exécutés.
- **Vérification code** : Lien « Voir Focus → » avec classe `.relance-alert-banner-link` dans `dashboard.html` et `index.html` ; styles dans `style.css` (`.relance-alert-banner-link`). Bouton « 👁️ Voir » avec classe `.prospect-action-voir` dans `app.js` ; styles `.prospect-action-voir` (dégradé primary/orange) dans `style.css`.
- **Pour valider** : Idem — script Playwright dédié ou vérification manuelle.

---

## 3. Tags statut (style général)

- **Statut** : **Non vérifié**
- **Raison** : Tests E2E non exécutés.
- **Vérification code** : Colonne STATUT avec `.table-statut-badge` et classes dérivées ; style « glass » dans `style.css` (`.table-statut-badge`, bords arrondis, backdrop, bordure).
- **Pour valider** : Idem — script ou manuel sur la page Prospects.

---

## 4. Jours agrandissables dans le calendrier

- **Statut** : **Non vérifié**
- **Raison** : Tests E2E non exécutés.
- **Vérification code** : `page-calendar.js` — `_openCalDayDetail(iso)`, modale `#calDayDetailModal`, titre « Détails — [date] », `_attachCalDayDetailListeners()` (clic sur `.cal-cell-clickable` et `.cal-ev-more-btn`), `_closeCalDayDetail()` (overlay, Escape). Modale déclarée dans `calendrier.html`.
- **Pour valider** : Idem — script ou manuel sur /calendrier.

---

## 5. Réduction de la barre de navigation gauche

- **Statut** : **Non vérifié**
- **Raison** : Tests E2E non exécutés.
- **Vérification code** : `v8-features.js` — `_initSidebarCollapse()`, bouton `#sidebarCollapseBtn` (chevron « « » / « » »), titre « Réduire / Agrandir le menu », `localStorage.getItem('sidebar-collapsed')` restauré au chargement. CSS `.sidebar-collapse-btn`, `.sidebar-collapsed` dans `style.css`.
- **Pour valider** : Idem — script ou manuel (desktop, fenêtre large).

---

## 6. Cohérence de la barre de navigation sur toutes les pages

- **Statut** : **Non vérifié**
- **Raison** : Tests E2E non exécutés.
- **Vérification code** : Structure commune `<aside class="sidebar"></aside>` + `sidebar.js` + `v8-features.js` (collapse) ; les pages listées dans la checklist (dashboard, /, entreprises, focus, calendrier, sourcing, push, stats, rapport, parametres, users) utilisent le même layout.
- **Pour valider** : Idem — script Playwright parcourt toutes les URLs et vérifie la présence de `.sidebar` et `#sidebarCollapseBtn` (desktop).

---

## Exécution des tests E2E

- **Suite standard Playwright** : **Non exécutée** — `npx` non reconnu dans le shell PowerShell utilisé (Node/npx non dans le PATH ou non installé).
- **Sortie** : *(aucune sortie à joindre)*

Pour lancer la suite complète plus tard :
```bash
cd Prosp_UpV25
set PYTHONIOENCODING=utf-8
npx playwright test
```

Pour lancer uniquement le script de la checklist UI :
```bash
npx playwright test tests/e2e/checklist-ui-mars2025.spec.js
```

---

## Fichiers ajoutés / modifiés

- **`tests/e2e/checklist-ui-mars2025.spec.js`** : Nouveau. Script Playwright qui couvre les 6 sections de la checklist (bouton KPI, Voir orange, tags statut, calendrier modale, sidebar collapse, présence sidebar sur toutes les pages). À exécuter avec l’auth du projet (projet `desktop-chrome` avec `storageState`).
- **`docs/VERIF_MANUELLE_CHECKLIST_UI.md`** : Nouveau. Instructions pour une vérification manuelle sur prospup.work lorsque les tests E2E ne peuvent pas être lancés.

---

## Conclusion

Les points de la checklist n’ont pas pu être marqués **OK** ou **ÉCHEC** faute d’exécution des tests (npx indisponible). La conformité du code avec la checklist a été vérifiée en lecture (HTML, JS, CSS) ; un script E2E dédié et une fiche de vérification manuelle ont été rédigés pour permettre une validation complète dès que l’environnement Node/Playwright est disponible ou manuellement sur le site déployé.
