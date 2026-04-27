# Portfolio (marienour.work)

Squelette Flask minimal avec mise à jour Git auto via SSE et bouton de
rollback. Inspiré du système de déploiement de Prosp'Up.

## Lancement

Double-clic sur `PORTFOLIO.bat`. Le script lance :
1. le serveur Waitress sur `http://127.0.0.1:8001` (boucle de restart auto sur exit code 42),
2. le tunnel Cloudflare `mnwork` (config locale dans `~/.cloudflared/config.yml`),
3. `https://marienour.work` dans le navigateur.

## Mise à jour à distance

Connecte-toi à `https://marienour.work` (admin / admin), va sur **Paramètres**,
clique **Mettre à jour et redémarrer**.

## Identifiants

`admin / admin` par défaut (configurables via env `PORTFOLIO_USER` / `PORTFOLIO_PASS`).
