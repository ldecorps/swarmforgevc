# BL-695 cleaner bounce (inv2) — 2026-08-25

## Inbound

Coder tip `d0df79a84e` is a **merge** of hitchhiked coder ancestry with
cleaner tip `40fc92605c`. Tip surface for the bounce is two files:

- `extension/src/tools/telegram-front-desk-bot.ts` — call
  `retireTrackedSupervisorRecords` at start of `main()` before standing
  Operator topic bind
- `extension/test/topicThreadKind.test.js` — order lock

Did **not** merge `d0df79a84e` (would re-import hitchhikers). Applied the
bounce-only patch onto current hitchhike-free tip (already contains
`40fc92605c` ancestry via prior rematch stack + BL-580 QA merge-up).

## Checks run

1. **Compile** — OK.
2. **Unit** — `topicThreadKind.test.js`: 7/7 (includes inv2 order test).

## Cleanup performed

NONE — bounce wiring is a two-line call + import; no further DRY owed.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-695-bounce-inv2-land-without-icon-migrate`.

By cleaner.
