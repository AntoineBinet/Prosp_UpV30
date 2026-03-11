# Plan d'optimisation — Arrivée d'un nouvel utilisateur

## Objectifs
1. **Optimiser l'import Excel** pour nouveaux utilisateurs avec formats variés et données parfois peu pertinentes
2. **Nettoyer les données de test** (utilisateurs fictifs)
3. **Garantir l'isolation des données** lors de la suppression d'utilisateurs
4. **Gérer correctement les données collaboratives** lors de la suppression

---

## 1. Optimisation de l'import Excel pour nouveaux utilisateurs

### 1.1 Améliorer le mapping automatique avec Ollama
**État actuel** : 
- `_guessMapping()` fait une détection basique par regex
- `suggestImportListMappingWithOllama()` suggère le mapping via Ollama mais peut être amélioré

**Améliorations** :
- ✅ **Enrichir le prompt Ollama** avec des exemples de formats variés et des variantes d'en-têtes courantes
- ✅ **Ajouter une étape de validation intelligente** : après le mapping suggéré, Ollama peut analyser quelques lignes d'exemple pour confirmer la pertinence
- ✅ **Détection automatique de colonnes multiples** pour le même champ (ex. TEL + PORTABLE → téléphone)
- ✅ **Nettoyage automatique des données** : proposer un bouton "Nettoyer les données avec Ollama" qui normalise les formats (téléphones, emails, dates, noms)

### 1.2 Améliorer le reformatage avec Ollama
**État actuel** : 
- `runImportListReformatWithOllama()` reformate une colonne à la fois

**Améliorations** :
- ✅ **Reformatage multi-colonnes** : permettre de sélectionner plusieurs colonnes à nettoyer en une fois
- ✅ **Détection automatique des problèmes** : Ollama analyse l'aperçu et suggère quelles colonnes ont besoin de nettoyage
- ✅ **Normalisation intelligente** :
  - Téléphones : formats variés → format standard (06 12 34 56 78)
  - Emails : validation et nettoyage
  - Dates : formats variés → format ISO
  - Noms : capitalisation correcte
  - Entreprises : dédoublonnage intelligent

### 1.3 Guide d'import amélioré pour nouveaux utilisateurs
**Nouveau** :
- ✅ **Assistant d'import pas à pas** : si l'utilisateur n'a pas encore de données, afficher un guide interactif
- ✅ **Détection de formats Excel courants** : analyser le fichier et proposer un template de mapping pré-rempli
- ✅ **Suggestions contextuelles** : "Il semble que vous ayez des colonnes pour téléphone et email, voulez-vous que je les nettoie ?"

---

## 2. Nettoyage des données de test

### 2.1 Script de nettoyage des utilisateurs de test
**Nouveau** :
- ✅ **Script admin** : `python scripts/cleanup_test_users.py`
  - Liste tous les utilisateurs
  - Identifie les utilisateurs de test (critères : username contient "test", "demo", "fake", ou créé récemment avec peu de données)
  - Affiche un résumé et demande confirmation
  - Supprime les utilisateurs et leurs données

### 2.2 Endpoint admin pour nettoyage
**Nouveau** :
- ✅ **Route `/api/admin/cleanup-test-users`** : 
  - Liste les utilisateurs suspects (test/demo/fake dans username, ou créés il y a moins de 7 jours avec < 5 prospects)
  - Permet de supprimer en masse avec confirmation

---

## 3. Isolation des données lors de la suppression d'utilisateurs

### 3.1 Améliorer `/api/users/delete`
**État actuel** :
- Supprime l'entrée dans `users`
- Supprime le dossier `data/user_<id>` (peut échouer si DB verrouillée)
- ❌ **Ne nettoie PAS les données collaboratives**

**Améliorations** :
- ✅ **Nettoyer `shared_companies`** :
  - Supprimer toutes les entrées où `from_user_id = uid` (partages envoyés)
  - Supprimer toutes les entrées où `to_user_id = uid` (partages reçus)
  - Pour les partages reçus : supprimer les données copiées dans la DB de l'utilisateur supprimé (entreprises et prospects partagés)
  - Pour les partages envoyés : **garder les données dans la DB du collaborateur** (l'utilisateur supprimé disparaît de l'espace collab, mais les données restent au collaborateur)

- ✅ **Nettoyer les autres tables liées** :
  - `audit_log` : supprimer les logs de l'utilisateur
  - `refresh_tokens` : supprimer les tokens de l'utilisateur
  - `saved_views` : supprimer les vues sauvegardées (déjà géré par `owner_id`)
  - `tasks` : supprimer les tâches (déjà géré par `owner_id`)

- ✅ **Améliorer la suppression du dossier** :
  - Retry avec délai si fichier verrouillé
  - Marquer pour suppression au prochain redémarrage si échec

