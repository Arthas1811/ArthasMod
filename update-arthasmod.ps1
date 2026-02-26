<#
Keeps the local ArthasMod repo synced with GitHub and mirrors the unpacked
extension into a target directory for Chrome/Edge dev-mode loading.
Run with: powershell -ExecutionPolicy Bypass -File update-arthasmod.ps1
#>

[CmdletBinding()]
param(
    [string]$RepoPath = (Split-Path -Parent $PSCommandPath),
    [string]$InstallDir,
    [string]$Branch = "main",
    [switch]$SkipGitUpdate,
    [switch]$VerboseCopy,
    [switch]$RegisterTask,
    [string]$TaskName = "ArthasMod Auto-Update",
    [switch]$SkipTaskRegistration
)

$InstallCachePath = Join-Path $env:LocalAppData "ArthasMod\\install-dir.txt"

function Require-Tool {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required tool '$Name' not found. Install it and retry."
    }
}

function Require-AdminIfNeeded {
    param([string]$TargetPath, [switch]$ForScheduledTask)
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    $needsAdmin =
        ($TargetPath -like "$env:ProgramFiles*") -or
        ($TargetPath -like "$env:ProgramW6432*") -or
        ($TargetPath -like "$env:ProgramFiles(x86)*") -or
        $ForScheduledTask

    if ($needsAdmin -and -not $isAdmin) {
        throw "Administrator rights required (target path '$TargetPath' or scheduled task). Re-run PowerShell as Administrator."
    }
}

function Test-ArthasInstall {
    param([string]$Path)
    if (-not $Path) { return $false }
    if (-not (Test-Path $Path)) { return $false }

    $manifest = Join-Path $Path "manifest.json"
    if (-not (Test-Path $manifest)) { return $false }

    try {
        $json = Get-Content -Path $manifest -Raw -ErrorAction Stop
        return $json -match '"name"\s*:\s*"ArthasMod"'
    }
    catch {
        return $false
    }
}

function Find-ExistingInstall {
    param([string[]]$Roots)
    foreach ($root in $Roots) {
        if (-not (Test-Path $root)) { continue }

        $rootDepth = ($root -split '[\\/]').Count
        Get-ChildItem -Path $root -Directory -Recurse -ErrorAction SilentlyContinue | Where-Object {
            ($_.FullName -split '[\\/]').Count -le ($rootDepth + 2)
        } | ForEach-Object {
            if (Test-ArthasInstall -Path $_.FullName) {
                return $_.FullName
            }
        }
    }
    return $null
}

function Update-Repo {
    param(
        [string]$Path,
        [string]$Branch
    )
    Push-Location $Path
    try {
        git fetch origin $Branch | Out-Null
        $counts = git rev-list --left-right --count "HEAD...origin/$Branch"
        $parts = $counts -split "\s+"
        $ahead = [int]$parts[0]
        $behind = [int]$parts[1]
        if ($behind -gt 0) {
            git pull --rebase --autostash origin $Branch | Out-Null
            return "pulled"
        } elseif ($ahead -gt 0) {
            return "ahead"
        } else {
            return "current"
        }
    }
    finally {
        Pop-Location
    }
}

function Mirror-Extension {
    param(
        [string]$Source,
        [string]$Destination,
        [switch]$VerboseCopy
    )
    if (-not (Test-Path $Destination)) {
        New-Item -ItemType Directory -Path $Destination | Out-Null
    }

    $args = @(
        $Source,
        $Destination,
        "*.*",
        "/MIR",
        "/R:1","/W:2",
        "/XD",".git",".github",".vscode",".idea","node_modules",
        "/XF",".gitignore","update-arthasmod.ps1"
    )

    if (-not $VerboseCopy) {
        $args += "/NFL","/NDL","/NJH","/NJS","/NC","/NS"
    }

    robocopy @args | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "File sync failed (robocopy exit code $code)."
    }
}

function Register-AutoUpdateTask {
    param(
        [string]$ScriptPath,
        [string]$InstallDir,
        [string]$TaskName
    )

    Import-Module ScheduledTasks -ErrorAction Stop

    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -InstallDir `"$InstallDir`" -SkipTaskRegistration"

    $triggerDaily = New-ScheduledTaskTrigger -Daily -At 3:00am
    $triggerLogon = New-ScheduledTaskTrigger -AtLogOn

    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

    $task = New-ScheduledTask -Action $action -Trigger @($triggerDaily, $triggerLogon) -Principal $principal

    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    Write-Host "Scheduled task '$TaskName' registered (SYSTEM, daily 03:00 + at logon)."
}

try {
    Require-Tool -Name "git"
    Require-Tool -Name "robocopy"

    $repo = (Resolve-Path -Path $RepoPath).ProviderPath
    $install = $null

    $installArgProvided = $PSBoundParameters.ContainsKey('InstallDir') -and -not [string]::IsNullOrWhiteSpace($InstallDir)
    if ($installArgProvided) {
        $install = $InstallDir
    }

    if (-not $install -and (Test-Path $InstallCachePath)) {
        $cached = Get-Content -Path $InstallCachePath -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cached -and (Test-ArthasInstall -Path $cached)) {
            $install = $cached
            Write-Host "Detected previous install at $install (cache)."
        }
    }

    if (-not $install) {
        $roots = @(
            (Join-Path $env:USERPROFILE "Downloads"),
            (Join-Path $env:USERPROFILE "Desktop"),
            (Join-Path $env:USERPROFILE "Documents")
        )
        $detected = Find-ExistingInstall -Roots $roots
        if ($detected) {
            $install = $detected
            Write-Host "Detected existing install at $install."
        }
    }

    if (-not $install) {
        $install = "$env:ProgramFiles\\ArthasMod"
        Write-Host "No prior install found; defaulting to $install."
    }

    if (Test-Path $install) {
        $install = (Resolve-Path -Path $install).ProviderPath
    }

    Write-Host "Using install directory: $install"

    Require-AdminIfNeeded -TargetPath $install -ForScheduledTask:$RegisterTask

    if (-not $SkipGitUpdate) {
        $state = Update-Repo -Path $repo -Branch $Branch
        switch ($state) {
            "pulled" { Write-Host "Updated repo to latest $Branch from GitHub." }
            "ahead"  { Write-Warning "Local repo is ahead of origin/$Branch; not pulling." }
            default  { Write-Host "Repo already current with origin/$Branch." }
        }
    }
    else {
        Write-Host "Skipping git update as requested."
    }

    Mirror-Extension -Source $repo -Destination $install -VerboseCopy:$VerboseCopy
    Write-Host "Extension mirrored to: $install"
    Write-Host "Load (or keep loaded) the unpacked extension from that directory."

    try {
        $cacheDir = Split-Path -Parent $InstallCachePath
        if (-not (Test-Path $cacheDir)) {
            New-Item -ItemType Directory -Path $cacheDir | Out-Null
        }
        Set-Content -Path $InstallCachePath -Value $install -Force
    }
    catch {
        Write-Warning "Could not persist install path cache: $_"
    }

    if ($RegisterTask -and -not $SkipTaskRegistration) {
        Register-AutoUpdateTask -ScriptPath $PSCommandPath -InstallDir $install -TaskName $TaskName
    }
}
catch {
    Write-Error $_
    exit 1
}
