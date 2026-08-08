# Cleaner pass — BL-846, BL-722 (2026-08-08)

## Context
QA merge-up note (BL-773/819/822/839, approved 06303f63) merged first
(conflict in `docs/index.md` — both branches had appended distinct how-to
links; resolved by keeping both entries).

Then two coder handoffs merged in sequence:
- BL-846 (e2ef8824a3) — new: `resolveMonoRouterAwareRoleEntry` in
  `extension/src/tools/telegram-front-desk-bot.ts`.
- BL-722 (5042cc2212) — a coder fix for a documenter bounce (missing
  `required_wiring` literal string in `telegramCursorBridgeLive.ts`); adds
  one marker comment, no behavior change. BL-722's substantive
  `pilotSafeDefects.ts` work was already reviewed in the prior cleaner pass
  (`BL-722-BL-852-BL-847-BL-853-cleaner-pass-20260808.md`).

## Review scope
- `extension/src/tools/telegram-front-desk-bot.ts` (BL-846):
  `resolveMonoRouterAwareRoleEntry` is a small, pure, well-commented helper
  (marker lookup -> resident-entry lookup -> fallback to today's
  role-lookup). No changes needed.
- `extension/src/tools/telegramCursorBridgeLive.ts` (BL-722): single-line
  marker comment, no behavior change. Nothing to clean.

## Mutation-site size (BL-485)
`node extension/out/tools/mutation-site-count.js` on both touched files
reports both `telegram-front-desk-bot.ts` (1513 sites) and
`telegramCursorBridgeLive.ts` (1297 sites) as `over` the 100-site threshold.
Both are pre-existing, already-oversized files; BL-846 adds ~30 lines and
BL-722 adds one comment line. A split is a soft advisory to weigh, not a
gate — splitting either file is out of scope for these tiny, targeted
changes and would only bloat this diff with unrelated churn. Not actioned.

## Verification run
- `npm run compile` — clean (stale `out/` was the actual cause of an
  initial local test failure — the two BL-846 property/unit test files
  import from `../out/tools/telegram-front-desk-bot`, and the merge landed
  before a compile; after `npm run compile`, all pass).
- Targeted: `telegramFrontDeskBotCli.test.js`, `pilotSafeDefects.test.js`,
  `pilotSafeDefects.property.test.js`, `telegramCursorBridgeCore.test.js`,
  `telegramCursorBridgeLive.test.js` — 498/498 passed, including the six
  new BL-846 `resolveRolePaneTarget` unit tests and the two BL-846
  property tests.
- Full `npx vitest run` (extension/): 7235/7243 passed. All 8 failures are
  pre-existing and unrelated to BL-846/BL-722:
  - 6x `dependencyGateCli*.test.js` — same known cause as the prior
    cleaner pass: `dependency-cruiser` requires Node ^22||^24||>=26, host
    runs Node 20.20.2. Neither this batch nor its diff touches
    dependency-gate code.
  - 2x `renderBriefingDiagramsCli.test.js` (`main() runs in-process...`,
    `the compiled CLI runs standalone...`) — passed in isolation
    (`npx vitest run test/renderBriefingDiagramsCli.test.js`, 4/4 green);
    fail only under full-suite parallel load (20s test timeout vs.
    measured host load average 21-27 on this run). Flaky-under-load, not a
    regression from this diff — neither BL-846 nor BL-722 touches
    briefing-diagram rendering.
- No swarmforge/*.bb scripts touched by either ticket.

## Verdict
NONE — no defects found. Forwarding to architect.
