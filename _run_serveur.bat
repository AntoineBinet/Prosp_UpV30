@echo off
setlocal
cd /d "%~dp0"
set PROSPUP_LAUNCHER=BAT

:loop
python app.py --production
if %ERRORLEVEL% EQU 42 (
    echo.
    echo [UPDATE] Redemarrage automatique...
    timeout /t 2 /nobreak >nul
    goto loop
)
echo.
echo [INFO] Serveur arrete.
pause
