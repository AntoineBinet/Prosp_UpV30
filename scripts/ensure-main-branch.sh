#!/bin/bash
# Script helper pour s'assurer qu'on est sur main avant de pousser
# Usage: ./scripts/ensure-main-branch.sh

current_branch=$(git branch --show-current)

if [ "$current_branch" != "main" ]; then
    echo "⚠️  ATTENTION: Vous êtes sur la branche '$current_branch', pas sur 'main'"
    echo "   Pour basculer sur main: git checkout main"
    exit 1
fi

echo "✅ Vous êtes sur la branche 'main'"
exit 0
