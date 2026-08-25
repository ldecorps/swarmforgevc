# BL-695 cleaner pass (rematch) — 2026-08-25

## Inbound

Coder tip `c9cb40f693` — hitchhike CLEAN on path names. Rematched onto
`origin/main` = `e549feda53`. Tip had re-inlined drain helpers and
simplified Cursor-topic adopt in `telegram-front-desk-bot.ts` (regressions
vs main).

## Checks run

1. Gherkin — BL-695 feature — 7/7 (after `npm run compile`)
2. vitest `topicThreadKind.test.js` — 16/16
3. vitest properties `topicThreadKind.property.test.js` — 3/3

## Cleanup performed

- Restore `telegram-front-desk-bot.ts` drain imports / re-exports and
  Cursor lets-talk adopt path from `origin/main`.
- Keep only BL-695 surface: `topicsDir` + `retireTrackedSupervisorRecords`
  migrate in `main()` before `ensureOperatorTopic`.

## Forward

`git_handoff` to architect, priority 50, task
`BL-695-supervisor-threads-are-not-front-desk-topics`.

By cleaner.
