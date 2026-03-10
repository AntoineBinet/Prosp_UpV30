#!/bin/bash
# Script simple pour mettre à jour prospup.work depuis le PC qui héberge
# Usage: ./scripts/update-prod.sh

echo "🔄 Mise à jour ProspUp en production..."
echo ""

# Vérifier qu'on est dans un dépôt git
if [ ! -d .git ]; then
    echo "❌ Erreur: Ce n'est pas un dépôt git"
    exit 1
fi

# Vérifier qu'on est sur main
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
    echo "⚠️  Vous êtes sur '$current_branch', basculement sur 'main'..."
    git checkout main || exit 1
fi

# Pull depuis origin/main
echo "📥 Récupération des changements depuis origin/main..."
git fetch origin main
git pull origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Mise à jour réussie !"
    echo ""
    echo "Le superviseur devrait redémarrer automatiquement le serveur."
    echo "Si ce n'est pas le cas, redémarrez manuellement avec:"
    echo "  python scripts/supervise_prospup.py"
else
    echo ""
    echo "❌ Erreur lors du pull"
    exit 1
fi
