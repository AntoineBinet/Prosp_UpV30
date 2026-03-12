# Prompt à donner à Cursor (ou un testeur) — Test complet nouvel utilisateur + IA

Copie-colle le bloc ci-dessous à un assistant (ex. Cursor) pour qu’il simule un **nouvel utilisateur** et valide **toutes les fonctionnalités IA** et l’**import Excel**, puis qu’il fasse un **audit** et propose le **nettoyage** des données de test.

---

## Bloc à copier

```
Tu es un testeur pour l’application Prosp'Up (CRM B2B). Simule un **nouvel utilisateur** qui découvre l’app et veut tout tester, en particulier l’IA locale (Ollama) et l’import Excel.

**Contexte technique**
- App : Flask + Vanilla JS, PWA. L’IA tourne en local via Ollama sur le PC (proxy backend : le navigateur appelle Flask, Flask appelle http://127.0.0.1:11434). Aucun appel direct du navigateur à Ollama.
- Fichier de test Excel : `tests/fixtures/fichier_prosp_test_user.xlsx` (feuille "Liste", 20 prospects, colonnes : GROUPE, FILIALE, SITE, TYPE, ACTION, NOM, PRENOM, TEL, PORTABLE, FONCTION, DATE DERNIER CONTACT, COMMENTAIRE, PROFIL RECHERCHE, MAIL, ARCHIVES, LINKEDIN).
- Identifiants par défaut : admin / admin (ou ceux définis par PROSPUP_USER / PROSPUP_PASS).

**Scénario à simuler (dans l’ordre)**

1. **Démarrage**
   - Lancer l’app (python app.py), ouvrir http://127.0.0.1:8000, se connecter.
   - Vérifier que la page Prospects (accueil) s’affiche.

2. **Import Excel (nouvel utilisateur avec fichier)**
   - Cliquer sur « Importer ma liste ».
   - Choisir l’onglet « Fichier Excel » et sélectionner le fichier `tests/fixtures/fichier_prosp_test_user.xlsx` (ou le chemin équivalent sur la machine).
   - Si plusieurs feuilles : choisir la feuille « Liste » puis « Utiliser cette feuille ».
   - **Mapping** : vérifier que les suggestions automatiques mappent au moins : GROUPE → Entreprise, SITE → Site, NOM → Nom, PRENOM → Prénom, TEL et PORTABLE → Téléphone, FONCTION → Fonction, MAIL → Email, COMMENTAIRE → Notes, LINKEDIN → LinkedIn, ACTION → Statut, DATE DERNIER CONTACT → Date dernier contact.
   - (Si Ollama est démarré) Cliquer « Suggérer le mapping avec Ollama » et vérifier que les listes déroulantes sont pré-remplies de façon cohérente.
   - Cliquer « Aperçu » : vérifier environ 20 prospects, noms en « Prénom Nom », téléphones éventuellement « tel ; portable », statut et date dernier contact remplis.
   - Cliquer « Importer » : vérifier le toast de succès et que la liste des prospects affiche les lignes importées (entreprises type Framatome, BIOMERIEUX, etc.).

3. **Fonctions IA (Ollama local) — à vérifier une par une**
   - **Scrapping IA (prospect)** : sur une ligne prospect, cliquer « Scrapping IA ». Vérifier toast « Génération en cours (Ollama)… », puis ouverture d’une modale avec le texte généré et boutons Accepter / Ignorer. Si Ollama est éteint : modale vide + message invitant à coller manuellement.
   - **Scrapping IA (entreprise)** : ouvrir une fiche entreprise (depuis une fiche prospect ou la page Entreprises), cliquer « Scrapping IA ». Même comportement que pour le prospect.
   - **Scrapping IA (candidat)** : aller sur la page Candidats, ouvrir un candidat, cliquer « Scrapping IA ». Même logique (Ollama ou collage manuel).
   - **Bulk IA** : sur la page Prospects, sélectionner plusieurs prospects, cliquer « Email IA » ou « Tel IA ». Dans la modale, cliquer « Générer avec Ollama ». Vérifier que la zone résultat se remplit et que l’étape 2 (tableau) s’affiche.
   - **Ajout IA (Quick Add)** : cliquer « Ajout IA », choisir un type (Prospect, Entreprise ou Candidat), cliquer « Générer avec Ollama (un seul) ». Vérifier que l’étape paste est pré-remplie et que l’analyse mène à l’aperçu puis à la création.
   - **Après réunion IA** : sur un prospect avec statut type Rendez-vous, ouvrir la fiche, onglet RDV si présent, cliquer « Après réunion IA ». Vérifier génération Ollama puis modale avec JSON pré-rempli et bouton Appliquer.
   - **Import liste — Reformater** : rouvrir « Importer ma liste », refaire un import (ou rester en aperçu), cliquer un bouton « Reformater [champ] », dans la modale cliquer « Générer avec Ollama ». Vérifier que la zone « Résultat » est remplie.

4. **Cohérence et régression**
   - Vérifier qu’aucune des actions ci-dessus ne nécessite de copier-coller un prompt dans un outil externe : tout passe par un bouton qui appelle Ollama (ou propose de coller manuellement si Ollama est indisponible).
   - Vérifier que les toasts ne mentionnent plus « ChatGPT » / « Perplexity » comme étape obligatoire, mais « Ollama » ou « coller manuellement ».

5. **Nettoyage des données de test**
   - Après les tests, supprimer les prospects et entreprises créés pendant la session (sélection multiple + suppression, ou restauration d’un snapshot), ou documenter la procédure pour l’utilisateur (ex. « Supprimer les X prospects importés depuis l’Excel de test »).
   - Si un utilisateur dédié (ex. test_import) a été utilisé, indiquer comment supprimer ou réinitialiser ses données.

**Livrable attendu**
- Résumé : quelles étapes ont été exécutées, ce qui a fonctionné, ce qui a échoué (et pourquoi, ex. Ollama non démarré).
- Liste des régressions éventuelles (flux cassé, texte incohérent).
- Procédure de nettoyage retenue pour les données de test.
```

---

## Usage

1. Ouvrir l’app (et Ollama si tu veux tester les flux IA).
2. Copier tout le contenu du **Bloc à copier** (entre les triples backticks) dans un chat Cursor (ou autre assistant).
3. L’assistant te guidera ou décrira les étapes à faire manuellement ; il peut aussi rédiger un rapport à partir de tes retours après exécution.
4. Pour un test E2E automatisé (sans IA dans le test), utiliser : `npx playwright test import-excel.spec.js` (voir `docs/PLAN_TEST_IMPORT_EXCEL.md`).
