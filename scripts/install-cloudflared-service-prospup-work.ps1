# Installation du service Windows cloudflared (tunnel Zero Trust, ex. prospup-work).
# Usage (PowerShell ADMIN) :
#   .\install-cloudflared-service-prospup-work.ps1 -TunnelToken '<jeton depuis Zero Trust>'
# Le jeton est affiche dans Cloudflare : Tunnels > prospup-work > Install connector > etape 4.

param(
    [Parameter(Mandatory = $true)]
    [string] $TunnelToken
)

$ErrorActionPreference = "Stop"
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
    $cf = "C:\Users\binet\AppData\Local\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
}
if (-not (Test-Path $cf)) {
    Write-Error "cloudflared.exe introuvable. Installez-le (MSI Cloudflare) ou ajoutez-le au PATH."
}

Write-Host "Installation du service cloudflared..."
& $cf service install $TunnelToken
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Demarrage du service..."
& $cf service start
Write-Host "Termine. Verifie Zero Trust > Tunnels (statut Healthy)."
