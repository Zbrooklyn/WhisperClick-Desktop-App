# build_windows_installer.ps1
# Build Windows installer EXE only.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\build_windows_installer.ps1
#   powershell -ExecutionPolicy Bypass -File .\build_windows_installer.ps1 -Version 2026.02.19
#   powershell -ExecutionPolicy Bypass -File .\build_windows_installer.ps1 -Version 2026.02.19 -SkipBuild

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$SkipBuild
)

# Read version from single source of truth (src/__init__.py) if not provided
if (-not $Version) {
    $initFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "src\__init__.py"
    $versionMatch = Select-String -Path $initFile -Pattern '__version__\s*=\s*"([^"]+)"'
    if ($versionMatch) {
        $Version = $versionMatch.Matches[0].Groups[1].Value
    } else {
        $Version = "0.0.0"
        Write-Warning "Could not read version from src/__init__.py — using $Version"
    }
}
Write-Host "Building version: $Version"

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $projectDir

function Resolve-IsccPath {
    if ($env:ISCC_PATH -and (Test-Path $env:ISCC_PATH)) {
        return $env:ISCC_PATH
    }

    $isccCommand = Get-Command iscc.exe -ErrorAction SilentlyContinue
    if ($isccCommand) {
        return $isccCommand.Source
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

$distDir = Join-Path $projectDir "dist\WhisperClick"
$exePath = Join-Path $distDir "WhisperClick.exe"
$releaseDir = Join-Path $projectDir "release"
$installerScript = Join-Path $projectDir "installer\WhisperClick.iss"

Write-Host "Stopping running WhisperClick processes..."
Get-Process WhisperClick -ErrorAction SilentlyContinue | Stop-Process -Force

if (-not $SkipBuild) {
    Write-Host "Building WhisperClick app bundle..."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $projectDir "build_windows.ps1")
}

if (-not (Test-Path $exePath)) {
    throw "Missing executable for installer build: $exePath"
}
if (-not (Test-Path $installerScript)) {
    throw "Missing installer definition: $installerScript"
}

$isccPath = Resolve-IsccPath
if (-not $isccPath) {
    throw "Inno Setup (ISCC.exe) not found. Install with: winget install --id JRSoftware.InnoSetup -e --silent --accept-package-agreements --accept-source-agreements"
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

Write-Host "Building installer with Inno Setup..."
& $isccPath $installerScript "/DAppVersion=$Version" "/DSourceDir=$distDir" "/DOutputDir=$releaseDir"

$installerPath = Join-Path $releaseDir ("WhisperClick-Setup-{0}-windows-x64.exe" -f $Version)
if (-not (Test-Path $installerPath)) {
    throw "Installer build did not produce expected output: $installerPath"
}

Write-Host ""
Write-Host "Build complete."
Write-Host "Installer: $installerPath"
