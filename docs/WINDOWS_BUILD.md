# Windows Build Guide

WhisperClick V3 produces three distributable formats using PyInstaller and Inno Setup.

## Prerequisites

**Required for all builds:**
- Python 3.12 virtualenv at `./venv/` (run `.\setup.ps1` if missing)
- Runtime dependencies (`requirements.txt`) — installed automatically by build scripts
- PyInstaller (`requirements-build.txt`) — installed automatically by build scripts

**Required only for the installer:**
- Inno Setup 6 — install with:
  ```powershell
  winget install --id JRSoftware.InnoSetup -e --silent --accept-package-agreements --accept-source-agreements
  ```

## The Three Build Types

### 1. Folder Portable

A folder containing `WhisperClick.exe` and all dependencies alongside it. Best for development testing and debugging.

**Output:** `dist/WhisperClick/WhisperClick.exe`

**What it does:**
1. Installs/upgrades pip, runtime deps, and PyInstaller
2. Runs PyInstaller with `whisperclick.spec`
3. Produces `dist/WhisperClick/` folder

**Command:**
```powershell
powershell -ExecutionPolicy Bypass -File .\build_windows.ps1
```

**Double-click alternative:** `Build_Folder_Portable.cmd`

---

### 2. Single-File Portable

One standalone `.exe` file with everything bundled inside. Best for sharing — just send someone the file.

**Output:** `dist/WhisperClick-Portable.exe`

**What it does:**
1. Installs/upgrades pip, runtime deps, and PyInstaller
2. Kills any running WhisperClick processes
3. Runs PyInstaller with `whisperclick_onefile.spec`
4. Produces a single `dist/WhisperClick-Portable.exe`

**Command:**
```powershell
powershell -ExecutionPolicy Bypass -File .\build_windows_onefile.ps1
```

**Double-click alternative:** `Build_OneFile_Portable.cmd`

**Note:** Startup is slower than the folder build because it extracts files to a temp directory on each launch.

---

### 3. Installer

A Windows installer EXE (built with Inno Setup) that installs WhisperClick to Program Files, creates Start Menu shortcuts, and supports uninstall.

**Output:** `release/WhisperClick-Setup-<version>-windows-x64.exe`

**What it does:**
1. Kills any running WhisperClick processes
2. Builds the folder portable first (unless `-SkipBuild`)
3. Runs Inno Setup compiler (`ISCC.exe`) with `installer/WhisperClick.iss`
4. Produces versioned installer in `release/`

**Requires:** Inno Setup 6 installed (see Prerequisites above).

**Command:**
```powershell
powershell -ExecutionPolicy Bypass -File .\build_windows_installer.ps1
```

**With custom version:**
```powershell
powershell -ExecutionPolicy Bypass -File .\build_windows_installer.ps1 -Version 1.0.0
```

**Skip rebuild (reuse existing `dist/WhisperClick/`):**
```powershell
powershell -ExecutionPolicy Bypass -File .\build_windows_installer.ps1 -SkipBuild
```

**Double-click alternative:** `Build_Installer_Only.cmd`

---

## Build Everything At Once

The release script builds all three formats in one shot, with a test gate that aborts if tests fail.

**Outputs (all in `release/`):**
- `WhisperClick-portable-<version>-windows-x64.zip`
- `WhisperClick-portable-onefile-<version>-windows-x64.exe`
- `WhisperClick-Setup-<version>-windows-x64.exe`

**What it does:**
1. Kills any running WhisperClick processes
2. Runs the full test suite (`tools/v3_full_test.py`) — aborts if tests fail
3. Builds folder portable (`build_windows.ps1`)
4. Builds single-file portable (`whisperclick_onefile.spec`)
5. Creates portable ZIP from the folder build
6. Copies single-file EXE to `release/` with versioned name
7. Builds installer with Inno Setup (skips gracefully if Inno Setup not installed)

**Command:**
```powershell
powershell -ExecutionPolicy Bypass -File .\release_windows.ps1
```

**With custom version:**
```powershell
powershell -ExecutionPolicy Bypass -File .\release_windows.ps1 -Version 1.0.0
```

**Double-click alternative:** `Build_Release_All.cmd`

**Optional flags:**
| Flag | Effect |
|------|--------|
| `-Version 1.0.0` | Stamp artifacts with a custom version (default: today's date `yyyy.MM.dd`) |
| `-SkipBuild` | Package from existing `dist/WhisperClick/` without rebuilding |
| `-SkipOneFile` | Skip the single-file portable EXE |
| `-SkipInstaller` | Skip the installer (only produce portable ZIP + one-file EXE) |

---

## Quick Reference

| What you want | Command | Double-click |
|---------------|---------|-------------|
| Folder portable only | `.\build_windows.ps1` | `Build_Folder_Portable.cmd` |
| Single-file EXE only | `.\build_windows_onefile.ps1` | `Build_OneFile_Portable.cmd` |
| Installer only | `.\build_windows_installer.ps1` | `Build_Installer_Only.cmd` |
| Everything | `.\release_windows.ps1` | `Build_Release_All.cmd` |

All PowerShell commands should be prefixed with:
```powershell
powershell -ExecutionPolicy Bypass -File
```

---

## Build Inputs

| File | Purpose |
|------|---------|
| `whisperclick.spec` | PyInstaller spec for folder build |
| `whisperclick_onefile.spec` | PyInstaller spec for single-file build |
| `installer/WhisperClick.iss` | Inno Setup installer definition |
| `requirements.txt` | Runtime dependencies |
| `requirements-build.txt` | Build dependencies (PyInstaller) |
| `assets/microphone_logo.ico` | App icon embedded in EXE |

## Troubleshooting

**"Virtualenv not found"** — Run `.\setup.ps1` to create the venv.

**"Inno Setup (ISCC.exe) not found"** — Install it: `winget install --id JRSoftware.InnoSetup -e --silent`

**"Test suite failed — aborting build"** — The release script runs tests first. Fix failing tests before building.

**Build succeeds but app won't start** — Check that `src/frontend/index.html` and `assets/` are bundled. These are defined in the `.spec` files under `datas`.

**Icons missing in taskbar** — The icon is set in the `.spec` file (`icon=` parameter). Regenerate with `python tools/sync_icons_from_svg.py` if needed.
