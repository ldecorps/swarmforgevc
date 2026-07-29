# INTAKE — Pilot polls always include "Need more detail"

**Date:** 2026-07-29  
**Urgency:** normal (operator UX standing rule)  
**Surface:** Cursor Remote /pilot human-question polls (BL-699)  
**Source:** human via Let's Talk voice session (2026-07-29), while piloting BL-706

## Ask (human words, paraphrased)

When the pilot surfaces questions as Telegram polls on the Cursor Remote
topic (history / forum topic), every poll must include an extra choice the
human can press when they do not have enough context to answer — labeled
along the lines of "Need more detail" / "Need extra context".

Without that escape hatch, a poll forces a pick even when the human cannot
honestly answer yet.

## Disposition

Standing rule written into:

- `composePilotExpeditorPrompt` (BL-699 human-questions block)
- `docs/how-to/BL-699-pilot-quality-bounce-backs.md`
- `specs/features/BL-699-pilot-quality-bounce-backs.feature` (pilot-quality-04)
- unit pin in `extension/test/telegramCursorBridgePilot.test.js`

Label to use on the option: **Need more detail**. If that option wins, the
pilot must post a richer brief (or fewer sharper polls) and ask again —
silence is not consent.

No new BL ticket required unless a later slice wants shared poll-helper
enforcement in code (not only prompt rule).
