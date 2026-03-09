# Plan de test — Import Excel (nouvel utilisateur)

## Fichier de test

- **Fixture E2E** : `tests/fixtures/fichier_prosp_test_user.xlsx` (copie de « fichier prosp test user (1).xlsx »).
- **Contenu** : feuille « Liste », 20 lignes de prospects, colonnes : GROUPE, FILIALE, SITE, TYPE, ACTION, NOM, PRENOM, TEL, PORTABLE, FONCTION, DATE DERNIER CONTACT, COMMENTAIRE, PROFIL RECHERCHE, MAIL, ARCHIVES, LINKEDIN.

## Scénario manuel à valider

1. Se connecter (ex. admin / mot de passe configuré).
2. Aller sur la page Prospects (accueil).
3. Cliquer sur **« Importer ma liste »**.
4. Onglet **Fichier Excel** : choisir le fichier `tests/fixtures/fichier_prosp_test_user.xlsx` (ou le fichier source depuis Téléchargements).
5. Si plusieurs feuilles : sélectionner la feuille **« Liste »** puis **« Utiliser cette feuille »**.
6. **Étape Mapping** : vérifier que les suggestions automatiques donnent au moins :
   - GROUPE → Entreprise  
   - SITE → Site  
   - NOM → Nom  
   - PRENOM → Prénom  
   - TEL → Téléphone  
   - PORTABLE → Téléphone  
   - FONCTION → Fonction  
   - MAIL → Email  
   - COMMENTAIRE → Notes  
   - LINKEDIN → LinkedIn  
   - ACTION → Statut  
   - DATE DERNIER CONTACT → Date dernier contact  
7. (Optionnel) Cliquer **« Suggérer le mapping avec Ollama »** : les listes déroulantes doivent se remplir de façon cohérente.
8. Cliquer **« Aperçu »** : vérifier **20 prospect(s)** à importer, noms en « Prénom Nom », téléphones éventuellement « tel ; portable », statut et date dernier contact renseignés.
9. Cliquer **« Importer »** : message de succès, liste des prospects mise à jour.
10. Vérifications : au moins une entreprise (ex. Framatome), fiches avec email, fonction, date dernier contact et statut corrects.

## Nettoyage des données de test

- **Test manuel** : après validation, supprimer les prospects importés (sélection multiple + suppression) et les entreprises devenues orphelines si besoin, ou restaurer un snapshot.
- **Test E2E** : le test Playwright (`tests/e2e/import-excel.spec.js`) ne supprime pas les données après l’import. Pour repartir d’une base propre, utiliser un utilisateur dédié (ex. `test_import`) et réinitialiser sa base, ou exécuter les tests sur une copie de la DB.

## Test E2E automatisé

```bash
npx playwright test import-excel.spec.js
```

Le test : ouvre la modale d’import, envoie le fichier fixture, attend l’étape mapping, clique sur Aperçu puis Importer, et vérifie le toast de succès et la présence de lignes dans le tableau.

## Cohérence avec les fonctions IA

- L’import réutilise **Ollama** pour :
  - **Suggérer le mapping** (bouton « Suggérer le mapping avec Ollama »).
  - **Reformater** une colonne (boutons « Reformater X » dans l’aperçu).
- Le flux fonctionne **sans Ollama** : mapping manuel uniquement, pas d’appel obligatoire à l’IA.
