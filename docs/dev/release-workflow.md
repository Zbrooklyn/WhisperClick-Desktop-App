# Release Workflow — WhisperClick Mono-Repo

## Tag Format

```
{platform}-v{major}.{minor}.{patch}[-{prerelease}]
```

**Examples:**
- `electron-v2.3.0` — Electron stable release
- `electron-v2.3.1-beta` — Electron beta
- `tauri-v3.0.0` — Tauri stable release
- `tauri-v3.0.0-alpha` — Tauri alpha
- `tauri-v3.1.0-beta.2` — Tauri beta (second beta)

**Rules:**
- Platform prefix is always lowercase: `electron-` or `tauri-`
- Version follows semver: `major.minor.patch`
- Pre-release suffix is optional: `-alpha`, `-beta`, `-beta.N`
- Tags with `-alpha` or `-beta` create pre-release GitHub Releases (not shown as "latest")

## Branches

| Branch | Purpose | Who pushes |
|--------|---------|------------|
| `main` | Production-ready code, both platforms | Merge from `dev` only |
| `dev` | Active development, both platforms | Daily work happens here |

No platform-specific branches. The folder structure separates platforms:
```
platforms/electron/    — Electron code
platforms/tauri/       — Tauri code
shared/                — Code used by both
```

## Workflows

### 1. CI Tests (`ci.yml`)

**Triggers:** Push to `dev` or `main`, PR to `main`
**Runs:** Electron Jest tests + Tauri Rust tests + lint
**Purpose:** Catch regressions on every push

### 2. Build Electron (`build-electron.yml`)

**Triggers:** Tag matching `electron-v*`
**Builds:** Windows (.exe), macOS (.dmg arm64 + x64), Linux (.AppImage)
**Creates:** GitHub Release with all installers attached

### 3. Build Tauri (`build-tauri.yml`)

**Triggers:** Tag matching `tauri-v*`
**Builds:** Windows (.exe/.msi) — macOS/Linux added later
**Creates:** GitHub Release with installer attached
**Requires secrets:** `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## How to Release

### Releasing Electron

```bash
# 1. Make sure dev is clean and tests pass
git checkout dev
git push origin dev
# Wait for CI to pass

# 2. Merge dev into main
git checkout main
git pull origin main
git merge dev
git push origin main

# 3. Tag the release
git tag electron-v2.3.0
git push origin electron-v2.3.0

# GitHub Actions automatically:
#   → Runs tests
#   → Builds Windows, macOS, Linux installers
#   → Creates GitHub Release with download links
```

### Releasing Tauri

```bash
# Same steps 1-2 as above, then:

git tag tauri-v3.0.0
git push origin tauri-v3.0.0

# GitHub Actions automatically:
#   → Runs Rust tests
#   → Builds Windows installer
#   → Signs with updater key
#   → Creates GitHub Release
```

### Releasing Both (same commit)

```bash
# After merging dev into main:
git tag electron-v2.3.0
git tag tauri-v3.0.0
git push origin electron-v2.3.0
git push origin tauri-v3.0.0

# Both workflows run independently
```

### Releasing a Beta

```bash
git tag tauri-v3.0.0-beta
git push origin tauri-v3.0.0-beta

# Creates a pre-release (not marked as "latest")
```

## Pre-Release Checklist

Before tagging any release:

- [ ] All CI tests passing on `main`
- [ ] Version number updated in the relevant config:
  - Electron: `package.json` → `version`
  - Tauri: `platforms/tauri/Cargo.toml` → `version` + `platforms/tauri/tauri.conf.json` → `version`
- [ ] CHANGELOG.md updated
- [ ] For Tauri: updater signing key generated and stored as GitHub secret

## GitHub Secrets Required

| Secret | Used by | How to generate |
|--------|---------|----------------|
| `TAURI_SIGNING_PRIVATE_KEY` | `build-tauri.yml` | `cargo tauri signer generate -w ~/.tauri/whisperclick.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `build-tauri.yml` | Set during key generation |

## Public Repo Sync

The private repo (`whisperclick-dev`) is where development happens. The public repo (`WhisperClick-Desktop-App`) is where users download releases.

**Current:** Releases are created on the private repo. To publish to the public repo, manually copy the release assets or set up a workflow that mirrors releases.

**Future option:** Add a `publish-public.yml` workflow triggered by releases on the private repo that pushes assets to the public repo.
