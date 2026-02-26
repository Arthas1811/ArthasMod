<#
Runs the ArthasMod updater, then opens ISY in the default browser.
Place this script anywhere; by default it uses the updater in the same folder.
Usage (double-click) or: powershell -ExecutionPolicy Bypass -File start-isy.ps1
#>

[CmdletBinding()]
param(
    [string]$UpdaterPath = (Join-Path -Path $PSScriptRoot -ChildPath "update-arthasmod.ps1"),
    [string]$InstallDir,
    [string]$Url = "https://isy.ksr.ch/",
    [switch]$VerboseCopy
)

try {
    if (-not (Test-Path $UpdaterPath)) {
        throw "Updater not found at '$UpdaterPath'."
    }

    $updateArgs = @{
        SkipTaskRegistration = $true
        VerboseCopy = $VerboseCopy
    }
    if ($PSBoundParameters.ContainsKey('InstallDir') -and $InstallDir) {
        $updateArgs.InstallDir = $InstallDir
    }

    & "$UpdaterPath" @updateArgs
}
catch {
    Write-Warning "Update step failed: $_"
}

Start-Process $Url
