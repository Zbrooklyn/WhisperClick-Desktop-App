# R8 finding + remaining Electron-side work — 2026-06-07

> Recorded at the APP-003 escalation gate. The engine refactor is complete; the
> remaining items are Electron-side and either need a product decision (R8) or a
> local (non-RDP) run to verify.

## R8 is NOT a safe "skip the renderer bounce"

The audit framed R8 as: hotkey-start bounces through the renderer, so skip it for
latency. Reading the actual code shows the bounce is **load-bearing**, not a
latency hop.

- `main.js` hotkey handler (start path): `mainWindow.webContents.executeJavaScript('triggerTrustedHotkeyToggle()')` — only for **start**; stop/cancel go direct.
- That calls the frontend `toggleRecording` (`index.html:3702`), which runs essential pre-start logic the main-process gate (`canAcceptAction`, state-only) does NOT:
  - `canRecordNow()` — blocks start when no local model AND no API key, shows a toast, opens Settings, focuses the key input.
  - local→API auto-switch when no local model but API creds exist.
  - API-credential validation + provider auto-switch.

**Conclusion:** removing the bounce would either (a) duplicate this credential/model
gating + settings UX in the main process (divergence risk), or (b) regress to
starting recordings with no usable backend. Either is a product-behavior change,
so this is an escalation gate, not an autonomous fix.

**Options for Edward:**
1. Leave as-is — the "latency" is the cost of running real pre-flight checks in one
   place; arguably correct.
2. Extract the credential/model gate into a shared module callable from both main
   and renderer, then let main start directly when the gate passes (removes the
   bounce without losing the checks). Moderate effort; needs your go.

## Remaining, blocked in this environment

- **R4 pill self-heal / R5 clean-quit live checks** — logic passes unit tests
  (392 Electron + engine suites). Watching them on a live window needs a local
  (non-RDP) session: input streams won't open here (`PaErrorCode -9996`), and I'm
  not to touch the installed app.

## Lower-value / cautioned

- Reduce engine global state into an `EngineState` object (would let handlers be
  unit-tested without a subprocess). Real testability gain but a large refactor;
  the dispatch-table decomposition already captured most of the benefit.
- Decompose `main.js` (~1360 lines, R12) — maintainability only; risks the
  "no cosmetic churn" guardrail.
