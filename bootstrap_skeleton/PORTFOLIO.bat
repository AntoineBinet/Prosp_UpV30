@echo off
setlocal
cd /d "%~dp0"
title Portfolio - Lancement

echo  ============================================
echo    Portfolio - Serveur + Tunnel (marienour.work)
echo  ============================================
echo.

:: Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Python absent du PATH.
    pause
    exit /b 1
)

:: Dependances
echo [1/3] Dependances...
pip install -r requirements.txt --quiet 2>nul
if %errorlevel% neq 0 pip install -r requirements.txt --user --quiet 2>nul

:: Cloudflared (cherche dans PATH puis chemins courants)
set "PATH=%PATH%;C:\Program Files (x86)\cloudflared;C:\Program Files\cloudflared;%LOCALAPPDATA%\cloudflared"
set "CLOUDFLARED=cloudflared"
cloudflared --version >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" set "CLOUDFLARED=C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if exist "C:\Program Files\cloudflared\cloudflared.exe" set "CLOUDFLARED=C:\Program Files\cloudflared\cloudflared.exe"
)

:: Config dediee mnwork (genere par le bootstrap, ne touche pas au config.yml de prospup)
set "TUNNEL_CONFIG=%~dp0mnwork.yml"
if not exist "%TUNNEL_CONFIG%" (
    echo [ATTENTION] mnwork.yml introuvable dans le dossier — tunnel non lance.
    echo Serveur seul accessible sur http://127.0.0.1:8001
    set "TUNNEL_CONFIG="
)

echo [2/3] Demarrage du serveur (fenetre dediee)...
start "Portfolio - Serveur" cmd /k "cd /d %~dp0 && call _run_serveur.bat"
timeout /t 3 /nobreak >nul

if defined TUNNEL_CONFIG (
    echo [3/3] Demarrage du tunnel mnwork (config: %TUNNEL_CONFIG%)...
    start "" https://marienour.work
    title Portfolio - Tunnel mnwork
    "%CLOUDFLARED%" --config "%TUNNEL_CONFIG%" tunnel run mnwork
    echo.
    echo Tunnel arrete.
    pause
) else (
    start "" http://127.0.0.1:8001
    echo.
    echo  Serveur lance localement uniquement.
    pause
)
