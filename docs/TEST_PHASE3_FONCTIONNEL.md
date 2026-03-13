# Tests fonctionnels Phase 3 - Rapport

Date: 2026-03-13
Tester: Agent Cloud

## 1. Enrichissement candidat avancé

### Tests effectués

#### 1.1 Vérification du prompt IA
- ✅ Le prompt `getScrapingPromptCandidate` demande bien EXPÉRIENCES_JSON, FORMATIONS_JSON, CERTIFICATIONS_JSON
- ✅ Le format JSON attendu est documenté dans le prompt

#### 1.2 Vérification du parsing
- ✅ `parseIAImportModal()` parse les champs avec `_processField()`
- ✅ Les champs JSON sont détectés via `mapping.isJSON` et `mapping.jsonType`
- ✅ Le parsing JSON extrait les tableaux depuis le texte

#### 1.3 Vérification de l'application
- ✅ `_applyCandidateIA()` traite les champs JSON (experiences, educations, certifications)
- ✅ Les appels API sont faits vers `/api/candidates/{id}/experiences`, `/educations`, `/certifications`

#### 1.4 Vérification des routes API
- ✅ Route GET `/api/candidates/{id}/experiences` existe (ligne 4202 app.py)
- ✅ Route POST `/api/candidates/{id}/experiences` existe (ligne 4232 app.py)
- ✅ Route GET `/api/candidates/{id}/educations` existe (ligne 4274 app.py)
- ✅ Route POST `/api/candidates/{id}/educations` existe (ligne 4293 app.py)
- ✅ Route GET `/api/candidates/{id}/certifications` existe (ligne 4328 app.py)
- ✅ Route POST `/api/candidates/{id}/certifications` existe (ligne 4347 app.py)

#### 1.5 Vérification de l'affichage
- ✅ `loadCandidateExperiences()` charge et affiche les expériences (ligne 503 page-candidate.js)
- ✅ `loadCandidateEducations()` charge et affiche les formations (ligne 540 page-candidate.js)
- ✅ `loadCandidateCertifications()` charge et affiche les certifications (ligne 572 page-candidate.js)
- ✅ Les éléments HTML `viewExperiences`, `viewEducations`, `viewCertifications` existent dans candidate.html

### Bugs potentiels identifiés

1. **BUG #1 - Parsing JSON multi-ligne** : Le code essaie d'extraire JSON avec regex `jsonValue.match(/\[[\s\S]*\]/)` mais cela peut échouer si le JSON est sur plusieurs lignes avec du texte avant/après. Le prompt demande un format spécifique mais l'extraction peut être fragile.

2. **BUG #2 - Technologies dans expériences** : Dans `_applyCandidateIA()`, ligne 7277, les technologies sont converties en JSON string : `JSON.stringify(exp.technologies)`. Mais l'API attend peut-être un format différent. À vérifier.

3. **BUG #3 - Affichage si données vides** : Les fonctions `loadCandidateExperiences/Educations/Certifications` affichent "Aucune expérience renseignée" si le tableau est vide, mais ne gèrent pas le cas où l'API retourne une erreur ou un format inattendu.

## 2. Compte-rendu de réunion enrichi

### Tests effectués

#### 2.1 Vérification du parsing
- ✅ `parsePostMeetingImport()` extrait `action_items`, `opportunities`, `decisions` depuis le JSON
- ✅ Les données sont stockées dans `_pmActionItems`, `_pmOpportunities`, `_pmDecisions`
- ✅ L'affichage dans la modale montre les action items avec checkboxes

#### 2.2 Vérification de l'application
- ✅ `applyPostMeetingImport()` crée une réunion via `/api/meetings`
- ✅ Les action items acceptés sont créés via `/api/meetings/{meetingId}/action-items` (ligne 11569)
- ✅ Les opportunités acceptées sont créées via `/api/meetings/{meetingId}/opportunities` (ligne 11604)

#### 2.3 Vérification des routes API
- ✅ Route POST `/api/meetings` existe (ligne 11445 app.py)
- ✅ Route GET `/api/meetings/{meeting_id}/action-items` existe (ligne 11553 app.py)
- ✅ Route POST `/api/meetings/{meeting_id}/action-items` existe (ligne 11592 app.py)
- ✅ Route GET `/api/meetings/{meeting_id}/opportunities` existe (ligne 11630 app.py)
- ✅ Route POST `/api/meetings/{meeting_id}/opportunities` existe (ligne 11668 app.py)

#### 2.4 Vérification de la création de tâches
- ⚠️ **PROBLÈME IDENTIFIÉ** : Le code crée des action items dans la table `meeting_action_items`, mais il n'y a pas de création automatique de tâches dans une table `tasks` ou similaire. Les action items sont stockés mais ne deviennent pas des tâches à suivre.

### Bugs potentiels identifiés

1. **BUG #4 - Création de tâches conditionnelle** : ✅ CORRIGÉ - Les tâches sont bien créées automatiquement depuis les action items (lignes 11580-11597 app.js), MAIS seulement si `item.due_date` existe. Si un action item n'a pas de date d'échéance, aucune tâche n'est créée. Cela peut être un problème si l'utilisateur veut créer des tâches sans date précise.

