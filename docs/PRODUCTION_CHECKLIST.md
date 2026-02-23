# WhisperClick V3 Production Checklist

Last updated: 2026-02-20
Scope: `projects/WhisperClick V3`

This checklist is a practical execution companion to:
- `docs/ROADMAP.md` (prioritization)
- `docs/PRODUCTION_AUDIT_CHECKLIST.md` (formal release gate)

## P0 - Must Be True Before Launch

- [x] Desktop app launches and keeps running in headed mode.
- [x] API keys persist across relaunch and can be verified in-app (OpenAI/Gemini).
- [x] Global hotkey can be captured in settings (`Record` flow) and saved.
- [x] Hotkey runtime rebinding is attempted immediately after settings save.
- [x] Timer returns to `00:00` after recording pipeline returns to idle.
- [x] Local model manager in Settings can select downloaded models.
- [x] History search works in the History section.
- [x] Pill widget recording path matches main UI provider/model/API-key behavior.

## P0 - Manual Validation Matrix

- [ ] Local mode end-to-end recording (start, stop, history entry, repeat cycle).
- [ ] API mode end-to-end recording with valid OpenAI key.
- [ ] API mode end-to-end recording with valid Gemini key.
- [ ] Invalid API key path gives clear user guidance.
- [ ] Offline/timeout API path gives clear retry guidance.
- [ ] Global hotkey works consistently while app is focused and while minimized.
- [ ] Tray menu actions: Show, Record, Settings, Quit.
- [ ] Pill show/hide/open-settings/paste-last actions behave correctly.

## P1 - Strongly Recommended Before Public Release

- [ ] Microphone resilience: permission denied, device unplug/switch, default device changes.
- [ ] Rapid toggle stress test: no stuck recording or stuck processing state.
- [ ] Long recording stress test: acceptable CPU/memory, no state corruption.
- [ ] Start-with-Windows verification after reboot/login.
- [ ] Always-on-top toggle behavior verification.

## Packaging and Distribution

- [ ] Folder portable build launches successfully on test machine.
- [ ] One-file portable build launches successfully on test machine.
- [ ] Installer install/uninstall/upgrade flows verified on clean machine.
- [ ] Taskbar/tray/app icons are correct in all packaged artifacts.

## Notes

- History search: Fixed (substring filter on text + title).
- Pill recording parity: Fixed (backend now supports OpenAI + Gemini with keyring-stored keys).
- Minimize button: Added back to custom title bar.
