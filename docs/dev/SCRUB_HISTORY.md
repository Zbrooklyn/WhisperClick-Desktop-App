# Scrubbing Files from Public Git History

If private files (CLAUDE.md, HANDOFF.md, etc.) are accidentally pushed to the
public repo, follow this procedure to remove them from every commit in history.

## Prerequisites

```bash
pip install git-filter-repo
```

## Procedure

### 1. Fresh clone of the public repo

`git-filter-repo` requires a fresh clone (not a working copy with remotes).

```bash
cd /tmp
git clone https://github.com/Zbrooklyn/WhisperClick-Desktop-App.git scrub-temp
cd scrub-temp
```

### 2. Remove files from all commits

```bash
git filter-repo \
  --invert-paths \
  --path CLAUDE.md \
  --path HANDOFF.md \
  --path ROADMAP.md \
  --path FEATURES.md \
  --path TESTING.md \
  --path VERIFICATION.md \
  --path tools/ \
  --force
```

This rewrites every commit in history. Files are removed as if they never existed.
All other files and commit messages are preserved.

### 3. Force push the clean history

`git-filter-repo` removes the `origin` remote as a safety measure. Re-add it and push.

```bash
git remote add origin https://github.com/Zbrooklyn/WhisperClick-Desktop-App.git
git push origin main --force
```

### 4. Update local repos

Anyone with a local clone of the public repo needs to re-fetch:

```bash
git fetch public  # from the WhisperClick Electron working directory
```

### 5. Purge GitHub caches (optional)

GitHub may retain cached copies of removed content (in PR diffs, API caches, etc.).
These expire on their own, but for immediate removal:

- Go to https://support.github.com/contact
- Request a garbage collection on `Zbrooklyn/WhisperClick-Desktop-App`
- Reference the force-push and explain that sensitive files were removed

### 6. Clean up

```bash
rm -rf /tmp/scrub-temp
```

## Files That Must Never Be on the Public Repo

| File | Reason |
|------|--------|
| `CLAUDE.md` | AI agent instructions, architecture internals |
| `HANDOFF.md` | Internal dev session state |
| `ROADMAP.md` | Competitive analysis, unreleased feature plans |
| `FEATURES.md` | Internal feature inventory |
| `TESTING.md` | Test architecture notes |
| `VERIFICATION.md` | Manual test checklist |
| `tools/` | Internal dev scripts (includes sync script) |

## Prevention

The correct workflow prevents this from happening:

1. **Private repo** (`origin` → `Zbrooklyn/whisperclick-dev`): push all code here
2. **Sync script** (`bash tools/sync_public.sh`): strips private files, then pushes to public
3. **Never push directly to the public remote**
4. **Always verify remotes** before first push in a session: `git remote -v`

## History

- **2026-03-05**: CLAUDE.md, HANDOFF.md, ROADMAP.md, FEATURES.md, TESTING.md,
  VERIFICATION.md, and tools/ were scrubbed from public repo history using
  `git-filter-repo`. Remotes were reconfigured to prevent recurrence.
