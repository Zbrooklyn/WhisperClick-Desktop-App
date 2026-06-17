#!/usr/bin/env bash
# sync_public.sh — Push public-safe files from private repo to public repo.
#
# Usage: bash tools/sync_public.sh
#
# How it works:
#   1. Creates a temporary branch from current HEAD
#   2. Removes private-only files
#   3. Force-pushes to public remote's main branch
#   4. Cleans up the temp branch
#
# Private files (excluded from public):
#   CLAUDE.md        — AI agent instructions
#   HANDOFF.md       — Internal dev state
#   ROADMAP.md       — Internal planning, competitive analysis
#   FEATURES.md      — Internal feature inventory
#   TESTING.md       — Test architecture notes
#   VERIFICATION.md  — Manual test checklist
#   SESSION-LOG.md   — Internal session/thread continuity record
#   tools/           — Internal dev scripts
#   docs/dev/        — Internal dev documentation
#   platforms/electron/premium/ — Premium feature modules (private)
#   shared/frontend/premium/     — Premium frontend assets (private)

set -euo pipefail

PRIVATE_FILES=(
  "CLAUDE.md"
  "HANDOFF.md"
  "ROADMAP.md"
  "FEATURES.md"
  "TESTING.md"
  "VERIFICATION.md"
  "SESSION-LOG.md"
  "tools/"
  "docs/dev/"
  "platforms/electron/premium/"
  "shared/frontend/premium/"
)

# Premium dirs MUST exist and MUST be stripped. If a future restructure moves
# them, these paths go stale and the sync would silently publish paid code.
# Guard against that: abort if any expected premium dir is missing.
REQUIRED_EXCLUDE=(
  "platforms/electron/premium/"
  "shared/frontend/premium/"
)

PUBLIC_REMOTE="public"
PUBLIC_BRANCH="main"
TEMP_BRANCH="sync-public-temp"

# Verify we're in the right repo
if ! git remote get-url "$PUBLIC_REMOTE" &>/dev/null; then
  echo "Error: remote '$PUBLIC_REMOTE' not found."
  echo "Add it with: git remote add public https://github.com/Zbrooklyn/WhisperClick-Desktop-App.git"
  exit 1
fi

# Ensure working tree is clean
if ! git diff --quiet HEAD; then
  echo "Error: uncommitted changes. Commit or stash first."
  exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)

# Fail-safe: never publish if the premium dirs we expect to strip aren't there.
# A missing dir means the paths went stale (e.g. a restructure) and stripping
# would silently no-op — leaking paid code to the public repo.
for d in "${REQUIRED_EXCLUDE[@]}"; do
  if [ ! -e "$d" ]; then
    echo "Error: expected premium dir '$d' not found."
    echo "Sync aborted to avoid leaking premium code. Update PRIVATE_FILES/REQUIRED_EXCLUDE to match the repo layout."
    exit 1
  fi
done

# Create temp branch
git checkout -b "$TEMP_BRANCH"

# Remove private files
for f in "${PRIVATE_FILES[@]}"; do
  if [ -e "$f" ]; then
    git rm -rf "$f" --quiet
  fi
done

git commit -m "Sync from private repo" --quiet

# ---------------------------------------------------------------------------
# GATE 1 — Post-strip verification (fail-closed).
# After stripping, re-scan the exact tree we are about to publish. If ANYTHING
# private survived (premium code, or any internal doc), abort before pushing.
# This is what makes a denylist safe: even if a path moved and the removal
# silently missed it, this catches it and refuses to publish.
# ---------------------------------------------------------------------------
PRIVATE_MARKERS='(^|/)premium/|(^|/)CLAUDE\.md$|^ROADMAP\.md$|^HANDOFF\.md$|^FEATURES\.md$|^TESTING\.md$|^VERIFICATION\.md$|^SESSION-LOG\.md$|^tools/|^docs/dev/'
LEAKED=$(git ls-files | grep -nE "$PRIVATE_MARKERS" || true)
if [ -n "$LEAKED" ]; then
  echo "ABORT: private files survived the strip and would be published:"
  echo "$LEAKED"
  git checkout "$CURRENT_BRANCH" --quiet; git branch -D "$TEMP_BRANCH" --quiet
  exit 1
fi

# ---------------------------------------------------------------------------
# GATE 2 — Secret scan (fail-closed). Portable regex baseline; runs on the
# published tree's contents. Any hit aborts. (CI layers gitleaks on top.)
# ---------------------------------------------------------------------------
SECRET_PATTERNS='sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(api[_-]?key|secret|token|password)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{16,}'
SECRETS=$(git grep -nIE "$SECRET_PATTERNS" -- . ':!*.test.*' ':!*.spec.*' ':!tests/*' || true)
if [ -n "$SECRETS" ]; then
  echo "ABORT: possible secrets detected in the tree about to be published:"
  echo "$SECRETS"
  git checkout "$CURRENT_BRANCH" --quiet; git branch -D "$TEMP_BRANCH" --quiet
  exit 1
fi

# Push to public
echo "All safety gates passed. Pushing to $PUBLIC_REMOTE/$PUBLIC_BRANCH..."
git push "$PUBLIC_REMOTE" "$TEMP_BRANCH:$PUBLIC_BRANCH" --force

# Clean up
git checkout "$CURRENT_BRANCH"
git branch -D "$TEMP_BRANCH"

echo "Done. Public repo updated."
