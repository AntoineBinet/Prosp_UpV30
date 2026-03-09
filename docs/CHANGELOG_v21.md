# Changelog v21 (en cours)

## Étape 1 — Mode Prosp mobile (défilement + reprise)

- Stabilisation de l’ordre de session Prosp pour éviter les retours en arrière après mise à jour de statut ou rafraîchissement de la liste.
- Sauvegarde/reprise de session enrichie (`sessionStorage`) avec métadonnées de scroll et fallback de reprise par `lastContact`.
- Correction de la conservation de position de liste sur mobile (capture/restitution du scroll).
- Réinitialisation du scroll de la fiche détail lors du passage au prospect suivant.
- Renforcement backend : lors d’un changement de statut via `/api/save`, `lastContact` est auto-mis à jour si la date n’est pas explicitement modifiée.

## Étape 2 — Revue visuelle desktop/mobile (harmonisation)

- Harmonisation des CTA lien/bouton avec une classe commune `btn-link-inline` pour éviter les styles inline dispersés.
- Amélioration de lisibilité des tableaux Sourcing (rôle/localisation/tech) via cellules clampées et titres complets au survol.
- Uniformisation des actions de lignes (`table-actions-inline`) pour un alignement cohérent desktop/mobile.
- Ajout d’un rendu mobile en cartes pour les tableaux critiques de `Sourcing`, `Push` et `Stats` afin d’éliminer les débordements sur petits écrans.
- Amélioration légère du feedback login (préfixe visuel sur erreurs).

## Étape 3 — Isolation multi-utilisateur (owner_id)

- Renforcement des endpoints sensibles côté backend (`push-logs`, `candidate-push`, `ec1-checklist`, `ia-enrichment-log`, `dashboard`, `stats`, `company/full`) avec contrôles d’appartenance et filtres `owner_id`.
- Durcissement des requêtes `saved_views` et `tasks` en mode strict `owner_id=?` (suppression du fallback `owner_id IS NULL`).
- Correction des mises à jour prospect côté actions rapides/photo pour inclure `owner_id` en clause SQL (défense en profondeur).
- Validation E2E terminal multi-comptes (admin + 2 utilisateurs) : création, lecture et écriture inter-utilisateur bloquées.

## Étape 4 — Nettoyage dépôt et préparation v21

- Nettoyage des artefacts non métier trackés (`prospects.db-wal`, `prospects.db-shm`, `__pycache__/*.pyc`) pour un dépôt plus propre.
- Ajout d’un `.gitignore` projet (`.venv`, `__pycache__`, `*.pyc`, `*.db-wal`, `*.db-shm`, `.secret_key`).
- Passage de la version applicative API en `21.0`.
- Mise à jour de la documentation de présentation (`README`) pour expliciter le livrable v21 et la structure utile du dossier.
