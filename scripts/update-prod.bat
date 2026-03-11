@echo off
REM Script simple pour mettre à jour prospup.work depuis le PC qui héberge (Windows)
REM Usage: scripts\update-prod.bat

echo 🔄 Mise à jour ProspUp en production...
echo.

REM Vérifier qu'on est dans un dépôt git
if not exist .git (
    echo ❌ Erreur: Ce n'est pas un dépôt git
    exit /b 1
)

REM Vérifier qu'on est sur main
for /f "tokens=2" %%b in ('git branch --show-current') do set current_branch=%%b
if not "%current_branch%"=="main" (
    echo ⚠️  Vous êtes sur '%current_branch%', basculement sur 'main'...
    git checkout main
    if errorlevel 1 exit /b 1
)

REM Pull depuis origin/main
echo 📥 Récupération des changements depuis origin/main...
git fetch origin main
git pull origin main

if errorlevel 1 (
    echo.
    echo ❌ Erreur lors du pull
    exit /b 1
)

echo.
echo ✅ Mise à jour réussie !
echo.
echo Le superviseur devrait redémarrer automatiquement le serveur.
echo Si ce n'est pas le cas, redémarrez manuellement avec:
echo   python scripts\supervise_prospup.py
