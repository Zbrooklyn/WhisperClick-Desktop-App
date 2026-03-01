#!/usr/bin/env python3
"""Sync non-private files from private repo to public repo.

Usage: python tools/sync_public.py [--dry-run]

Creates a temporary branch from main, removes private-only files listed
in .github/PUBLIC_SYNC.md, force-pushes to the 'public' remote's main
branch, then cleans up the temporary branch.

The private repo (origin) is never affected.
"""

import subprocess
import sys

# Files that must never appear on the public repo.
# Kept in sync with .github/PUBLIC_SYNC.md.
PRIVATE_ONLY_FILES = [
    "HANDOFF.md",
    "progress.json",
    "CLAUDE.md",
    "PROJECT.md",
    "docs/DEVELOPER_QUESTIONS.md",
    "docs/PROFESSIONAL_GAPS.md",
    "docs/PRODUCTION_AUDIT_CHECKLIST.md",
    "docs/PRODUCTION_CHECKLIST.md",
    "docs/ROADMAP.md",
    "docs/archive",
    ".github/PUBLIC_SYNC.md",
]

TEMP_BRANCH = "_public_sync"
PUBLIC_REMOTE = "public"
TARGET_BRANCH = "main"


def run(cmd, check=True, capture=False):
    """Run a shell command, printing it for visibility."""
    print(f"  $ {cmd}")
    result = subprocess.run(
        cmd,
        shell=True,
        check=check,
        capture_output=capture,
        text=True,
    )
    return result


def main():
    dry_run = "--dry-run" in sys.argv

    # 1. Ensure we're on main and it's clean
    result = run("git branch --show-current", capture=True)
    current_branch = result.stdout.strip()

    result = run("git status --porcelain", capture=True)
    if result.stdout.strip():
        print("ERROR: Working tree is not clean. Commit or stash changes first.")
        sys.exit(1)

    # 2. Delete temp branch if it exists from a previous failed run
    run(f"git branch -D {TEMP_BRANCH}", check=False, capture=True)

    # 3. Create temp branch from main
    print(f"\n=== Creating temp branch '{TEMP_BRANCH}' from {TARGET_BRANCH} ===")
    run(f"git checkout -b {TEMP_BRANCH} {TARGET_BRANCH}")

    try:
        # 4. Remove private-only files
        print("\n=== Removing private-only files ===")
        existing = []
        for f in PRIVATE_ONLY_FILES:
            check_result = run(f'git ls-files "{f}"', capture=True, check=False)
            if check_result.stdout.strip():
                existing.append(f)
                print(f"  - {f}")

        if existing:
            files_str = " ".join(f'"{f}"' for f in existing)
            run(f"git rm -rq {files_str}")
            run(
                'git commit -m "Remove private-only files for public release" '
                '--author="sync-public <noreply@whisperclick.app>"'
            )
        else:
            print("  No private files found to remove.")

        # 5. Push to public remote
        if dry_run:
            print(f"\n=== DRY RUN: would force-push to {PUBLIC_REMOTE}/{TARGET_BRANCH} ===")
        else:
            print(f"\n=== Force-pushing to {PUBLIC_REMOTE}/{TARGET_BRANCH} ===")
            run(f"git push --force {PUBLIC_REMOTE} {TEMP_BRANCH}:{TARGET_BRANCH}")
            print("\nPublic repo updated successfully.")

            # Re-enable HTTPS enforcement (force push resets GitHub Pages settings)
            print("\n=== Re-enabling HTTPS enforcement ===")
            run(
                "gh api -X PUT repos/Zbrooklyn/WhisperClick-Desktop-App/pages "
                "--input - --silent <<< '{\"https_enforced\":true}'",
                check=False,
            )

    finally:
        # 6. Clean up: switch back and delete temp branch
        print(f"\n=== Cleaning up: switching back to '{current_branch}' ===")
        run(f"git checkout {current_branch}")
        run(f"git branch -D {TEMP_BRANCH}")

    print("\nDone.")


if __name__ == "__main__":
    main()
