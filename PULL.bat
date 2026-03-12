@echo off
setlocal
cd /d "%~dp0"
set "BRANCH=main"
if not exist ".git" (
    echo Ce dossier n'est pas un depot Git.
    echo Recuperez le projet depuis GitHub ou copiez les fichiers a jour.
    echo.
    pause
    exit /b 1
)
set "GIT=git"
git --version >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\Git\bin\git.exe" set "GIT=C:\Program Files\Git\bin\git.exe"
)
"%GIT%" --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Git est introuvable. Installez Git for Windows puis relancez.
    echo.
    pause
    exit /b 1
)
echo Mise a jour du projet ProspUp ^(branche %BRANCH%^)...
"%GIT%" fetch --prune origin %BRANCH%
if %errorlevel% neq 0 (
    echo.
    echo Echec du fetch.
    pause
    exit /b 1
)
"%GIT%" checkout %BRANCH%
if %errorlevel% neq 0 (
    echo.
    echo Echec du passage sur la branche %BRANCH%.
    pause
    exit /b 1
)
"%GIT%" pull --ff-only origin %BRANCH%
if %errorlevel% equ 0 (echo. & echo OK - Projet a jour.) else (echo. & echo Echec du pull fast-forward.)
echo.
pause
