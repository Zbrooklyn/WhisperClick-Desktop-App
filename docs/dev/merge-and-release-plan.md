# Merge & Release Plan — State Machine Refactor

> Created: 2026-03-22
> Branch: `feature/state-machine` (23 commits ahead of main)
> Tests: 538/538 passing
> Audit: Clean — no blocking issues

---

## Phase 1: Live Testing (verify before merge)

Must-do before any merge. The app is running on the feature branch.

1. **Normal recording flow** — pill click → record → stop → transcribe → paste
2. **Back-to-back recording** — record immediately after transcription (the original v2.1.1 bug)
3. **Cancel during processing** — click X while transcribing
4. **Double-click pill** — rapid clicks, verify no stuck state
5. **Hotkey while recording** — Ctrl+Alt+R to toggle
6. **Close main window** — pill should appear, record from pill
7. **Reopen from tray** — clock should be 00:00, not phantom counting
8. **Auto-Enter modes** — test Off, Button, Auto
9. **Error recovery** — remove API key, try recording, see error, re-add key, try again
10. **Settings change during recording** — change provider mid-recording

**Pass criteria:** All 10 scenarios work. Debug log shows clean transitions.

## Phase 2: Merge to Main

After live testing passes.

1. **Squash-merge or regular merge** to main (preserve commit history for auditability)
2. **Verify tests pass on main** — `npm test` exits 0
3. **Push to origin** — `git push origin main`

## Phase 3: Version Bump & Release

1. **Bump version** to v2.2.0 (minor version — internal refactor, no behavior changes)
2. **Update CHANGELOG.md** with state machine refactor summary
3. **Update HANDOFF.md** — last_updated, completed items, next steps
4. **Update CLAUDE.md** — test count (538), any new conventions
5. **Commit docs** — single commit for all doc updates
6. **Push to origin** — `git push origin main`

## Phase 4: Sync & Deploy

1. **Sync to public repo** — `bash tools/sync_public.sh`
2. **Create GitHub release** — v2.2.0 with release notes
3. **Monitor CI** — verify all platform builds (Windows, macOS ARM/Intel, Linux)
4. **Verify auto-updater** — existing users should see the update

## Phase 5: Post-Release Cleanup

1. **Delete feature branch** — `git branch -d feature/state-machine`
2. **Update GSD STATE.md** — mark all phases complete
3. **Update ROADMAP.md** — Phase F0 (state machine) marked complete
4. **Clean up .planning/** — decide: keep for history or gitignore?
5. **Save session learnings to memory** — GSD evaluation, post-mortem lessons

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Behavior change users notice | Low | Medium | Pure refactor, no UX changes. 538 tests verify. |
| Memory leak from new patterns | Low | Low | Phase R1 (production readiness) measures this. |
| Flaky CI test from timing | Medium | Low | 1-2 matrix tests are timing-sensitive. Non-blocking. |
| Sidecar desync after merge | Very Low | High | canAcceptAction gate + sidecar auto-recovery prevent this. |

---

*Plan created: 2026-03-22*
