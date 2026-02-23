@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo WhisperClick - Installer Build Only
echo ==========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_windows_installer.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo Installer build completed successfully.
) else (
  echo Installer build failed with exit code %EXITCODE%.
)
echo.
pause
exit /b %EXITCODE%