### 3.2 Vérification de l'isolation
**Nouveau** :
- ✅ **Test d'isolation** : vérifier qu'aucune donnée d'un utilisateur n'est accessible après suppression
- ✅ **Logs de suppression** : enregistrer dans `audit_log` (avant suppression) ce qui a été supprimé

---

## 4. Gestion des données collaboratives

### 4.1 Comportement attendu
**Règles** :
1. **Si l'utilisateur A supprime son compte** :
   - Les entreprises qu'il a partagées avec B restent dans la DB de B (B garde les données)
   - Les entrées `shared_companies` où `from_user_id = A` sont supprimées (B ne voit plus A dans ses collaborateurs)
   - Les entreprises que B a partagées avec A sont supprimées de la DB de A (mais A n'existe plus, donc pas de problème)
   - Les entrées `shared_companies` où `to_user_id = A` sont supprimées

2. **Si l'utilisateur A supprime son compte et qu'un admin veut récupérer ses données** :
   - Nouveau endpoint `/api/admin/export-user-data` : exporter toutes les données d'un utilisateur avant suppression
   - Option dans l'UI admin : "Exporter les données avant suppression"

### 4.2 Améliorer `_sync_shared_company_to_collaborator`
**État actuel** : 
- Copie l'entreprise et ses prospects dans la DB du collaborateur
- Utilise le même `company_id` (peut créer des conflits)

**Améliorations** :
- ✅ **Gérer les conflits d'ID** : si `company_id` existe déjà dans la DB du collaborateur, créer une nouvelle entreprise avec un ID différent
- ✅ **Marquer les entreprises partagées** : ajouter un champ `shared_from_user_id` pour tracer l'origine

---

## 5. Plan d'implémentation

### Phase 1 : Isolation et nettoyage (priorité haute)
1. ✅ Améliorer `/api/users/delete` pour nettoyer `shared_companies`
2. ✅ Ajouter nettoyage des autres tables (`audit_log`, `refresh_tokens`)
3. ✅ Améliorer la suppression du dossier avec retry
4. ✅ Script de nettoyage des utilisateurs de test

### Phase 2 : Optimisation import Excel (priorité moyenne)
1. ✅ Enrichir le prompt Ollama pour le mapping
2. ✅ Ajouter détection automatique des problèmes de données
3. ✅ Améliorer le reformatage multi-colonnes
4. ✅ Guide d'import pour nouveaux utilisateurs

### Phase 3 : Export données avant suppression (priorité basse)
1. ✅ Endpoint `/api/admin/export-user-data`
2. ✅ UI admin pour exporter avant suppression

---

## 6. Tests à effectuer

### Tests d'isolation
- [ ] Créer 2 utilisateurs A et B
- [ ] A partage une entreprise avec B
- [ ] B partage une entreprise avec A
- [ ] Supprimer A
- [ ] Vérifier que B garde ses données et l'entreprise partagée par A
- [ ] Vérifier que A n'apparaît plus dans les collaborateurs de B
- [ ] Vérifier que les données de A sont bien supprimées

### Tests d'import Excel
- [ ] Tester avec un fichier Excel avec formats variés
- [ ] Vérifier que le mapping Ollama fonctionne bien
- [ ] Tester le nettoyage automatique des données
- [ ] Vérifier que les données importées sont bien isolées par utilisateur

### Tests de nettoyage
- [ ] Créer des utilisateurs de test
- [ ] Exécuter le script de nettoyage
- [ ] Vérifier que seuls les utilisateurs de test sont supprimés

---

## 7. Fichiers à modifier

### Backend (`app.py`)
- `api_users_delete()` : améliorer nettoyage
- Nouveau : `api_admin_cleanup_test_users()`
- Nouveau : `api_admin_export_user_data()`
- `_sync_shared_company_to_collaborator()` : améliorer gestion conflits

### Frontend (`static/js/app.js`)
- `suggestImportListMappingWithOllama()` : enrichir prompt
- `runImportListReformatWithOllama()` : améliorer reformatage
- Nouveau : assistant d'import pour nouveaux utilisateurs
- Nouveau : détection automatique des problèmes de données

### Nouveaux fichiers
- `scripts/cleanup_test_users.py` : script de nettoyage
- `docs/PLAN_OPTIMISATION_NOUVEL_UTILISATEUR.md` : ce document

---

## 8. Notes importantes

- **Isolation stricte** : Un utilisateur ne doit jamais voir les données d'un autre utilisateur, sauf via l'espace collaboratif explicite
- **Données collaboratives** : Quand un utilisateur supprime son compte, les données qu'il a partagées restent chez le collaborateur, mais il disparaît de l'espace collab
- **Export avant suppression** : Si un admin veut récupérer les données d'un utilisateur avant suppression, utiliser l'endpoint d'export
- **Tests** : Toujours tester avec des utilisateurs fictifs avant de supprimer des vrais utilisateurs
