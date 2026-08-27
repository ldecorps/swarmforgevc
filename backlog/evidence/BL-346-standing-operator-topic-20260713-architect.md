# BL-346 standing-operator-topic — 20260713 (architect)

## Verdict: PASS, forwarded to hardener

## What was reviewed

Merged cleaner's `57e3d8654d` into the architect worktree and reviewed the
combined parcel (coder's `decideEnsureOperatorTopicAction` +
`ensureOperatorTopic` addition).

## Hard gate: dependency-gate.js

Ran (from `extension/`):

```
node out/tools/dependency-gate.js \
  src/tools/telegram-front-desk-bot.ts \
  src/tools/telegramFrontDeskBotCore.ts \
  test/telegramFrontDeskBotCli.test.js \
  test/telegramFrontDeskBotCore.test.js
```

Result: `Dependency-rule gate PASSED: no forbidden edges.` (exit 0)

## Logical coupling: co-change-report.js

Ran against the parcel's changed files. All SUSPECTED COUPLING reported is
the already-established Telegram front-desk cluster (`telegram-front-desk-
bot.ts` <-> `telegramFrontDeskBotCore.ts` <-> their own test files <->
`concierge/topicRouter.ts`/`conciergeTick.ts`) — pre-existing structure,
not something this ticket newly introduced. No unexpected pairing.

## Boundary checks

- `decideEnsureOperatorTopicAction` (`telegramFrontDeskBotCore.ts`) is pure
  — the reserved-subject twin of the existing `decideTopicAction`
  (`topicRouter.ts`), keyed only by the map's subject-id value, never by
  the topic's (unstable) name. `ensureOperatorTopic`
  (`telegram-front-desk-bot.ts`) is the thin impure adapter: reads the
  topic map, calls the existing `createForumTopic`, writes the map — same
  policy/adapter split already used throughout this file.
- BL-334's restricted-Operator boundary (`--tools ""`,
  `launch-front-desk-operator!`) is untouched: zero `.bb` files are part of
  this parcel's diff (confirmed via `git diff` scoped to the merge). The
  coder traced the full routing chain and reuses it unmodified — the
  reserved `OPERATOR_SUBJECT_ID` needed no special-casing anywhere
  downstream.
- `ensureOperatorTopic` is called once in `main()` before any of the three
  polling loops start — a failed create degrades quietly (logged, not
  thrown) and never blocks ordinary SUP-###/BL-### routing; the next
  restart retries since the map still lacks the binding. No live process
  destabilized by a failure path.
- Secrets: `botToken`/`chatId` are threaded through as existing
  `requiredEnv`-sourced parameters, same as every other call in this file
  — no new secret-handling surface.
- CLI testability: `ensureOperatorTopic` is exported and exercised
  directly (with a fake `postFn`) in `telegramFrontDeskBotCli.test.js`,
  not hidden inside an untestable `main()`.

## Build

`npm run compile` — clean, no errors, before running the gate tools.

No violations found. Forwarded to hardener with the same task name.
