# build_windows_onefile.ps1
# Build a single-file portable Windows executable.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\build_windows_onefile.ps1

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $projectDir

$venvPython = Join-Path $projectDir "venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "Virtualenv not found. Run .\setup.ps1 first."
    exit 1
}

Write-Host "Installing runtime/build dependencies..."
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r "$projectDir\requirements.txt"
& $venvPython -m pip install -r "$projectDir\requirements-build.txt"

Write-Host "Stopping running WhisperClick processes..."
Get-Process WhisperClick -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Building WhisperClick single-file portable executable..."
& $venvPython -m PyInstaller --noconfirm --clean "$projectDir\whisperclick_onefile.spec"

$exePath = Join-Path $projectDir "dist\WhisperClick-Portable.exe"
if (-not (Test-Path $exePath)) {
    Write-Host "Build did not produce expected executable: $exePath"
    exit 1
}

Write-Host ""
Write-Host "Build complete."
Write-Host "Executable: $exePath"
