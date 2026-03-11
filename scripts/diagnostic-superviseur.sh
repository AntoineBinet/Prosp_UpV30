#!/bin/bash
# Script de diagnostic pour comprendre pourquoi le superviseur ne fait pas le pull automatique

echo "🔍 Diagnostic superviseur ProspUp"
echo ""

# 1. Vérifier si le superviseur tourne
echo "1. Processus superviseur :"
if pgrep -f "supervise_prospup.py" > /dev/null; then
    echo "   ✅ Le superviseur tourne"
    ps aux | grep -E "supervise_prospup|app.py" | grep -v grep
else
    echo "   ❌ Le superviseur ne tourne PAS"
    echo "   → Il faut le lancer avec: python scripts/supervise_prospup.py"
fi
echo ""

# 2. Vérifier l'état git
echo "2. État du dépôt git :"
cd "$(dirname "$0")/.." || exit 1
current_branch=$(git branch --show-current)
echo "   Branche actuelle: $current_branch"

if [ "$current_branch" != "main" ]; then
    echo "   ⚠️  Vous n'êtes PAS sur main !"
fi

git status --short
echo ""

# 3. Vérifier si on est à jour avec origin/main
echo "3. Comparaison avec origin/main :"
git fetch origin main --quiet
local_hash=$(git rev-parse HEAD 2>/dev/null | cut -c1-7)
remote_hash=$(git rev-parse origin/main 2>/dev/null | cut -c1-7)

echo "   Local:  $local_hash"
echo "   Remote: $remote_hash"

if [ "$local_hash" = "$remote_hash" ]; then
    echo "   ✅ Le dépôt local est à jour"
else
    echo "   ⚠️  Le dépôt local n'est PAS à jour"
    echo "   → Faire: git pull origin main"
fi
echo ""

# 4. Vérifier les logs récents du superviseur
echo "4. Logs récents (si disponibles) :"
if [ -f "logs/prospup.log" ]; then
    echo "   Dernières lignes du log :"
    tail -20 logs/prospup.log | grep -E "AUTO-DEPLOY|SERVER|Deploy" || echo "   (pas de logs récents)"
else
    echo "   (fichier de log introuvable)"
fi
echo ""

# 5. Vérifier les variables d'environnement
echo "5. Variables d'environnement du superviseur :"
echo "   PROSPUP_APP_CMD: ${PROSPUP_APP_CMD:-python app.py --production (défaut)}"
echo "   Note: Le pull automatique a été désactivé. Utilisez le bouton dans les paramètres."
echo ""

echo "✅ Diagnostic terminé"
