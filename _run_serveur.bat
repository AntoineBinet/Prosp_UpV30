@echo off
setlocal
cd /d "%~dp0"
set PROSPUP_LAUNCHER=BAT
set PROSPUP_DEPLOY_BRANCH=main
set PROSPUP_AUTO_DEPLOY=1
set PROSPUP_AUTO_DEPLOY_INTERVAL=90
python scripts\supervise_prospup.py
echo.
echo [INFO] Serveur arrete.
pause
