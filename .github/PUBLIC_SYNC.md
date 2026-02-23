# Public/Private Repo Sync Guard

This file documents which files are **private-only** and must NEVER be published
to the public repository (`Zbrooklyn/whisper-click-public`).

## Private-Only Files (NEVER publish)

| File | Reason |
|------|--------|
| `HANDOFF.md` | Internal dev state and session notes |
| `progress.json` | Machine-readable dev tracking |
| `CLAUDE.md` | AI agent instructions (internal conventions) |
| `PROJECT.md` | Internal project metadata |
| `docs/DEVELOPER_QUESTIONS.md` | Internal dev questions and decisions |
| `docs/PROFESSIONAL_GAPS.md` | Internal skill/knowledge gap tracking |
| `docs/PRODUCTION_AUDIT_CHECKLIST.md` | Internal audit checklist |
| `docs/PRODUCTION_CHECKLIST.md` | Internal production checklist |
| `docs/ROADMAP.md` | Internal roadmap with dev priorities |
| `.github/PUBLIC_SYNC.md` | This file (private guard) |

## Public Repo Structure

The public repo (`Zbrooklyn/whisper-click-public`) contains:

- All `src/` source code
- All `assets/` icons
- All `tools/` (test suites, lint_audit, drag_test, etc.)
- All build scripts (`.ps1`, `.cmd`, `.spec`)
- `installer/WhisperClick.iss`
- Public docs: `docs/WINDOWS_BUILD.md`, `docs/TESTING.md`, `docs/SOUND_DESIGN.md`,
  `docs/UI_DESIGN_PLAYBOOK.md`, technical specs
- `docs/reference/` screenshots
- `pyproject.toml`, `requirements*.txt`, `.pre-commit-config.yaml`
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- `.gitignore`, `.env.example`, `LICENSE`
- `benchmark.py`, `generate_samples.py`, `run_pill.py`
- `README.md`, `CHANGELOG.md`, `PRIVACY.md`, `SECURITY.md`

## Sync Procedure

When syncing changes from private to public:

1. **Check this file first** — never copy listed private files.
2. Copy only files listed in "Public Repo Structure" above.
3. Verify no private files leaked: `git diff --name-only` against this list.
4. The public repo should have identical source code — only docs differ.
