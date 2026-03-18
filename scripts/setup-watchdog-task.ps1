# setup-watchdog-task.ps1
# Configure une tâche planifiée Windows pour le watchdog ProspUp.
# Exécuter en tant qu'administrateur : powershell -ExecutionPolicy Bypass -File setup-watchdog-task.ps1
#
# La tâche tourne toutes les 5 minutes, INDEPENDAMMENT du process Flask.
# Même si Flask ou le superviseur crashent, cette tâche les relancera.

$TaskName  = "ProspUp-Watchdog"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$PythonExe = (Get-Command python).Source
$WatchScript = Join-Path $ScriptDir "watch-prospup.py"

# ── Variables d'environnement pour le watchdog ─────────────────────────────
# Modifier PROSPUP_NTFY_TOPIC avec votre topic ntfy.sh pour recevoir des alertes
$EnvVars = @(
    "PROSPUP_LOCAL_URL=http://127.0.0.1:8000/api/deploy/health",
    "PROSPUP_PUBLIC_URL=https://prospup.work/api/deploy/health",
    "PROSPUP_WATCH_CMD=python app.py --production",
    "PROSPUP_WATCH_DIR=$ProjectRoot",
    "PROSPUP_WATCH_TIMEOUT=10",
    "PROSPUP_RESTART_WAIT=30",
    "PROSPUP_LOG_FILE=$ProjectRoot\logs\watchdog.log"
    # Décommentez et remplissez pour les notifications push :
    # "PROSPUP_NTFY_TOPIC=mon-topic-prospup"
)

# ── Construction de la commande ────────────────────────────────────────────
# On passe chaque variable en prefixe cmd /c "SET VAR=VAL && SET ... && python ..."
$SetVars = ($EnvVars | ForEach-Object { "SET `"$_`"" }) -join " && "
$Argument = "/c `"$SetVars && `"$PythonExe`" `"$WatchScript`"`""

Write-Host "Configuration de la tâche planifiée '$TaskName'..."
Write-Host "  Python   : $PythonExe"
Write-Host "  Script   : $WatchScript"
Write-Host "  Projet   : $ProjectRoot"

# ── Suppression de la tâche existante si présente ─────────────────────────
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  Ancienne tâche supprimée."
}

# ── Création de la tâche ───────────────────────────────────────────────────
$Action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $Argument
$Trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At (Get-Date)
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

# Exécuter sous le compte SYSTEM pour survivre aux sessions utilisateur
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Watchdog ProspUp : vérifie Flask local + Cloudflare, restart/rollback si KO." `
    -Force | Out-Null

Write-Host ""
Write-Host "Tache '$TaskName' cree avec succes !" -ForegroundColor Green
Write-Host "  - Frequence : toutes les 5 minutes"
Write-Host "  - Compte    : SYSTEM (survit aux deconnexions)"
Write-Host "  - Logs      : $ProjectRoot\logs\watchdog.log"
Write-Host ""
Write-Host "Commandes utiles :"
Write-Host "  Forcer un test maintenant : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Voir le statut            : Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Supprimer la tache        : Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
