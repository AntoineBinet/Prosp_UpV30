#!/bin/bash
# Script de vérification complète pour agent local Cursor
# Usage: ./verify.sh
# Exit code: 0 si tout OK, 1-6 si erreur

cd "$(dirname "$0")/.." || exit 1
python3 scripts/verify_all.py
exit $?
