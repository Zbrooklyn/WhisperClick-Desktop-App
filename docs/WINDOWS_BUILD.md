# Windows Build Guide

This project now ships a repeatable Windows packaging flow using PyInstaller.

## Build Command

```powershell
powershell -ExecutionPolicy Bypass -File .\build_windows.ps1
```

## Output

- Folder build: `dist/WhisperClick/`
- Executable: `dist/WhisperClick/WhisperClick.exe`

## Icon Notes

- Executable icon source: `assets/tray_icon.ico`
- Tray icon assets: `assets/tray_icon.ico` and `assets/tray_icon.png`
- Windows taskbar icon is controlled by the packaged executable icon.

## Build Inputs

- Spec file: `whisperclick.spec`
- Build dependencies: `requirements-build.txt`