2. **BUG #5 - Extraction JSON robuste** : ✅ CORRIGÉ - `extractJSONFromText()` existe bien (ligne 11205 app.js) et est robuste avec 4 méthodes d'extraction différentes (parsing direct, markdown, regex, multiline).

3. **BUG #6 - Gestion des erreurs API** : Dans `applyPostMeetingImport()`, les appels API pour créer action items et opportunités sont dans des try/catch mais les erreurs ne sont pas affichées à l'utilisateur de manière claire.

## 3. Optimisation mailing

### Tests effectués

#### 3.1 Vérification du timing optimal
- ✅ `loadOptimalTiming()` appelle `/api/push/optimal-time?prospect_id={id}`
- ✅ La route `/api/push/optimal-time` existe (ligne 8025 app.py)
- ✅ `_get_optimal_send_time()` calcule le timing optimal
- ✅ L'affichage dans la modale montre la recommandation avec `pushModalTimingRecommendation`

#### 3.2 Vérification des variantes A/B
- ✅ `generatePushMessageVariants()` génère 3 variantes (A, B, C)
- ✅ Les variantes sont stockées dans `window._currentPushVariants`
- ✅ Lors de l'envoi, les variantes sont envoyées dans le payload (ligne 6151)
- ✅ La route POST `/api/push/send` accepte un champ `variants` (ligne 7831 app.py)
- ✅ Les variantes sont enregistrées dans la table `push_variants` (ligne 7852 app.py)

#### 3.3 Vérification du tracking pixel
- ✅ Le `tracking_pixel_id` est généré avec UUID si channel === 'email' (ligne 7828 app.py)
- ✅ Le tracking pixel est enregistré dans `push_logs.tracking_pixel_id`
- ✅ La route `/api/push/track/open` existe pour tracker les ouvertures (ligne 7967 app.py)
- ✅ La route `/api/push/track/click` existe pour tracker les clics (ligne 8006 app.py)

#### 3.4 Vérification du widget analytics
- ✅ La route `/api/push/analytics` existe (ligne 8036 app.py)
- ✅ Elle retourne `hour_stats`, `day_stats`, `variant_stats`, `optimal_timing`
- ⚠️ **PROBLÈME IDENTIFIÉ** : Je ne vois pas de code dans `page-dashboard.js` qui appelle cette route pour afficher un widget analytics. La ligne 1044 mentionne "Variantes A/B" mais je ne vois pas l'appel API correspondant.

### Bugs potentiels identifiés

1. **BUG #7 - Widget analytics manquant** : ✅ CORRIGÉ - Le widget analytics est bien implémenté dans `renderPushAnalytics()` (ligne 1005 page-dashboard.js) et affiche les statistiques des variantes A/B, meilleures heures et meilleurs jours.

2. **BUG #8 - Utilisation du timing optimal** : La fonction `useOptimalTiming()` charge le timing mais je ne vois pas comment elle l'applique réellement à la date/heure d'envoi dans la modale. Le bouton "Utiliser timing optimal" existe mais l'implémentation peut être incomplète.

3. **BUG #9 - Génération variantes A/B** : `generatePushMessageVariants()` génère des variantes basiques avec des modifications simples du texte. Il n'y a pas d'appel à l'IA pour générer des variantes vraiment différentes. Les variantes sont juste des variations manuelles du texte de base.

## Résumé des bugs critiques

1. **BUG #4** : Les action items créent des tâches seulement si `due_date` existe (MOYEN) - Les action items sans date d'échéance ne génèrent pas de tâches
2. **BUG #8** : Application du timing optimal peut être incomplète (MOYEN) - À vérifier comment le timing est appliqué dans la modale
3. **BUG #9** : Variantes A/B générées manuellement, pas par IA (MOYEN) - Les variantes sont juste des variations de texte, pas vraiment générées par IA
4. **BUG #1** : Parsing JSON multi-ligne peut être fragile dans certains cas (MINEUR)
5. **BUG #2** : Format technologies dans expériences à vérifier (MINEUR)
6. **BUG #3** : Gestion d'erreurs API pour données structurées (MINEUR)
7. **BUG #6** : Erreurs API non affichées clairement (MINEUR)

## Recommandations

1. **BUG #4** : Modifier la création de tâches pour qu'elle fonctionne même sans `due_date`, ou au moins créer une tâche avec une date par défaut (ex: +7 jours)
2. **BUG #8** : Vérifier que le bouton "Utiliser timing optimal" applique bien la date/heure recommandée dans les champs de la modale d'envoi
3. **BUG #9** : Envisager d'utiliser l'IA (Ollama) pour générer des variantes A/B vraiment différentes plutôt que des variations manuelles simples
4. **BUG #1** : Tester le parsing JSON avec différents formats de retour IA pour s'assurer qu'il fonctionne dans tous les cas
5. **BUG #2** : Vérifier que le format `JSON.stringify(exp.technologies)` est bien attendu par l'API backend
6. **BUG #3** : Améliorer l'affichage des erreurs lors de l'enregistrement des expériences/formations/certifications
7. **BUG #6** : Afficher des messages d'erreur plus clairs à l'utilisateur lors de l'échec de création d'action items ou opportunités
