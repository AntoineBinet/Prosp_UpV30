@echo off
setlocal
cd /d "%~dp0"
title ProspUp - Relance tunnel seul
set "CONFIG=%USERPROFILE%\.cloudflared\config.yml"
set "PATH=%PATH%;C:\Program Files (x86)\cloudflared;C:\Program Files\cloudflared;%LOCALAPPDATA%\cloudflared"
echo.
echo  Relance du tunnel Cloudflare uniquement.
echo  (Le serveur sur le port 8000 doit deja tourner.)
echo.
if not exist "%CONFIG%" (
    echo  [ERREUR] Fichier config tunnel introuvable : %CONFIG%
    echo  Lancez SETUP_TUNNEL.bat une fois, puis PROSPUP.bat.
    pause
    exit /b 1
)
echo  Fermez l'ancienne fenetre "Tunnel Cloudflare" si elle est ouverte.
echo  Puis appuyez sur une touche pour demarrer le tunnel...
pause
cd /d "%USERPROFILE%\.cloudflared"
cloudflared tunnel run prospup
pause
