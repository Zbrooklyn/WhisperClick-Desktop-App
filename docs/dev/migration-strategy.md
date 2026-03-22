# Migration Strategy — WhisperClick

> Created: 2026-03-22
> Decision: Freeze Electron folder, create migration workspace

---

## The Approach

1. **Freeze** `projects/WhisperClick Electron/` — this is the known-good fallback.
   All current releases (v2.2.0-beta) ship from here. No structural changes.
   Bug fixes only if critical.

2. **Create** `projects/WhisperClick Migration/` — this is the workspace where
   restructuring happens safely. Clone everything from Electron, then reorganize
   into the shared + platform-specific structure.

3. **Build Tauri** inside the migration folder. The Electron code is there too,
   so we can verify both platforms work from the same shared code.

4. **When Tauri is stable**, the migration folder becomes the primary. The
   original Electron folder is archived.

## Why This Works

- **Zero risk to shipping product.** Original folder is untouched. GitHub pushes
  and releases come from there until migration is complete.
- **Safe experimentation.** If the restructure breaks something, delete the migration
  folder and start over. No git history damage, no broken releases.
- **Clear separation.** No confusion about which folder is production vs experimental.
- **Natural rollback.** If Tauri doesn't work out, the Electron folder is still there,
  exactly as it was, ready to continue development.

## Folder Structure

```
projects/
  WhisperClick Electron/     ← FROZEN — known-good, ships releases
    electron/
    src/
    engine/
    tests/
    docs/
    ...

  WhisperClick Migration/    ← ACTIVE — restructure + Tauri work
    shared/
      frontend/
        index.html           ← copied from Electron src/frontend/
        css/
        js/
      pill/
        pill.html            ← copied from Electron src/pill/
      engine/
        engine.py            ← copied from Electron engine/
        requirements.txt
    platforms/
      electron/
        main.js              ← copied from Electron electron/
        preload.js
        preload-pill.js
        state-machine.js
        sidecar.js
        store.js
        tray.js
        updater.js
        logger.js
      tauri/
        src-tauri/           ← Rust backend (new)
          src/
            main.rs
            state_machine.rs
            commands.rs
            gate.rs
            sidecar.rs
          Cargo.toml
          tauri.conf.json
        bridge.js            ← replaces preload.js for Tauri
        pill-bridge.js       ← replaces preload-pill.js for Tauri
    tests/
      shared/                ← state machine patterns, torture scenarios
      electron/              ← Electron-specific mocks + tests
      tauri/                 ← Rust tests
    docs/
    .github/
      workflows/
        build-electron.yml
        build-tauri.yml
    package.json             ← Electron deps
    Cargo.toml               ← Tauri/Rust deps (workspace root)
```

## Phases

### Phase M0 — Create Migration Folder + Clone

1. Create `projects/WhisperClick Migration/`
2. Copy all files from `WhisperClick Electron/`
3. Initialize new git repo (fresh history — clean start)
4. Verify: `npm test` passes in the new folder
5. Verify: `npm start` launches the app from the new folder

### Phase M1 — Restructure to Shared + Platform Layout

1. Create `shared/` directory
2. Move `src/frontend/` → `shared/frontend/`
3. Move `src/pill/` → `shared/pill/`
4. Move `engine/` → `shared/engine/`
5. Move `electron/` → `platforms/electron/`
6. Move `tests/` → `tests/electron/` (for now — split shared later)
7. Update all path references in Electron code
8. Update `package.json` paths
9. After EACH move: run `npm test` — fix broken paths immediately
10. After ALL moves: full test suite + launch app + verify it works

### Phase M2 — Verify Electron Still Works from New Structure

1. `npm test` — all 538 tests pass
2. `npm start` — app launches, record/stop/transcribe works
3. `npm run dist:win` — installer builds correctly
4. Verify pill, tray, hotkey, auto-enter all work
5. This is the "Electron still works after restructure" gate

### Phase M3 — Begin Tauri (Phase T0 from migration plan)

1. Install Rust + Tauri CLI
2. Create `platforms/tauri/` with Tauri project
3. Point Tauri at `shared/frontend/index.html`
4. Verify it renders
5. Continue with T1-T6 from the Tauri migration plan

## Rules

1. **Never modify `WhisperClick Electron/` during migration** — it's frozen.
   The only exception is critical bug fixes that users need immediately.

2. **If a bug fix is needed:** Fix it in `WhisperClick Electron/`, push/release from
   there. Then cherry-pick or manually apply the fix to `WhisperClick Migration/`.

3. **Test after every file move.** Not after 5 moves. After EACH move. One broken
   path is easy to find. Five broken paths at once is a nightmare.

4. **Commit after each successful move.** Small atomic commits. If something breaks
   later, you can bisect to find which move caused it.

5. **Don't optimize during restructure.** The goal of M0-M2 is to reorganize files
   without changing any code. Refactoring comes later. Move first, improve second.

## When Is Migration "Done"?

The migration folder replaces the Electron folder when:

1. Tauri version has full feature parity with Electron
2. Tauri version passes all tests (equivalent coverage)
3. Tauri version ships as v3.0.0 stable
4. Users have migrated (installer download, not auto-update)
5. No critical bugs reported for 2 weeks after stable release

At that point:
- `WhisperClick Migration/` → rename to `WhisperClick/` (or `WhisperClick Tauri/`)
- `WhisperClick Electron/` → rename to `WhisperClick Electron (archived)/`
- Update `projects/INDEX.md`

---

*Document created: 2026-03-22*
*Status: Strategy approved — not started*
