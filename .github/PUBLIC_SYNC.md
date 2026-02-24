# Public/Private Repo Sync Guard

This file documents which files are **private-only** and must NEVER be published
to the public repository (`Zbrooklyn/WhisperClick-Desktop-App`).

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

The public repo (`Zbrooklyn/WhisperClick-Desktop-App`) contains:

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

Syncing is **automated** via GitHub Actions and also available manually.

### Automatic (CI)

The `.github/workflows/sync-public.yml` workflow runs on every push to `main` on
the private repo. It strips all private-only files and force-pushes to the public
repo. No manual action needed.

**Required setup (one-time):**
1. Create a GitHub Personal Access Token (classic) with `repo` scope.
2. In the private repo (`whisperclick-dev`), go to Settings > Secrets and variables > Actions.
3. Add a repository secret named `PUBLIC_REPO_TOKEN` with the token value.

### Manual (fallback)

```bash
python tools/sync_public.py
```

Creates a temp branch, removes private files, force-pushes to `public/main`, cleans up.
Use this when CI is unavailable or for immediate one-off syncs.

### Rules

- **NEVER** run `git push public main` directly — it will leak private files.
- The private file list is maintained in three places (keep in sync):
  1. This file (`.github/PUBLIC_SYNC.md`) — authoritative reference
  2. `.github/workflows/sync-public.yml` — CI automation
  3. `tools/sync_public.py` — manual script
- The public repo should have identical source code — only documentation differs.
