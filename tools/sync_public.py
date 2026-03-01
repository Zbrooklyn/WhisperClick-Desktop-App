#!/usr/bin/env python3
"""Sync non-private files from private repo to public repo.

Usage: python tools/sync_public.py [--dry-run] [--force]

Builds a clean tree from main (minus private-only files), commits it
on top of public/main, and pushes — a normal fast-forward push that
does NOT reset GitHub Pages settings (custom domain, HTTPS, DNS).

Use --force to fall back to force-push if the normal push fails.
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
SYNC_AUTHOR = "sync-public <noreply@whisperclick.app>"


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
    allow_force = "--force" in sys.argv

    # 1. Ensure working tree is clean
    result = run("git branch --show-current", capture=True)
    current_branch = result.stdout.strip()

    result = run("git status --porcelain", capture=True)
    if result.stdout.strip():
        print("ERROR: Working tree is not clean. Commit or stash changes first.")
        sys.exit(1)

    # 2. Delete temp branch if it exists from a previous failed run
    run(f"git branch -D {TEMP_BRANCH}", check=False, capture=True)

    # 3. Fetch latest public/main
    print(f"\n=== Fetching {PUBLIC_REMOTE}/{TARGET_BRANCH} ===")
    run(f"git fetch {PUBLIC_REMOTE} {TARGET_BRANCH}", check=False)

    # 4. Create temp branch from public/main (to build on top of it)
    print(f"\n=== Creating temp branch from {PUBLIC_REMOTE}/{TARGET_BRANCH} ===")
    run(f"git checkout -b {TEMP_BRANCH} {PUBLIC_REMOTE}/{TARGET_BRANCH}")

    try:
        # 5. Replace entire working tree with private main's content
        print("\n=== Overlaying private main content ===")
        run(f"git checkout {TARGET_BRANCH} -- .")

        # 6. Remove private-only files
        print("\n=== Removing private-only files ===")
        existing = []
        for f in PRIVATE_ONLY_FILES:
            check_result = run(f'git ls-files "{f}"', capture=True, check=False)
            if check_result.stdout.strip():
                existing.append(f)
                print(f"  - {f}")

        if existing:
            files_str = " ".join(f'"{f}"' for f in existing)
            run(f"git rm -rfq {files_str}")

        # 7. Stage everything and check if there are changes
        run("git add -A")
        diff_result = run("git diff --cached --quiet", check=False, capture=True)

        if diff_result.returncode == 0:
            print("\nNo changes to sync — public repo is already up to date.")
        else:
            # Commit the changes
            run(f'git commit -m "Sync from private repo" ' f'--author="{SYNC_AUTHOR}"')

            # 8. Push to public remote (normal push, not force)
            if dry_run:
                print(f"\n=== DRY RUN: would push to {PUBLIC_REMOTE}/{TARGET_BRANCH} ===")
            else:
                print(f"\n=== Pushing to {PUBLIC_REMOTE}/{TARGET_BRANCH} ===")
                push_result = run(
                    f"git push {PUBLIC_REMOTE} {TEMP_BRANCH}:{TARGET_BRANCH}",
                    check=False,
                    capture=True,
                )

                if push_result.returncode != 0:
                    if allow_force:
                        print("\nNormal push failed — falling back to force push (--force).")
                        run(f"git push --force {PUBLIC_REMOTE} {TEMP_BRANCH}:{TARGET_BRANCH}")

                        # Force push resets Pages settings — re-enable HTTPS
                        print("\n=== Re-enabling HTTPS enforcement ===")
                        run(
                            "gh api -X PUT repos/Zbrooklyn/WhisperClick-Desktop-App/pages "
                            "--input - --silent <<< '{\"https_enforced\":true}'",
                            check=False,
                        )
                    else:
                        print("\nERROR: Push failed. Run with --force to force-push, " "or resolve manually.")
                        print(push_result.stderr)
                        sys.exit(1)
                else:
                    print("\nPublic repo updated successfully (fast-forward).")

    finally:
        # 9. Clean up: switch back and delete temp branch
        print(f"\n=== Cleaning up: switching back to '{current_branch}' ===")
        run(f"git checkout {current_branch}")
        run(f"git branch -D {TEMP_BRANCH}")

    print("\nDone.")


if __name__ == "__main__":
    main()
