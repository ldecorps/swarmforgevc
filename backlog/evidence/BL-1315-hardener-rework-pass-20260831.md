# BL-1315 — hardener rework pass (post-bounce), 2026-08-31

Verifying the coder's fix (`abc7cfed38`) for the hardener's own bounce
(`64156b80cf`, scenario 07): `path-owner-tickets` now returns
`{:owners #{...} :any-untagged? bool}`, and `own-paths`' exclusion cond
requires `(not (:any-untagged? attribution))` before dropping a path —
so a path touched by both an unlanded sibling's tagged commit and a later
untagged own-chain commit is kept (invariant 1).

Pre-run: `uptime` load average 0.03/0.61/1.09 (20 cores), no orphaned
`node --test`/stryker processes scoped to this worktree. `git diff
64156b80cf HEAD --stat`: only `land_step_lib.bb` changed since the bounce.

## Ran, not assumed clean

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS,
  including scenario 07 (the bounce's own regression, now green) and
  scenarios 01–06 plus every pre-existing entangled-siblings/BL-1272/BL-1308
  scenario.
- `npx vitest run --config vitest.properties.config.mjs
  bl1315OwnPathsFullRangeInvariants.property.test.js
  bl1297MergeOwnPathsInvariants.property.test.js` — 2 files, 5 tests, all
  pass (25.99s). Confirmed by reading the generator
  (`bl1315OwnPathsFullRangeInvariants.property.test.js`'s `ownPathsList`/
  `siblingPathsList` use disjoint `own/ownN.txt` / `sibling/sibN.txt`
  filenames) that this property suite does NOT exercise scenario 07's shape
  (a path name SHARED between an own untagged commit and a sibling's tagged
  commit) — matches the bounce evidence's own note that no existing fixture
  covered that combination. The property suite is therefore reconfirmed as
  still passing on the fix, not as having caught the bounce's defect itself.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1315-the-replay-tip-carries-only-the-ticket-being-landed.feature`
  — 7/7 scenarios pass.
- BL-113 soft Gherkin mutation on the one `Scenario Outline` (scenario 02,
  2 Examples rows): `run_gherkin_mutation.sh <feature> <fresh-tmp-under-./tmp>
  specs/pipeline/steps/index.js soft` — 2/2 mutants killed, 0 survived, 0
  errors, `"outcome": "pass"`. No `Scenario Outline` elsewhere in the feature
  (BL-638 n/a for the other 5 plain scenarios). The run wrote the manifest
  stamp into the feature file (first BL-113 run for this feature); committed
  alongside this evidence file. Work dir was a fresh `mktemp -d
  ./tmp/bl1315-gherkin-XXXXXX` per the BL-30/BL-1224 rule, removed after the
  run.
- CRAP/DRY: not applicable — confirmed via `git diff main..HEAD --stat`,
  same as the architect's and prior hardener pass's finding: no
  `extension/src/*.ts` file is touched by this parcel (`jscpd`/`crapReport.js`
  are both scoped to `extension/src` per `package.json`).
- Orphan/leak check: no `bl1241-fixture-*` or `sfvc-bl1315-*` fixture dirs
  left in `/tmp` or `$TMPDIR` after the full run; `git status --short` clean
  except the mutation-manifest stamp. The two long-lived `bb` processes seen
  in a `pgrep` sweep (`expedite_cli.bb`, `cursor_bridge_supervisor.bb`) are
  this expedite run's own orchestration and the standing bridge supervisor,
  not leftover test processes.

## Not re-litigated (already recorded, non-blocking)

- The prior hardener pass's "minor, NOT blocking" observation
  (`commit-ticket-id` collapsing "no ticket" and "unreadable commit" into one
  `nil`) — unaffected by this fix, still recorded as non-blocking in
  `BL-1315-hardener-bounce-20260831.md`.
- The spec-gap already surfaced to the specifier (`qa_e2e_procedure` step 5
  vs. invariant 1 / scenario 03) — specifier-owned, not re-raised here.

## Verdict

Bounce defect (scenario 07 / invariant 1 violation) is fixed and verified
live. All BL-1315 test surfaces this hardener owns are green. Forwarding to
documenter.
