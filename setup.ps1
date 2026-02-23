# setup.ps1 — Recreate the virtual environment for whisperclick
# Run this after moving the workspace to a new location.
#
# Usage:  powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "Setting up whisperclick in: $projectDir"

# Remove stale venv if it exists
if (Test-Path "$projectDir\venv") {
    Write-Host "Removing old venv..."
    Remove-Item -Recurse -Force "$projectDir\venv"
}

# Create fresh venv
Write-Host "Creating virtual environment..."
python -m venv "$projectDir\venv"

# Activate and install dependencies
Write-Host "Installing dependencies..."
& "$projectDir\venv\Scripts\pip.exe" install --upgrade pip
& "$projectDir\venv\Scripts\pip.exe" install -r "$projectDir\requirements.txt"

Write-Host ""
Write-Host "Done! Activate with:  .\venv\Scripts\Activate.ps1"
