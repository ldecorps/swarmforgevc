# BL-1244 QA pass — unrelated standing reds found in full-suite run (2026-08-29)

BL-1244 itself PASSES (see approval). While running the full unit suite as
part of BL-1244's QA gate, `npx vitest run --exclude 'test/**/*.property.test.js'`
(CURSOR_API_KEY sourced from `.swarmforge/swarm.env`) surfaced failures with
zero file overlap with BL-1244's changed files
(`telegramFrontDeskBotCore.ts`, `telegram-front-desk-bot.ts`). Triaged:

**Already tracked, confirmed by grep:**
- 24-27 `require('node:test')` import files → BL-1220 (paused, approved, todo).
- Whole-tree guard reds (`liveRepoDerivationGuard`, `socketFixtureShortRootGuard`,
  `tempDirTrapGuard`, `tmpDirMigrationGuard`, `constitutionDocCitations`) →
  named as pre-existing/separately-owned in BL-1220's own out_of_scope.
- CURSOR_API_KEY ambient-absence (before sourcing swarm.env) → BL-720
  (done; the leak itself is fixed, this session's shell just lacked the
  ambient var — infra, not code).

**Grepped backlog/{active,paused,hold,done}, found NO clear ticket —
reporting as untracked, not investigated further (outside BL-1244 scope):**
- `test/backendSwitch.test.js` — `readRoleModelId` returns `cursor/auto`,
  test expects `auto`.
- `test/backlogDashboard.test.js` — `needsApproval` entries now carry an
  `approvalContext: undefined` key the test's `assert.deepEqual` doesn't
  expect.
- `test/operatorRuntimeBbFixtureClosure.test.js` — both tests fail (fixture
  closure check, `OPERATOR_RUNTIME_BB_FILES` mismatch).
- `test/pilotAcceptanceGateCli.test.js` — `main(): a claim-refused land...`
  diff mismatch.
- `test/selfHealTelemetry.test.js` — `Error: Cannot find module
  '../out/metrics/selfHealTelemetry'` (compiled output missing/moved).
- `test/telegramClient.test.js` — `sendTelegramPoll` assertion failure.
- `test/telegramCursorOperatorExec.test.js` — `BL-698: ambulance engage and
  release via execute` failure.
- `test/backfillEpicTopicIconsCli.test.js` + `backfillStandingTopicIconsCli.test.js`
  (5 failures total) — icon-id assertions return `undefined`; tangentially
  close to BL-1210 (icon ownership marker dropped for non-ticket topics) but
  not a confirmed match — worth specifier eyes.

None of these touch BL-1244's files; none were introduced by BL-1244's
commits (verified: BL-1244's only content changes are
`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`, its own
test/property/step files, `specs/pipeline/steps/index.js`,
`property_suite_standing_allowlist.tsv`, and docs). Local `main` and
`origin/main` have also diverged significantly this shift (45 vs 47 unique
commits) across many in-flight tickets, which may be contributing noise via
repeated "Merge main into X worktree" steps — not root-caused here.

Reported per BL-1063 doctrine (grep before calling something untracked) —
not bounced, not blocking BL-1244's approval.
