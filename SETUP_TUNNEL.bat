@echo off
setlocal EnableDelayedExpansion
cd /d %~dp0

title ProspUp - Configuration Cloudflare Tunnel
echo.
echo  =====================================================
echo    ProspUp v19 - Configuration Tunnel Cloudflare
echo    Acces HTTPS permanent depuis partout
echo  =====================================================
echo.

:: ──────────────────────────────────────────────────────────
:: Etape 1 : Verifier cloudflared
:: ──────────────────────────────────────────────────────────
echo [1/5] Verification de cloudflared...
cloudflared --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   cloudflared n'est pas installe.
    echo   Installation automatique via winget...
    echo.
    winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo.
        echo   [ERREUR] Installation echouee.
        echo   Installez manuellement depuis :
        echo   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
        echo.
        pause
        exit /b 1
    )
    echo   [OK] cloudflared installe.
) else (
    for /f "tokens=*" %%v in ('cloudflared --version 2^>^&1') do echo   %%v
    echo   [OK] cloudflared present.
)

echo.

:: ──────────────────────────────────────────────────────────
:: Etape 2 : Connexion au compte Cloudflare
:: ──────────────────────────────────────────────────────────
echo [2/5] Connexion a votre compte Cloudflare...
echo.
echo   Une fenetre de navigateur va s'ouvrir.
echo   Connectez-vous a votre compte Cloudflare et autorisez l'acces.
echo   (Si vous n'avez pas de compte, creez-en un sur https://dash.cloudflare.com/sign-up)
echo.
pause

cloudflared login
if %errorlevel% neq 0 (
    echo   [ERREUR] Connexion echouee. Reessayez.
    pause
    exit /b 1
)
echo   [OK] Connecte a Cloudflare.
echo.

:: ──────────────────────────────────────────────────────────
:: Etape 3 : Creer le tunnel
:: ──────────────────────────────────────────────────────────
echo [3/5] Creation du tunnel "prospup"...

:: Verifier si le tunnel existe deja
cloudflared tunnel list 2>nul | findstr /i "prospup" >nul 2>&1
if %errorlevel% equ 0 (
    echo   [INFO] Le tunnel "prospup" existe deja.
    echo   Si vous voulez le recreer, supprimez-le d'abord :
    echo   cloudflared tunnel delete prospup
    echo.
) else (
    cloudflared tunnel create prospup
    if %errorlevel% neq 0 (
        echo   [ERREUR] Creation du tunnel echouee.
        pause
        exit /b 1
    )
    echo   [OK] Tunnel "prospup" cree.
)
echo.

:: ──────────────────────────────────────────────────────────
:: Etape 4 : Configurer le DNS
:: ──────────────────────────────────────────────────────────
echo [4/5] Configuration DNS...
echo.
echo   Quel sous-domaine voulez-vous utiliser ?
echo   Exemple : crm.prospup.work
echo.
set /p SUBDOMAIN="   Tapez votre sous-domaine complet [crm.prospup.work] : "
if "!SUBDOMAIN!"=="" set "SUBDOMAIN=crm.prospup.work"

echo.
echo   Configuration DNS pour !SUBDOMAIN!...
cloudflared tunnel route dns prospup !SUBDOMAIN!
if %errorlevel% neq 0 (
    echo.
    echo   [WARN] La route DNS a peut-etre echoue.
    echo   Verifiez que le domaine est bien ajoute a votre compte Cloudflare.
    echo   Vous pouvez ajouter manuellement un CNAME dans le dashboard Cloudflare :
    echo     Nom: !SUBDOMAIN!  →  Type: CNAME  →  Cible: [tunnel-id].cfargotunnel.com
    echo.
)
echo.

:: ──────────────────────────────────────────────────────────
:: Etape 5 : Generer le fichier de configuration
:: ──────────────────────────────────────────────────────────
echo [5/5] Generation de la configuration...

:: Trouver le fichier credentials
set "CRED_DIR=%USERPROFILE%\.cloudflared"
set "CRED_FILE="
for %%f in ("%CRED_DIR%\*.json") do (
    set "CRED_FILE=%%f"
)

if "!CRED_FILE!"=="" (
    echo   [ERREUR] Fichier credentials non trouve dans %CRED_DIR%
    echo   Verifiez que le tunnel a bien ete cree.
    pause
    exit /b 1
)

:: Ecrire config.yml (127.0.0.1 evite les soucis IPv6 localhost sur Windows)
set "CONFIG_FILE=%CRED_DIR%\config.yml"
echo tunnel: prospup> "!CONFIG_FILE!"
echo credentials-file: !CRED_FILE!>> "!CONFIG_FILE!"
echo.>> "!CONFIG_FILE!"
echo ingress:>> "!CONFIG_FILE!"
echo   - hostname: !SUBDOMAIN!>> "!CONFIG_FILE!"
echo     service: http://127.0.0.1:8000>> "!CONFIG_FILE!"
if "!SUBDOMAIN!"=="crm.prospup.work" (
    echo   - hostname: prospup.work>> "!CONFIG_FILE!"
    echo     service: http://127.0.0.1:8000>> "!CONFIG_FILE!"
)
echo   - service: http_status:404>> "!CONFIG_FILE!"

echo.
echo   [OK] Configuration ecrite dans : !CONFIG_FILE!
echo.

:: Copier aussi dans le dossier du projet
copy "!CONFIG_FILE!" "%~dp0cloudflare-config.yml" >nul 2>&1

echo.
echo  =====================================================
echo    INSTALLATION TERMINEE !
echo  =====================================================
echo.
echo   Votre CRM sera accessible en permanence sur :
echo.
echo     https://!SUBDOMAIN!
echo.
echo   Pour lancer le serveur + tunnel :
echo     Double-cliquez sur PROSPUP.bat (c'est tout !)
echo.
echo   Pour un demarrage automatique au boot Windows :
echo     - Ajoutez un raccourci de PROSPUP.bat
echo       dans le dossier Demarrage (Win+R puis shell:startup)
echo.
echo  =====================================================
echo.
pause
