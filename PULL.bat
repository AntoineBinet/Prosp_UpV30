@echo off
cd /d "%~dp0"
if not exist ".git" (
    echo Ce dossier n'est pas un depot Git.
    echo Recuperez le projet depuis GitHub ou copiez les fichiers a jour.
    echo.
    pause
    exit /b 1
)
echo Mise a jour du projet ProspUp...
"C:\Program Files\Git\bin\git.exe" pull
if %errorlevel% equ 0 (echo. & echo OK - Relancez PROSPUP.bat.) else (echo. & echo Echec du pull.)
echo.
pause
