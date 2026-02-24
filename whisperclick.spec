# -*- mode: python ; coding: utf-8 -*-

import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_dynamic_libs, collect_submodules

project_dir = Path(SPEC).resolve().parent
icon_path = project_dir / "assets" / "microphone_logo.ico"

datas = [
    (str(project_dir / "src" / "frontend"), "src/frontend"),
    (str(project_dir / "assets"), "assets"),
]

hiddenimports = (
    [
        "pystray._win32",
        "PIL._tkinter_finder",
        # Local transcription (faster-whisper + dependencies)
        "faster_whisper",
        "ctranslate2",
        "tokenizers",
        "huggingface_hub",
    ]
    + collect_submodules("webview.platforms")
    + collect_submodules("faster_whisper")
    + collect_submodules("ctranslate2")
)

# Collect native DLLs/pyd files for ctranslate2 and tokenizers
binaries = collect_dynamic_libs("ctranslate2") + collect_dynamic_libs("tokenizers")


a = Analysis(
    ["src/main.py"],
    pathex=[str(project_dir)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="WhisperClick",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(icon_path),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="WhisperClick",
)
