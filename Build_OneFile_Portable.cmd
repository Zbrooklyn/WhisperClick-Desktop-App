@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo WhisperClick - OneFile Portable Build
echo ==========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_windows_onefile.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo Build completed successfully.
) else (
  echo Build failed with exit code %EXITCODE%.
)
echo.
pause
exit /b %EXITCODE%
