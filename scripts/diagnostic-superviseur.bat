@echo off
REM Script de diagnostic pour comprendre pourquoi le superviseur ne fait pas le pull automatique

echo 🔍 Diagnostic superviseur ProspUp
echo.

REM 1. Vérifier si le superviseur tourne
echo 1. Processus superviseur :
tasklist /FI "IMAGENAME eq python.exe" /FO CSV | findstr /I "supervise_prospup app.py" >nul
if %errorlevel% equ 0 (
    echo    ✅ Le superviseur tourne probablement
    tasklist /FI "IMAGENAME eq python.exe" | findstr /I "python"
) else (
    echo    ❌ Le superviseur ne semble pas tourner
    echo    → Il faut le lancer avec: python scripts\supervise_prospup.py
)
echo.

REM 2. Vérifier l'état git
echo 2. État du dépôt git :
cd /d "%~dp0.."
for /f "tokens=2" %%b in ('git branch --show-current') do set current_branch=%%b
echo    Branche actuelle: %current_branch%

if not "%current_branch%"=="main" (
    echo    ⚠️  Vous n'êtes PAS sur main !
)

git status --short
echo.

REM 3. Vérifier si on est à jour avec origin/main
echo 3. Comparaison avec origin/main :
git fetch origin main --quiet
for /f "tokens=1" %%h in ('git rev-parse HEAD') do set local_hash=%%h
for /f "tokens=1" %%h in ('git rev-parse origin/main') do set remote_hash=%%h
set local_hash=%local_hash:~0,7%
set remote_hash=%remote_hash:~0,7%

echo    Local:  %local_hash%
echo    Remote: %remote_hash%

if "%local_hash%"=="%remote_hash%" (
    echo    ✅ Le dépôt local est à jour
) else (
    echo    ⚠️  Le dépôt local n'est PAS à jour
    echo    → Faire: git pull origin main
)
echo.

REM 4. Vérifier les logs récents
echo 4. Logs récents (si disponibles) :
if exist "logs\prospup.log" (
    echo    Dernières lignes du log :
    powershell -Command "Get-Content logs\prospup.log -Tail 20 | Select-String -Pattern 'AUTO-DEPLOY|SERVER|Deploy'"
) else (
    echo    (fichier de log introuvable)
)
echo.

echo ✅ Diagnostic terminé
pause
