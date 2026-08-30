# BL-1253 — hardener pass, 2026-08-30

Merged architect commit `95475dcfdc` (design-review evidence, no defect
found). This ticket is review-only (BL-848 stamp-off of already-landed
hotfix `2ec06b6ef1`); no `extension/src/*.ts` production file is touched by
the parcel, so the CRAP gate is not applicable and there is no product
behavior to mutation-test with Stryker.

## Load/process hygiene
- `uptime` at start: load average 1.25 2.19 3.07 on a quiet host.
- No leftover `node --test`/`stryker` processes before or after this pass.
- No fixture leaks: `git status --short extension/test/` clean throughout.

## Runs
- `npm run compile` (extension) — clean.
- `run_acceptance.sh` on the ticket's feature file — 7/7.
- **BL-113 soft Gherkin mutation** on the `Scenario Outline` (stamp-01,
  3 examples): `run_gherkin_mutation.sh <feature> ./tmp/bl1253-gherkin
  specs/pipeline/steps/index.js soft` — 6/6 mutants killed (both
  `<heartbeat>` and `<behaviour>` columns are keyed lookups in the step
  regexes, not shape-based — no BL-908-class blind spot). Manifest written
  into the feature file (`Total:6 Killed:6 Survived:0 Errors:0`); a
  same-command re-run correctly soft-skipped per the BL-460 stamp
  discipline.
- `bb swarmforge/scripts/test/bl1253_stamp_ledger_human_decision_property_runner.bb`
  — ALL PASS, 400 runs, same five-shape coverage the architect reported.
- `npx vitest run test/telegramCursorBridgeCore.test.js
  test/cursorBridgeInboundQueue.test.js --config vitest.config.mjs` —
  137/137, unchanged from the architect's run.

## Standing whole-tree guards (parcel touches `specs/pipeline/steps/`)
Ran all 16 non-property `test/*Guard*.test.js` files. 3 failed:
`tempDirTrapGuard`, `socketFixtureShortRootGuard`, `liveRepoDerivationGuard`.
None of the violations named in any of the three failures reference this
parcel's files (`bl1253DeadFeederOwnsGetUpdatesStampSteps.js`,
`bl1253StartCursorBridgeFeederCli.sh`,
`bl1253_stamp_ledger_human_decision_property_runner.bb`) — confirmed by
grep of the failure output. All three are pre-existing standing reds,
already ticketed and paused: `backlog/paused/BL-1289-a-temp-root-is-always-
cleaned-up.yaml`, `backlog/paused/BL-1290-a-socket-fixture-is-rooted-short-
enough-to-bind.yaml`, `backlog/paused/BL-1291-a-live-repo-read-is-pinned-or-
justified.yaml` (Article/BL-1063 discipline: verified via
`grep -rl <guard-name> backlog/` before reporting, not reported as new).

## Disposition
No defect found; no hardening changes needed beyond writing the BL-113
Gherkin mutation manifest. Forwarding to documenter.
