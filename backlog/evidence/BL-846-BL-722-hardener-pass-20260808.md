# Hardener pass — BL-846, BL-722 (2026-08-08)

## Context

Batch of three items: a QA merge-up note (BL-773/819/822/839, approved
`06303f63`) and two `git_handoff`s from architect (both pointing at the same
commit `5349835ad7`, Article 2.6 batch splitting correctly applied):
BL-846 (`resolveMonoRouterAwareRoleEntry` in
`telegram-front-desk-bot.ts`) and BL-722 (a one-line
`required_wiring` marker-comment fix in `telegramCursorBridgeLive.ts`, no
behavior change — BL-722's substantive `pilotSafeDefects.ts` work was
already hardened in the prior batch,
`backlog/evidence/BL-722-BL-852-BL-847-BL-853-hardener-pass-20260808.md`).

Merged the QA note (`06303f63`) first — one conflict in `docs/index.md`
(both branches appended distinct how-to links; kept both) — then merged the
architect handoff (`5349835ad7`), which merged cleanly. Both are now
ancestors of HEAD (`git merge-base --is-ancestor` confirmed for both).

## Load conditions

Host load averaged 9–20 across this pass (`uptime`: 8.96/12.46/20.03 at
start, 18–20 throughout), well above the 2x-cores (8) threshold on this
4-core host. Per the office-hours mutation bypass, did not attempt Stryker
(dry-run is known to hard-crash even at concurrency=1 under this load).
Independently confirmed via `mutation_cooldown_gate.bb`
(`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`, macOS has no `nproc`) that both
touched files are additionally within the 3-day cooldown window regardless
(`telegram-front-desk-bot.ts` 1.75 days, `telegramCursorBridgeLive.ts` 2.29
days) — `skip-cooldown` on both, independent of the load signal.

Hardened via targeted-test + CRAP + coverage-gap verification instead, plus
a hand-walked mutation analysis of the new function's branches (below).

## Stale-`out/` trap caught and fixed (BL-497)

First scoped test run (`telegramFrontDeskBotCli.test.js` +co) showed one
real-looking failure in a BL-846 unit test (resident-pane resolution
returning the role's own session instead of the resident's). `out/` was
last built 06:08:56, predating the BL-846 coder commit (07:52:53) — a stale
compiled artifact, not a defect (the exact BL-497 trap: the runner executes
`out/*.js`, and `out/` is gitignored so a merge never brings it in). Ran
`npm run compile`; the same test then passed. All subsequent runs below are
against the fresh build.

## Hand-walked mutation analysis of `resolveMonoRouterAwareRoleEntry`

The function has four single-edit mutation points; walked each against the
existing unit + property test coverage (coder's own two BL-846 property
tests already document three non-vacuity checks by hand, extended here to
the two branches they don't explicitly narrate):

1. `role !== 'coordinator'` -> `role === 'coordinator'`: killed by
   "resolveRolePaneTarget never redirects the coordinator to the resident
   pane" (unit) and the property test's `matches` marker-kind case where
   `requestedRole === 'coordinator'` (roster generator always includes
   coordinator, `requestedRole` is drawn from the full roster).
2. `readMonoRouterActiveRole(targetPath) === role` -> `!== role`: killed by
   the property test's `other-in-roster`/`other-not-in-roster` cases (a
   flipped condition would redirect exactly when it shouldn't, and vice
   versa) — same mutation class the test's own inline non-vacuity note
   already proved by hand (`true` in place of the whole condition).
3. `roles.find((r) => r.role !== 'coordinator')` -> `=== 'coordinator'`
   (finds the wrong resident): killed by "resolveRolePaneTarget resolves
   the RESIDENT pane for a role the active-identity marker names" (roster
   `['coder','QA','coordinator']`, marker `QA` -> expects `coder`'s
   session; a flipped find would return coordinator's session instead —
   assertion is exact-match on `target`, not just "resolved something").
4. `if (resident) return resident;` inverted to `if (!resident)`: killed by
   the same test (would fall through to the non-redirect branch, returning
   QA's own — nonexistent — session, differing from the asserted resident
   target).

No mutation point survives unmet. Consistent with the coder's own
documented non-vacuity checks (both property tests' file-header comments).

## Coverage / CRAP / DRY (scoped, changed files only)

- `npx vitest run --coverage telegramFrontDeskBotCli pilotSafeDefects
  telegramCursorBridgeCore telegramCursorBridgeLive bl846` (post-recompile):
  512/512 passed.
- `node scripts/crapReport.js src/tools/telegram-front-desk-bot.ts
  src/tools/telegramCursorBridgeLive.ts`, filtered to the two functions this
  parcel touches: `resolveMonoRouterAwareRoleEntry` complexity=4,
  coverage=100%, CRAP=4.00; `resolveRolePaneTarget` complexity=3,
  coverage=100%, CRAP=3.00. Both well under the <=6 gate. The report's many
  other CRAP>6 hits in these two hub files (`handleOperatorGateDecision`,
  `followOperatorExecuteResult`, etc.) are pre-existing and untouched by
  this parcel's diff (confirmed via `git show --stat` on both coder
  commits, `e2ef8824a3` and `5042cc22`) — same pre-existing-debt scope the
  prior architect pass already documented.
- `npx jscpd --config .jscpd.json src/tools/telegram-front-desk-bot.ts
  src/tools/telegramCursorBridgeLive.ts`: 2 clones, both at line ranges
  (1107-1140, 1530-1603) outside both coder commits' diffs — pre-existing,
  out of scope.
- BL-722's own diff (`5042cc22`) is a single comment line in
  `telegramCursorBridgeLive.ts` — no function, no coverage/CRAP/DRY surface
  to harden.

## Verification run

- `npm run compile` (extension/) — clean.
- `npx vitest run --coverage telegramFrontDeskBotCli pilotSafeDefects
  telegramCursorBridgeCore telegramCursorBridgeLive bl846` — 512/512
  passed.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl846ResidentPaneResolutionFollowsIdentity.property.test.js
  test/bl846RoleAnswerDeliveryNeverLessDeliverable.property.test.js` — 2/2
  passed.
- `node specs/pipeline/cli.js
  specs/features/BL-846-role-answer-reaches-the-active-resident-pane.feature`
  — 9/9 scenarios passed, all executed (not skipped).
- No orphaned test/mutation/tmux-fixture processes
  (`pgrep -fl 'node --test|stryker|vitest'` clean; `pgrep -afl tmux` shows
  only the live swarm's own repo-socket server).

## Deferred (not blocking this forward)

- Full differential Stryker mutation run on
  `telegram-front-desk-bot.ts`/`telegramCursorBridgeLive.ts` — deferred to
  the next quiet-host pass per the office-hours mutation bypass; both files
  are also within the 3-day cooldown window regardless
  (`mutation_cooldown_gate.bb`). Hand-walked mutation analysis (above)
  substituted this pass.
- Pre-existing CRAP>6 debt and DRY clones in both hub files, untouched by
  this parcel — out of scope, not newly ticketed (no new information beyond
  what prior passes already recorded).

## Verdict

NONE — no test gaps or CRAP/DRY regressions found in this parcel's own
changed/new code. Forwarding to documenter.
