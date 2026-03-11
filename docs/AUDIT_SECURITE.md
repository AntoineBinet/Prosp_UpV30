# Audit cybersécurité — Prosp'Up

**Date :** mars 2025  
**Contexte :** application Flask exposée en permanence via Cloudflare Tunnel (prospup.work) sur PC personnel.

## Correctifs appliqués

1. **XSS sidebar (app.js)**  
   - `display_name` et `username` dans le badge utilisateur sont désormais échappés (`escapeHtml`) avant injection dans le DOM.

2. **Erreurs 500 (app.py api_save)**  
   - En production, le message renvoyé au client est générique (« Erreur lors de l'enregistrement ») ; le détail et la traceback restent en mode TESTING uniquement.

3. **Path traversal (api_serve_push_file)**  
   - Vérification que le chemin résolu du fichier est bien sous `pushs_root` (y compris sous Windows).
   - Rejet explicite de `\` et `/` dans le nom de fichier en plus de `..`.

4. **Lien Aide (parametres.html)**  
   - Lien unifié vers `/help` (au lieu de `/aide`) pour cohérence avec la sidebar.

5. **Modales (sourcing.html)**  
   - Boutons de fermeture : classe `close-btn` remplacée par `modal-close` (classe définie dans style.css) + `aria-label="Fermer"`.

## Recommandations restantes (non appliquées)

- **Rate limit login :** utiliser l’en-tête `CF-Connecting-IP` (Cloudflare) si disponible pour limiter par IP réelle ; envisager un stockage persistant des tentatives.
- **CORS :** pour les réponses avec `Authorization: Bearer`, restreindre `Access-Control-Allow-Origin` à une liste d’origines au lieu de `*` si l’app mobile a un domaine fixe.
- **CSP :** à moyen terme, remplacer `'unsafe-inline'` par des nonces/hashes pour scripts et styles.
- **Compte admin par défaut :** forcer le changement du mot de passe au premier login ou désactiver le seed en production.
- **Dépendances :** figer les versions en production et lancer régulièrement `pip audit` (ou équivalent).

## Référence

Audit détaillé réalisé par exploration du code (app.py, app.js, routes, cookies, headers). Aucun outil externe de scan de vulnérabilités n’a été utilisé.
