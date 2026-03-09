@echo off
setlocal
cd /d "%~dp0"

title ProspUp - Lancement
echo.
echo  ============================================
echo    ProspUp - Serveur + Tunnel (prospup.work)
echo  ============================================
echo  Astuce : faites un PULL ^(ou PULL.bat^) pour avoir la derniere version.
echo.

:: Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Python absent ou pas dans le PATH.
    echo Installez Python 3.11+ : https://www.python.org/downloads/
    echo Cochez "Add Python to PATH" lors de l'installation.
    pause
    exit /b 1
)

:: Dependances
echo [1/3] Dependances...
pip install -r requirements.txt --quiet 2>nul
if %errorlevel% neq 0 pip install -r requirements.txt --user --quiet 2>nul

:: Tunnel (optionnel mais recommande pour prospup.work)
set "CONFIG=%USERPROFILE%\.cloudflared\config.yml"
set "TUNNEL_CMD=cloudflared tunnel --url http://127.0.0.1:8000"
set "TUNNEL_RUN_FROM="
if exist "%CONFIG%" (
    set "TUNNEL_CMD=cloudflared tunnel run prospup"
    set "TUNNEL_RUN_FROM=%USERPROFILE%\.cloudflared"
)
:: Au double-clic, PATH peut ne pas contenir cloudflared : ajouter les chemins courants
set "PATH=%PATH%;C:\Program Files (x86)\cloudflared;C:\Program Files\cloudflared;%LOCALAPPDATA%\cloudflared"
set "CLOUDFLARED=cloudflared"
cloudflared --version >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" set "CLOUDFLARED=C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if exist "C:\Program Files\cloudflared\cloudflared.exe" set "CLOUDFLARED=C:\Program Files\cloudflared\cloudflared.exe"
    "%CLOUDFLARED%" --version >nul 2>&1
)
if %errorlevel% neq 0 (
    echo [ATTENTION] cloudflared non installe ou introuvable. Acces local uniquement.
    echo Pour prospup.work : installez cloudflared puis lancez SETUP_TUNNEL.bat une fois.
    echo.
    set "TUNNEL_CMD="
) else if exist "%CONFIG%" (
    set "TUNNEL_CMD="%CLOUDFLARED%" tunnel run prospup"
)

echo [2/3] Demarrage du serveur (fenetre 1)...
start "ProspUp - Serveur" cmd /k "cd /d %~dp0 && call _run_serveur.bat"
timeout /t 3 /nobreak >nul

if defined TUNNEL_CMD (
    echo [3/3] Demarrage du tunnel HTTPS dans cette fenetre...
    timeout /t 2 /nobreak >nul
    start "" https://prospup.work
    echo.
    echo  Ne fermez pas cette fenetre ^(tunnel Cloudflare^). Fermez la pour tout arreter.
    echo  ============================================
    title ProspUp - Tunnel Cloudflare
    if defined TUNNEL_RUN_FROM (cd /d "%TUNNEL_RUN_FROM%")
    %TUNNEL_CMD%
    echo.
    echo Tunnel arrete.
    pause
) else (
    echo [3/3] Pas de tunnel - acces local uniquement.
    start "" http://127.0.0.1:8000
    echo.
    echo  ============================================
    echo    ProspUp est lance ^(serveur uniquement^).
    echo    Site : http://127.0.0.1:8000
    echo  ============================================
    echo.
    pause
)
