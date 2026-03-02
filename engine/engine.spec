# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for WhisperClick sidecar engine.

Build: pyinstaller engine/engine.spec
Output: dist/engine/ (onedir)

Key decisions:
  - onedir (not onefile): ctranslate2/sounddevice native DLLs break with
    onefile temp-extraction.
  - console=True: engine uses stdin/stdout JSON IPC with Electron.
  - upx=False: UPX corrupts ctranslate2 binaries.
  - torch excluded: 2+ GB optional dependency; engine falls back to CPU int8.
"""

import sys
from pathlib import Path

block_cipher = None

engine_dir = Path(SPECPATH)

a = Analysis(
    [str(engine_dir / 'engine.py')],
    pathex=[str(engine_dir)],
    binaries=[],
    datas=[],
    hiddenimports=[
        # Audio
        'sounddevice',
        '_sounddevice_data',
        'soundfile',
        # ML / transcription
        'ctranslate2',
        'faster_whisper',
        'onnxruntime',
        'huggingface_hub',
        'huggingface_hub.utils',
        'huggingface_hub.utils._validators',
        # Numeric
        'numpy',
        # API clients
        'openai',
        'httpx',
        'httpx._transports',
        'httpx._transports.default',
        # Backend modules
        'backend',
        'backend.audio_recorder',
        'backend.config',
        'backend.logger',
        'backend.models',
        'backend.tones',
        'backend.transcription',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'torch',
        'torchaudio',
        'torchvision',
        'matplotlib',
        'tkinter',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='engine',
)
