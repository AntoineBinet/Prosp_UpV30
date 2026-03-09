@echo off
setlocal
cd /d "%~dp0"
title ProspUp - Relance
echo.
echo  ============================================
echo    ProspUp - Relance (prospup.work)
echo  ============================================
echo.
echo  Si prospup.work ne repond plus sur ton iPhone :
echo    1. Sur le PC : ferme les 2 fenetres ProspUp
echo       (fenetre "Serveur" et fenetre "Tunnel Cloudflare")
echo    2. Appuie sur une touche ici pour tout relancer.
echo.
echo  Sinon appuie sur une touche pour lancer quand meme.
echo  ============================================
pause
call "%~dp0PROSPUP.bat"
