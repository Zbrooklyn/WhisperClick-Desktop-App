# Summary-system audit — evidence bundle

Supporting artifacts for [`../summary-system-audit.md`](../summary-system-audit.md) (the 2026-07-19 ground-truth audit of WhisperClick's summary system).

## Fixture

- **`fixtures/ashley-gross-ai-consultant.txt`** — the exact transcript audited. Source: YouTube *"So You Want to Be an AI Consultant? Start With These 10 Questions"* (Ashley Gross / AI Workforce Alliance), https://youtu.be/uZyq1p9kRDU, duration 18:14. Imported through WhisperClick's real `import_url` pipeline (yt-dlp → ffmpeg → transcription), 18,680 chars. This is the **educational-video regression fixture** referenced in the replacement spec.
  - Known raw-transcription defects preserved in this fixture (do not "fix" the file — they are the test): `ROI`→`RY` (×36), `generative AI`→`gender AI` (×1), likely `chatbot`→`shop bot` (×1), sentence-boundary noise. These are the corrections the future normalization layer must produce (while keeping this raw text immutable).

## Live outputs (raw, uncleaned)

Generated against the isolated test server (`http://127.0.0.1:8793`, real OpenAI key) on note id `1784499018527-7925f3df0090`.

- **`outputs/gen-summaries.json`** — all 12 `/api/summarize` combinations (style ∈ brief/bullets/detailed × note_type ∈ auto/meeting/idea/call).
- **`outputs/gen-actions.json`** — 4 `/api/action` analysis presets (bullet points, action items, key takeaways, chapters).
- **`outputs/ashley-gross-full-readout.md`** — the assembled Review read-out (summary + decisions + action items + key quotes + ask-next + full transcript) as the product's own export would produce it.

## Scripts (exact tools used)

Run from the WhisperClick repo root with the test server up. They target the note id above and write into the session scratchpad; paths are hard-coded to the audit session and are included for provenance/reproducibility, not as a reusable harness.

- **`scripts/gen-summaries.mjs`** — drives the 12 summarize combinations.
- **`scripts/gen-actions.mjs`** — drives the 4 analysis presets through `/api/action`.
- **`scripts/build-export.mjs`** — assembles the full read-out from the persisted item + `/api/review-details` + `/api/key-quotes` + `/api/followups`.

## Reproduction outline

1. Start the isolated test server (`WC_PORT=8793`, TEMP pointed at a scratch home with a `settings.json` carrying an OpenAI key). Never point these at the live `:8791` instance.
2. `POST /api/import-url {"url":"https://youtu.be/uZyq1p9kRDU"}` → returns the note id.
3. Run the scripts (update the hard-coded id if re-importing).

Model note: every summary/extraction op resolves to **gpt-4o-mini** (see the audit §2/§6); outputs are non-deterministic, so re-runs will differ in wording but not in the structural findings.
