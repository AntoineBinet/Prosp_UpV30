# Checklist de vérification UI — Modifs mars 2025 (prospup.work)

À utiliser après déploiement sur **https://prospup.work** pour valider les correctifs avec un ou plusieurs agents (manuel ou E2E).

**Connexion** : identifiants de test (ex. admin/admin selon config).

---

## 1. Bouton « Ajout KPI manuel » (placement)

**Page** : [Dashboard](https://prospup.work/dashboard)

- [ ] Le bouton **« ➕ Ajout KPI manuel »** est visible.
- [ ] Il est placé **directement sous la ligne des cartes KPI** (Contacts aujourd’hui, Notes d’appel, etc.), pas dans un bloc flottant plus bas.
- [ ] Il est aligné à **droite** de cette zone.
- [ ] Un clic ouvre bien la modale « Ajouter une action KPI manuellement ».

---

## 2. Boutons « Voir » en orange

**Pages** : Dashboard, Prospects (index)

**Dashboard** :

- [ ] La bannière d’alerte « ▲ X relances en retard » (si affichée) contient un lien **« Voir Focus → »**.
- [ ] Ce lien a un **style bouton orange** (fond dégradé orange, texte blanc), pas violet/rose.

**Prospects** ([/](https://prospup.work/)) :

- [ ] Dans le tableau, la colonne **ACTIONS** affiche un bouton **« 👁️ Voir »** par ligne.
- [ ] Ce bouton est **orange** (dégradé primary), pas gris.
- [ ] Un clic ouvre la fiche détail du prospect.

---

## 3. Tags statut (style général de l’app)

**Page** : [Prospects](https://prospup.work/)

- [ ] La colonne **STATUT** affiche des pastilles (ex. « Pas d’actions », « À rappeler », etc.).
- [ ] Les pastilles ont un style **discret / glass** : bords arrondis, léger flou (backdrop), bordure fine, pas de blocs de couleur très durs.
- [ ] En mode sombre, les couleurs restent lisibles mais moins « criardes ».

---

## 4. Jours agrandissables dans le calendrier

**Page** : [Calendrier](https://prospup.work/calendrier)

- [ ] Vue **Mois** affichée.
- [ ] Un jour avec au moins un événement est visible (sinon naviguer vers un mois avec des RDV/relances).
- [ ] **Clic sur la zone du jour** (hors lien d’un événement) ouvre une **modale** « Détails — [date] ».
- [ ] La modale liste **tous les événements** de ce jour (nom, entreprise, type, heure si présente).
- [ ] Chaque ligne est cliquable (lien vers la fiche prospect ou l’action).
- [ ] Le lien **« +X autre(s) »** sur un jour avec plus de 3 événements ouvre la **même modale** (tous les événements du jour).
- [ ] La modale se ferme avec le **bouton ×**, un **clic sur le fond** (overlay) ou la touche **Escape**.

---

## 5. Réduction de la barre de navigation gauche

**Contexte** : Desktop (fenêtre large). Sur mobile le bouton reste masqué.

- [ ] Sur **n’importe quelle page** (Dashboard, Prospects, Calendrier, etc.), la **barre latérale gauche** est visible.
- [ ] **En haut de cette barre**, un **bouton avec le symbole « « »** (chevron) est visible.
- [ ] Au survol, le titre du bouton est du type « Réduire / Agrandir le menu ».
- [ ] Un **clic** réduit la barre (icônes seules, étroite) et le chevron devient **« » »**.
- [ ] Un second clic redéploie la barre.
- [ ] Après rafraîchissement de la page, l’état (réduit / étendu) est **conservé**.

---

## 6. Cohérence de la barre de navigation sur toutes les pages

Vérifier que la **même** barre latérale (structure + bouton réduire) est présente sur les pages suivantes :

- [ ] [Dashboard](https://prospup.work/dashboard)
- [ ] [Prospects](https://prospup.work/)
- [ ] [Entreprises](https://prospup.work/entreprises)
- [ ] [Focus](https://prospup.work/focus)
- [ ] [Calendrier](https://prospup.work/calendrier)
- [ ] [Sourcing](https://prospup.work/sourcing)
- [ ] [Push](https://prospup.work/push)
- [ ] [Stats](https://prospup.work/stats)
- [ ] [Rapport](https://prospup.work/rapport)
- [ ] [Paramètres](https://prospup.work/parametres) (et sous-pages : Doublons, Snapshots, KPI, Métiers, Aide)
- [ ] [Utilisateurs](https://prospup.work/users) (si admin)

Pour chaque page : même largeur, même menu, même bouton chevron en haut (desktop).

---

## Résultat

- **Tout coché** : modifs UI mars 2025 validées sur prospup.work.
- **Échec** : noter la page et le point (ex. « Calendrier — modale ne s’ouvre pas ») et vérifier cache / version déployée.

---

---

## Option A — Lancer les tests automatisés

Dans un terminal où **Node.js et npm** sont dans le PATH (invite « Node.js command prompt » ou terminal VS Code / Cursor avec Node activé) :

```bash
cd "c:\Users\binet\Desktop\Prosp_UpV25"
set PYTHONIOENCODING=utf-8
npm run test:checklist-ui
```

Ou directement :

```bash
npx playwright test tests/e2e/checklist-ui-mars2025.spec.js --reporter=list
```

L’app doit être démarrée (ex. `python app.py`) et accessible sur http://127.0.0.1:8000. Les tests utilisent l’auth du projet (storageState) si configurée.

---

*Dernière mise à jour : mars 2025 — Correspond aux correctifs checklist UI (KPI, Voir, tags statut, calendrier détail jour, sidebar collapse).*
