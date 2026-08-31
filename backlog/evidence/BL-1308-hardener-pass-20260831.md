# BL-1308 — hardener pass, 2026-08-31

Merged architect's tip `1e319901c7` into hardender at `9c1ef9c839`. The merge
moved `backlog/active/BL-1300-...yaml` -> `backlog/hold/...yaml`
(content-identical, per specifier's BL-1307 adjudication); named in the merge
commit message per the merge-deletion hook's own requirement.

## Change under hardening

One-line production fix: `ancestry-commits` in `swarmforge/scripts/land_step_lib.bb`
drops `--first-parent` from `git rev-list`, so the sibling detector's candidate
walk now covers every commit `own-commit-changed-paths`'s `:delivered` diff can
draw content from (a merge diffed against its first parent pulls in everything
its second parent carried). Shape 1 from the ticket's two offered directions.

## BL-149 cooldown gate

`bb swarmforge/scripts/mutation_cooldown_gate.bb <root> swarmforge/scripts/land_step_lib.bb`
-> `DECISION: skip-cooldown` (file_age_days 0.22, cooldown 3 days; load quiet at
2.21/20 cores). Per Hardening Order, mutation testing on this file is skipped
this pass — the file is still actively churning. No fallback mutation sweep run
on it beyond what is already below; Babashka has no wired Stryker/CRAP/DRY
regardless (engineering.prompt), so coverage rests on the hand-authored bb
suite, the real-git property tests, and the acceptance feature — all run and
verified this pass.

## Runs performed

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` -> `ALL PASS:
  land_step_lib.bb`, including the three new BL-1308 cases (second-parent-only
  sibling named+unlanded, land-plan forces replay, first-parent sibling still
  found alongside a second-parent one).
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1308-...feature` -> 5/5 pass.
- BL-113 soft Gherkin mutation on the one `Scenario Outline` (2 `Examples`
  rows) -> 2/2 killed, 0 survived, 0 errors. Manifest stamp written into the
  feature file and committed (mutation-stamp sha256, tested_at
  2026-08-31T00:11:24Z).
- Property lane, scoped file:
  `npx vitest run --config vitest.properties.config.mjs
  test/bl1308SiblingDetectorCoversReplay.property.test.js` -> 2/2 pass,
  10.1s. Both invariants drive the real CLI over real git repos with a
  constructed oracle; `assertReach` requires the generator to actually build a
  merge with a sibling on the second parent (and, for invariant 1, to reach the
  replay branch) before the property counts — not a vacuous green.
- Standing whole-tree guards (this parcel touches `specs/pipeline/steps/` and
  `extension/test/`): ran every `test/*Guard*.test.js` (non-property). 3
  failures, none touching BL-1308's own files
  (`bl1308SiblingDetectorCoversReplaySteps.js`,
  `bl1308SiblingDetectorFixtureCli.sh`,
  `bl1308SiblingDetectorCoversReplay.property.test.js` do not appear in any
  violation list) — `tempDirTrapGuard`, `socketFixtureShortRootGuard`,
  `liveRepoDerivationGuard`. Each is already ticketed and paused:
  `backlog/paused/BL-1289-a-temp-root-is-always-cleaned-up.yaml`,
  `backlog/paused/BL-1290-a-socket-fixture-is-rooted-short-enough-to-bind.yaml`,
  `backlog/paused/BL-1291-a-live-repo-read-is-pinned-or-justified.yaml`.
  Pre-existing, unrelated, not this parcel's to fix.

## CRAP / DRY

No `extension/src/*.ts` file changed in this ticket — CRAP gate not
applicable. DRY (jscpd) scope is `src`; not applicable either.

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean before and
after every run in this pass. No leftover mkdtemp fixtures
(`git status --short` clean of anything under `tmp/` at handoff).

## Verdict

Clean. No test gaps found. Forwarding to documenter.
