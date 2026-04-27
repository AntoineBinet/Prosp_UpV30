@echo off
setlocal
cd /d "%~dp0"
set PORTFOLIO_LAUNCHER=BAT

:loop
python app.py --prod
if %errorlevel% equ 42 (
    echo [INFO] Restart demande par l'app, relance...
    timeout /t 2 /nobreak >nul
    goto loop
)
echo.
echo [INFO] Serveur arrete (code %errorlevel%).
pause
