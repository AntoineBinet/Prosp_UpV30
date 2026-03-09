# Vérification manuelle — Checklist UI mars 2025

Lorsque les tests E2E Playwright ne peuvent pas être exécutés (npx/Node indisponible), vérifier manuellement sur **https://prospup.work** (ou http://127.0.0.1:8000 en local) avec les identifiants de test (ex. admin/admin).

---

## 1. Bouton « Ajout KPI manuel »

- **Page** : https://prospup.work/dashboard
- Le bouton **« ➕ Ajout KPI manuel »** est visible directement sous la ligne des cartes KPI, aligné à droite.
- Un clic ouvre la modale « Ajouter une action KPI manuellement ».

---

## 2. Boutons « Voir » en orange

- **Dashboard** : si la bannière « ▲ X relances en retard » s’affiche, le lien **« Voir Focus → »** doit avoir un style **bouton orange** (dégradé), pas violet/rose.
- **Prospects** (/) : dans le tableau, colonne ACTIONS, le bouton **« 👁️ Voir »** par ligne doit être **orange** (dégradé primary). Un clic ouvre la fiche détail.

---

## 3. Tags statut

- **Page** : https://prospup.work/
- Colonne STATUT : pastilles (ex. « Pas d’actions », « À rappeler ») avec style **discret / glass** (bords arrondis, léger flou, bordure fine).

---

## 4. Jours agrandissables (calendrier)

- **Page** : https://prospup.work/calendrier
- Vue **Mois** : clic sur la **zone du jour** (hors lien d’un événement) ou sur **« +X autre(s) »** ouvre la modale **« Détails — [date] »** avec la liste des événements du jour.
- La modale se ferme avec le **bouton ×**, un **clic sur le fond** ou **Escape**.

---

## 5. Réduction sidebar

- **Desktop** (fenêtre large) : en haut de la barre latérale gauche, bouton avec le symbole **« « »** (chevron), titre « Réduire / Agrandir le menu ». Un clic réduit la barre (icônes seules) ; le chevron devient **« » »**. Second clic redéploie. Après **rafraîchissement**, l’état (réduit/étendu) est conservé.

---

## 6. Cohérence sidebar

- Vérifier que la **même** barre latérale (structure + bouton réduire) est présente sur : Dashboard, Prospects (/), Entreprises, Focus, Calendrier, Sourcing, Push, Stats, Rapport, Paramètres (et sous-pages), Utilisateurs (si admin).

---

*Complément à docs/CHECKLIST_VERIF_UI_MARS2025.md — à utiliser si `npx playwright test tests/e2e/checklist-ui-mars2025.spec.js` n’a pas été exécuté.*
