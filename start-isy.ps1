<#
Runs the ArthasMod updater, then opens ISY in the default browser.
Place this script anywhere; by default it uses the updater in the same folder.
Usage (double-click) or: powershell -ExecutionPolicy Bypass -File start-isy.ps1
#>

[CmdletBinding()]
param(
    [string]$UpdaterPath = (Join-Path -Path $PSScriptRoot -ChildPath "update-arthasmod.ps1"),
    [string]$InstallDir = "$env:ProgramFiles\\ArthasMod",
    [string]$Url = "https://isy.ksr.ch/",
    [switch]$VerboseCopy
)

try {
    if (-not (Test-Path $UpdaterPath)) {
        throw "Updater not found at '$UpdaterPath'."
    }

    & "$UpdaterPath" -InstallDir $InstallDir -SkipTaskRegistration -VerboseCopy:$VerboseCopy
}
catch {
    Write-Warning "Update step failed: $_"
}

Start-Process $Url
