# build_windows.ps1
# Build a Windows executable bundle with the app/tray icon.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\build_windows.ps1

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

Write-Host "Building WhisperClick executable..."
& $venvPython -m PyInstaller --noconfirm --clean "$projectDir\whisperclick.spec"

$exePath = Join-Path $projectDir "dist\WhisperClick\WhisperClick.exe"
if (-not (Test-Path $exePath)) {
    Write-Host "Build did not produce expected executable: $exePath"
    exit 1
}

Write-Host ""
Write-Host "Build complete."
Write-Host "Executable: $exePath"
