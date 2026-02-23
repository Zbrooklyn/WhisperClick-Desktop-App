@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo WhisperClick - Release Artifacts Build
echo ==========================================
echo This builds:
echo 1) Folder portable ZIP
echo 2) OneFile portable EXE
echo 3) Installer EXE
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release_windows.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo Release build completed successfully.
) else (
  echo Release build failed with exit code %EXITCODE%.
)
echo.
pause
exit /b %EXITCODE%
