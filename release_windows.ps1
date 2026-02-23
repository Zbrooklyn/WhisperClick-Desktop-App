# release_windows.ps1
# Build release artifacts for Windows:
# - Portable ZIP
# - Single-file portable EXE
# - Installer EXE (if Inno Setup is available)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\release_windows.ps1
#   powershell -ExecutionPolicy Bypass -File .\release_windows.ps1 -Version 2026.02.19
#   powershell -ExecutionPolicy Bypass -File .\release_windows.ps1 -SkipInstaller

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$SkipBuild,
    [switch]$SkipOneFile,
    [switch]$SkipInstaller
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
$oneFileSpec = Join-Path $projectDir "whisperclick_onefile.spec"
$oneFileDistExe = Join-Path $projectDir "dist\WhisperClick-Portable.exe"
$releaseDir = Join-Path $projectDir "release"
$installerScript = Join-Path $projectDir "installer\WhisperClick.iss"
$venvPython = Join-Path $projectDir "venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    throw "Virtualenv not found. Run .\setup.ps1 first."
}

Write-Host "Stopping running WhisperClick processes..."
Get-Process WhisperClick -ErrorAction SilentlyContinue | Stop-Process -Force

# Pre-build test gate — abort if tests fail
Write-Host "Running test suite before build..."
& $venvPython (Join-Path $projectDir "tools\v3_full_test.py")
if ($LASTEXITCODE -ne 0) {
    throw "Test suite failed — aborting build. Fix failing tests before releasing."
}
Write-Host "All tests passed."
Write-Host ""

if (-not $SkipBuild) {
    Write-Host "Building WhisperClick app bundle..."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $projectDir "build_windows.ps1")

    if (-not $SkipOneFile) {
        if (-not (Test-Path $oneFileSpec)) {
            throw "Missing onefile spec: $oneFileSpec"
        }
        Write-Host "Building WhisperClick single-file portable executable..."
        & $venvPython -m PyInstaller --noconfirm --clean $oneFileSpec
    }
}

if (-not (Test-Path $exePath)) {
    throw "Missing executable after build: $exePath"
}
if (-not $SkipOneFile -and -not (Test-Path $oneFileDistExe)) {
    throw "Missing single-file executable: $oneFileDistExe. Run release without -SkipBuild or pass -SkipOneFile."
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

$portableZip = Join-Path $releaseDir ("WhisperClick-portable-{0}-windows-x64.zip" -f $Version)
if (Test-Path $portableZip) {
    Remove-Item $portableZip -Force
}

Write-Host "Creating portable archive..."
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { "python" }

$zipScript = @'
import os
import sys
import zipfile

source_dir = os.path.abspath(sys.argv[1])
zip_path = os.path.abspath(sys.argv[2])

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
    for root, _, files in os.walk(source_dir):
        for name in files:
            full_path = os.path.join(root, name)
            arc_path = os.path.relpath(full_path, source_dir)
            archive.write(full_path, arcname=arc_path)
'@

$zipScriptPath = Join-Path $env:TEMP ("whisperclick_zip_{0}.py" -f [System.Guid]::NewGuid().ToString("N"))
$zipScript | Set-Content -Path $zipScriptPath -Encoding UTF8

try {
    & $pythonExe $zipScriptPath $distDir $portableZip
    if ($LASTEXITCODE -ne 0) {
        throw "Portable archive step failed with exit code $LASTEXITCODE."
    }
} finally {
    Remove-Item $zipScriptPath -ErrorAction SilentlyContinue
}

if (-not (Test-Path $portableZip)) {
    throw "Portable archive was not created: $portableZip"
}

$oneFileRelease = $null
if ($SkipOneFile) {
    Write-Host "Skipping single-file portable artifact (-SkipOneFile)."
} else {
    $oneFileRelease = Join-Path $releaseDir ("WhisperClick-portable-onefile-{0}-windows-x64.exe" -f $Version)
    Copy-Item $oneFileDistExe $oneFileRelease -Force
}

$installerPath = $null
if ($SkipInstaller) {
    Write-Host "Skipping installer build (-SkipInstaller)."
} else {
    if (-not (Test-Path $installerScript)) {
        throw "Missing installer definition: $installerScript"
    }

    $isccPath = Resolve-IsccPath
    if (-not $isccPath) {
        Write-Warning "Inno Setup was not found. Installer build skipped."
        Write-Host "Install Inno Setup 6 or set ISCC_PATH to ISCC.exe, then re-run release_windows.ps1."
    } else {
        Write-Host "Building installer with Inno Setup..."
        & $isccPath $installerScript "/DAppVersion=$Version" "/DSourceDir=$distDir" "/DOutputDir=$releaseDir"

        $installerPath = Join-Path $releaseDir ("WhisperClick-Setup-{0}-windows-x64.exe" -f $Version)
        if (-not (Test-Path $installerPath)) {
            throw "Installer build did not produce expected output: $installerPath"
        }
    }
}

Write-Host ""
Write-Host "Release artifacts:"
Write-Host " - Portable ZIP: $portableZip"
if ($oneFileRelease) {
    Write-Host " - Portable OneFile EXE: $oneFileRelease"
} else {
    Write-Host " - Portable OneFile EXE: not built"
}
if ($installerPath) {
    Write-Host " - Installer EXE: $installerPath"
} else {
    Write-Host " - Installer EXE: not built"
}
