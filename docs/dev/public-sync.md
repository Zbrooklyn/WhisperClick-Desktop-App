# Public repo sync (free version)

The private monorepo `whisperclick-dev` contains everything. The public repo
`WhisperClick-Desktop-App` is the **free version only**: the same tree minus
premium code and internal docs. Publishing is automatic.

## What is held back from public

Defined in `tools/sync_public.sh` (`PRIVATE_FILES`):

- Premium code — `platforms/electron/premium/`, `shared/frontend/premium/`
- Internal docs — `CLAUDE.md`, `ROADMAP.md`, `HANDOFF.md`, `FEATURES.md`,
  `TESTING.md`, `VERIFICATION.md`, `SESSION-LOG.md`, `docs/dev/`
- Internal tooling — `tools/`, `.github/workflows/sync-public.yml`

Everything else is published.

## How it runs

`.github/workflows/sync-public.yml` fires on every push to `main` (and via the
manual "Run workflow" button). It calls `tools/sync_public.sh`, which strips the
private files and **force-pushes** the result to public `main`.

## Why it is safe to automate (three fail-closed gates)

The script publishes nothing unless all three pass:

1. **Premium-present guard** — aborts if the expected premium dirs are missing.
   Catches the failure where a restructure moves a folder and the strip silently
   no-ops (this is what broke the sync silently from March–June 2026).
2. **Post-strip verification** — after stripping, re-scans the exact tree about
   to be published and aborts if *any* premium or internal file survived.
3. **Secret scan** — aborts if API-key / token / private-key patterns appear in
   the published tree.

Any trip cleans up and exits non-zero without pushing. A denylist normally fails
*open* (forget to list something → it leaks); these gates make it fail *closed*.

## One-time setup: the token

The workflow needs push access to the public repo. The default `GITHUB_TOKEN`
cannot push to a different repo, so add a Personal Access Token:

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate.
2. Resource owner: `Zbrooklyn`. Repository access: **only**
   `Zbrooklyn/WhisperClick-Desktop-App`.
3. Permission: **Contents → Read and write**. Set an expiry and note the renewal.
4. Copy the token.
5. In the **private** repo (`whisperclick-dev`): Settings → Secrets and variables
   → Actions → New repository secret. Name: `PUBLIC_SYNC_TOKEN`, value: the token.

Until this secret exists, the workflow safely skips (it does not publish).

## When the structure changes

If premium or internal-doc paths ever move, update both `PRIVATE_FILES` and
`REQUIRED_EXCLUDE` in `tools/sync_public.sh`. If you forget, the gates abort the
sync instead of leaking — fix the paths and the next push republishes.

## Manual run

`bash tools/sync_public.sh` from a clean working tree (needs a `public` remote:
`git remote add public https://github.com/Zbrooklyn/WhisperClick-Desktop-App.git`).
