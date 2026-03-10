@echo off
setlocal
cd /d "%~dp0"
set PROSPUP_LAUNCHER=BAT
python scripts\supervise_prospup.py
echo.
echo [INFO] Serveur arrete.
pause
