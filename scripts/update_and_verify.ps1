# Script a lancer APRES avoir arrete le serveur (Ctrl+C)
# Met a jour le depot et verifie la version

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "1. Remise a jour du fichier de log (version distante)..." -ForegroundColor Cyan
git update-index --no-assume-unchanged logs/prospup.log 2>$null
git checkout origin/main -- logs/prospup.log

Write-Host "2. Pull origin main..." -ForegroundColor Cyan
git pull origin main

Write-Host "3. Verification du commit..." -ForegroundColor Cyan
$last = git log --oneline -1
Write-Host "   $last"
if ($last -match "4950838|b073628") { Write-Host "   OK: hash attendu" -ForegroundColor Green } else { Write-Host "   Verifier le hash (attendu b073628 ou 4950838)" -ForegroundColor Yellow }

Write-Host "4. Relancer le serveur: python scripts/supervise_prospup.py ou python app.py --prod" -ForegroundColor Cyan
Write-Host "5. Apres 30 s, tester: curl https://prospup.work/api/app-version" -ForegroundColor Cyan
