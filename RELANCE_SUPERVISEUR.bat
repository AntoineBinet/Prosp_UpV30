@echo off
setlocal
cd /d "%~dp0"
title ProspUp - Relance Superviseur
echo.
echo  ============================================
echo    ProspUp - Relance avec Superviseur
echo  ============================================
echo.
echo  Le superviseur va :
echo    - Lancer le serveur Flask
echo    - Le relancer automatiquement en cas de crash
echo    - Détecter les crash loops et faire un rollback
echo.
echo  ============================================
echo.
pause

:: Vérifier Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Python absent ou pas dans le PATH.
    echo Installez Python 3.11+ : https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Lancer le superviseur
echo [INFO] Lancement du superviseur...
python scripts\supervise_prospup.py

echo.
echo [INFO] Superviseur arrete.
pause
