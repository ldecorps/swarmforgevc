# BL-892 — hardener pass, 2026-08-14

## Verification (before any hardener change)

- `npm test` (full unit suite): 428 files, 7585 tests, all pass.
- `npm run test:properties` (full property suite): 87 files, 268 tests, all
  pass. The 4 "Unhandled Error: [vitest-worker]: Timeout calling
  onTaskUpdate" lines are the pre-existing, already-documented BL-871
  worker-RPC heartbeat noise — non-fatal, unrelated to this ticket.
- Acceptance is `specs/features/BL-892-approval-flip-must-commit.feature.draft`
  (unbuilt — no `Scenario Outline`, no step handlers): correctly parked as a
  draft, nothing to run for this ticket per the unbuilt-feature-file
  convention.

## Coverage-gap fix

`test/pausedPagerBridge.test.js`'s existing success-path test ("paused-pager
Approve route flips human_approval to approved without moving folders")
already used a real git+`commit_integrity_cli.bb` fixture but only asserted
the WORKING TREE showed the new value — never `git show HEAD:...`. That's
exactly the gap BL-892's own invariant 1 and `qa_e2e_procedure` step 1 name
("HEAD, not the working tree, is the source of truth"), and it's the one
`commitApprovalWrites` caller the coder's exhaustive
`bl892ApprovalCommitDurability.property.test.js` doesn't reach (that
property test drives `recordApprovalDecisionAndClose`/
`recordAmendDecisionAndClose` directly, never the paused-pager HTTP route).
Added a `git show HEAD:backlog/paused/BL-060.yaml` assertion to the existing
test — non-vacuous by construction: the fixture's only prior commit is an
empty `init`, so `git show HEAD:<path>` fails outright unless the route's
own commit actually landed.

## CRAP fix (regression introduced by this ticket's own diff)

`node scripts/crapReport.js` (post-merge, pre-hardener) flagged
`src/bridge/bridgeServer.ts`'s `handlePausedPagerApproveRoute` inner
callback (lines 811-845) at complexity=7, CRAP=7.03 — over the CRAP<=6 gate.
Confirmed this is BL-892's own regression, not pre-existing debt: the
ticket's `if (!committed) {...}` branch is exactly the one decision point
that pushed complexity from 6 (pre-existing, at-threshold) to 7. Because
CRAP = complexity² × (1-coverage)³ + complexity, a complexity-7 function
cannot get under the CRAP<=6 gate at any coverage level (100% coverage
still yields CRAP=7) — this needed a complexity reduction, not more tests.

Fix: behavior-preserving split. Extracted the route's decide-what-happened
logic into a new `computePausedPagerApproveOutcome(targetPath, backlogId)`
returning `{status, body, conciergeTick}`; the route callback now just
awaits it, conditionally calls `requestConciergeTick`, and responds.
Verified no test depended on `requestConciergeTick`'s call-ordering
relative to `respondJson` (none exists in `pausedPagerBridge.test.js`), and
the extraction preserves it anyway (still called before `respondJson` on
the success path only).

Result:
- `computePausedPagerApproveOutcome`: complexity=4, coverage=100%, CRAP=4.00
- `handlePausedPagerApproveRoute`'s own callback: complexity=5,
  coverage=82%, CRAP=5.14

Full `npm run coverage` + `node scripts/crapReport.js` re-run on all four of
this ticket's changed files (`commitIntegrityRunner.ts`,
`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
`bridgeServer.ts`) after the fix: 19 flagged functions remain, all
pre-existing (unrelated to this ticket's diff) — down from 20 before the
fix, confirming this was the only BL-892-introduced offender.

## DRY

`npm run dry`: 36 clones repo-wide (down from 37 pre-hardener, incidental
line-shift), none touching this ticket's changed functions. No new
duplication introduced by either the ticket's own diff or this hardening
pass.

## Regression re-checks

- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-484-decided-ask-closes-itself.feature`:
  4/4 scenarios pass (the coder's `recordApprovalDecisionAndClose` return-shape
  fix in `bl484DecidedAskClosesItselfSteps.js` holds).
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-496-decided-ask-close-survives-rate-limit.feature`:
  4/4 scenarios pass (same fix in `bl496DecidedAskCloseSurvivesRateLimitSteps.js`).
- `npx vitest run test/pausedPagerBridge.test.js`: 15/15 pass after the CRAP
  refactor (behavior-preserving, confirmed).
- Full `npm test` + `npm run coverage` re-run after the CRAP fix: 428
  files / 7585 tests, all pass.

## Mutation — deferred (office-hours host-load bypass)

`mutation_cooldown_gate.bb` (with `SWARMFORGE_MUTATION_GATE_FORCE_CORES` set
per the documented macOS `nproc` workaround):
- `commitIntegrityRunner.ts` (18.9d old): `run`
- `telegram-front-desk-bot.ts` (3.8d old): `run`
- `telegramFrontDeskBotCore.ts` (1.3d old): `skip-cooldown`
- `bridgeServer.ts` (0.2-0.3d old): `skip-cooldown`

For the two `run`-eligible files, `npx stryker run --mutate <file>
--concurrency 1` hit the documented dry-run timeout crash
("Initial test run timed out!" after ~5min) with host load average
sustained at 8-18 on 4 cores (2x-cores threshold is 8) for the entire
session — re-checked repeatedly across ~20 minutes, never sustained below
threshold long enough for a safe attempt. Per the office-hours mutation
bypass policy: deferring the full mutation pass to the next quiet window
rather than stalling the pipeline. All coverage-gap and CRAP hardening
above was still done at full rigor; only the Stryker mutation-kill pass
itself is deferred.

## By hardener.
