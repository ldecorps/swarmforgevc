# Installs the Windows half of swarm boot persistence: a logon-triggered
# scheduled task that starts the WSL2 VM (the Linux-half systemd units do
# everything else), plus a .wslconfig idle-timeout guard.
#
# See README.md in this directory for prerequisites (WSL systemd) and limits.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install-swarmforge-autostart.ps1 -Distro Ubuntu
#
param(
    [Parameter(Mandatory = $true)]
    [string]$Distro
)

$ErrorActionPreference = 'Stop'

$distros = (wsl.exe --list --quiet) -replace "`0", '' | Where-Object { $_ -ne '' }
if ($distros -notcontains $Distro) {
    Write-Error "Distro '$Distro' not found. Installed: $($distros -join ', ')"
}

$taskName = 'SwarmForge WSL autostart'

$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $Distro -- true"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Description 'Boots the WSL2 VM so the SwarmForge systemd units can start (Linux half: swarmforge/deploy/generate_systemd_units.sh, BL-351).' | Out-Null
Write-Host "Registered scheduled task '$taskName' (at logon, distro: $Distro)."

# Keep the VM from idling out (Win11 22H2+ honours vmIdleTimeout; harmless elsewhere).
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$idleLine = 'vmIdleTimeout=-1'
if (Test-Path $wslconfig) {
    $content = Get-Content $wslconfig -Raw
    if ($content -notmatch [regex]::Escape($idleLine)) {
        if ($content -notmatch '\[wsl2\]') { Add-Content $wslconfig "`n[wsl2]" }
        Add-Content $wslconfig $idleLine
        Write-Host "Appended $idleLine to $wslconfig."
    } else {
        Write-Host "$wslconfig already sets vmIdleTimeout."
    }
} else {
    Set-Content $wslconfig "[wsl2]`n$idleLine"
    Write-Host "Created $wslconfig with $idleLine."
}

# Report (do not change) sleep policy - the human decides this one.
Write-Host "`nCurrent AC sleep policy (0 = never):"
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC Power Setting'
Write-Host "To disable sleep for a 24/7 host:  powercfg /change standby-timeout-ac 0"
