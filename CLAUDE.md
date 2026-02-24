# CLAUDE.md — WhisperClick V3

Golden principles for AI-assisted development. Every agent session must follow these rules.

## Quick Start

1. **Read** `HANDOFF.md` for current state, known issues, and next actions.
2. **Read** `progress.json` for machine-readable feature/status tracking.
3. **Run** `./venv/Scripts/python.exe tools/v3_full_test.py` after every code change.
4. **Run** `./venv/Scripts/python.exe -m black --check src/ tools/ tests/ *.py` before committing.
5. **Run** `./venv/Scripts/python.exe -m ruff check src/ tools/ tests/ *.py` before committing.

## Architecture

```
src/
  main.py              # Entrypoint: pywebview + pystray + hotkey + tray
  pill_manager.py      # PySide6 pill lifecycle (spawn, position, IPC)
  pill_widget.py       # PySide6 pill UI widget
  backend/
    api.py             # Desktop bridge API (webview <-> Python services)
    audio_recorder.py  # Native audio capture (sounddevice)
    config.py          # Settings/history persistence (~/.config/whisperclick/)
    logger.py          # Structured logging with rotation
    models.py          # Local Whisper model manager
    tones.py           # Audio feedback (start/stop/success/error/cancel)
    transcription.py   # Transcription service (OpenAI, Gemini, local Whisper)
  frontend/
    index.html         # Main UI
    pill.html          # Pill widget UI
    css/style.css
    js/app.js
```

### Hard Boundaries

- **Backend must NOT import pill modules.** `src/backend/*.py` must never import from `src/pill_manager.py` or `src/pill_widget.py`. Data flows through `main.py` only.
- **Frontend communicates only through `api.py`.** No direct imports of backend internals from JS.
- **Config is the single source of truth** for settings and history. No shadow state.

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Functions / methods | `snake_case` | `load_settings()` |
| Classes | `PascalCase` | `TranscriptionService` |
| Constants | `UPPER_SNAKE_CASE` | `SAMPLE_RATE` |
| Private | Leading underscore | `_log`, `_initialized` |
| Files | `snake_case.py` | `audio_recorder.py` |

## Import Ordering

Follow ruff's `I` (isort) rules:

1. Standard library
2. Third-party packages
3. Local imports (`src.*`)

One import per line. No wildcard imports.

## Logger Pattern

Every module uses:

```python
from src.backend.logger import get as get_logger
_log = get_logger("module_name")
```

Exception: `config.py` uses lazy import to avoid circular dependency.

## Error Handling

- **Specific exceptions only.** Never `except:` or `except Exception:` without a comment explaining why (e.g., `# pragma: no cover - optional dependency fallback`).
- **Log with context:** `_log.error("message", exc_info=True)` for unexpected errors.
- **Frontend bridge methods** (`api.py`) return `dict` with `"status": "ok"` or `"status": "error"` and `"message"`. Never raise into the JS bridge.

## Taste Invariants

| Rule | Limit | Enforcement |
|------|-------|-------------|
| File size | 800 lines max | `tools/lint_audit.py` |
| Function size | 80 lines max | `tools/lint_audit.py` |
| Line length | 120 chars | `black` + `ruff` |

**Known exceptions:**
- `api.py` (1274 lines) — legacy monolith, exempted from file-size check. Refactor is future work.
- `api.py:stop_recording()` (~120 lines) — exempted from function-size check. Tech debt.

**Near-limit files** (watch for growth):
- `pill_widget.py` (782 lines)
- `main.py` (750 lines)

## Forbidden Patterns

These must never appear in new code:

| Pattern | Reason |
|---------|--------|
| `pythonw.exe` | Silently crashes with Qt/PySide6 on this system |
| `easy_drag=True` | Broken on multi-monitor DPI setups |
| Bare `except:` | Swallows all errors including SystemExit/KeyboardInterrupt |
| `print()` in `src/` | Use `_log` instead; print breaks structured logging |
| `-webkit-app-region: drag` | Not supported by pywebview's WebView2 backend |
| `import *` | Breaks static analysis and makes dependencies opaque |

## Testing

- **Primary suite:** `python tools/v3_full_test.py` (269 test cases, requires audio hardware)
- **Pytest tests:** `python -m pytest tests/` (unit tests, no hardware required)
- **Smoke test:** `python tools/full_smoke_test.py --timeout 20`
- **After every code change**, run `tools/v3_full_test.py` and confirm no regressions.
- If tests mutate settings, they **must** snapshot and restore original values.
- CI runs `pytest tests/` only (no audio hardware in CI).

## Tooling

- **Formatter:** `black` (line-length 120, Python 3.12)
- **Linter:** `ruff` (replaces flake8 + isort + pyflakes + bugbear + simplify)
- **Structural audit:** `tools/lint_audit.py` (file/function size, architecture, forbidden patterns)
- **Pre-commit:** hooks enforce formatting/linting on every commit
- Config lives in `pyproject.toml`.

## Windows-Specific

- Python 3.12 from `./venv/Scripts/python.exe`
- GUI processes: use `run_in_background: true`, never `pythonw.exe` or `&`
- Lock file: `~/.config/whisperclick/whisperclick.lock`
- DPI: Per-Monitor V2 awareness set in `main.py` before any UI imports
- Drag: Win32 physical-pixel approach (see `docs/dpi-drag-fix-spec.md`)
- Build: PyInstaller specs in project root, Inno Setup in `installer/`

## Public/Private Repo Safety

WhisperClick has two repositories:
- **Private**: `Zbrooklyn/whisperclick-dev` — full dev workflow, internal docs, progress tracking
- **Public**: `Zbrooklyn/WhisperClick-Desktop-App` — clean release with source code and user-facing docs

### Rules

1. **NEVER push directly to the `public` remote.** Always use the sync script.
2. **Private-only files**: `HANDOFF.md`, `progress.json`, `CLAUDE.md`, `PROJECT.md`, `docs/DEVELOPER_QUESTIONS.md`, `docs/PROFESSIONAL_GAPS.md`, `docs/PRODUCTION_AUDIT_CHECKLIST.md`, `docs/PRODUCTION_CHECKLIST.md`, `docs/ROADMAP.md`, `.github/PUBLIC_SYNC.md`
3. **Source code must be identical** in both repos — only documentation differs.
4. Always check `.github/PUBLIC_SYNC.md` for the authoritative private-only file list.

### Sync Workflow

After pushing to origin, run the sync script:

```bash
git push origin main
python tools/sync_public.py
```

The script creates a temp branch, strips private files, force-pushes to
`public/main`, and cleans up. **Never** use `git push public` directly.

The private file list is maintained in two places (keep in sync):
1. `.github/PUBLIC_SYNC.md` — authoritative reference
2. `tools/sync_public.py` — sync script

## Files to Keep Updated

| File | Purpose | When to update |
|------|---------|---------------|
| `HANDOFF.md` | Human-readable project state | After completing features or finding issues |
| `progress.json` | Machine-readable status tracking | After any feature status change |
| `CLAUDE.md` | This file — conventions and rules | When conventions change |
