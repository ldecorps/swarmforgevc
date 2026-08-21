# BL-1005 hardener pass, 2026-08-21

**Parcel:** coder `3f5404edb` + cleaner `0a26231dc` + architect review
(clean sweep, D1..Dn: NONE, `backlog/evidence/BL-1005-architect-review-20260821.md`),
merged into hardener at `d4aa2b0e4`.

## Merge

`git merge --no-ff b6b1031d3a` (architect's PASS commit). Clean, no conflicts.
Diffed the merge against BOTH parents: vs the prior hardener tip, only
additions (the two new test files, the feature/step changes, backlog
bookkeeping); vs the architect tip, only this worktree's own untouched prior
content. No content dropped by the merge.

## BL-149 mutation cooldown gate (first stage, ahead of load)

Both changed production files checked with
`mutation_cooldown_gate.bb <root> <file>` (host has no `nproc`; forced cores
via `SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`, matching `sysctl -n hw.ncpu`):

- `specs/pipeline/steps/bl643NonPipelineAgentsSteps.js` -> **skip-cooldown**
  (file_age_days: 0.41 - `90ba6c7ae` landed on `main` 2026-08-20, inside the
  3-day window). Skipped unconditionally per rule, regardless of load.
- `specs/features/BL-643-non-pipeline-agents-documented-as-a-class.feature`
  -> **skip-busy** (file_age_days: 24.71, past cooldown; load_avg ~13-17 on 4
  cores, busy_threshold 2.00x).

Since a Gherkin-mutation run over `agent-class-doc-06` would exercise the
just-landed (skip-cooldown) step handler, no mutation pass was run against
either file this turn. Deferred to the next quiet pass once the step file
clears cooldown (due ~2026-08-23). Host load independently confirmed severe
via `uptime` (15/43/70 on 4 cores at session start) - well past the
office-hours/2x-cores bypass threshold, corroborating the busy reading.

## Verification (all green)

- `npx vitest run test/bl1005OnboarderBuildStateGate.test.js --config
  vitest.config.mjs`: 23/23 pass.
- `npx vitest run test/bl1005OnboarderGateNonVacuity.property.test.js
  --config vitest.properties.config.mjs`: 2/2 pass (reachability floors
  asserted by the coder: >=200/200 zero-claim runs, >=60/300 each for
  shipped/unbuilt).
- `node specs/pipeline/cli.js
  specs/features/BL-643-non-pipeline-agents-documented-as-a-class.feature`:
  18/18 pass (was 17, now 18 - `agent-class-doc-06` is a two-row outline, as
  the ticket predicted).
- Standing whole-tree guards (parcel touches `specs/pipeline/steps/` and
  `extension/test/`): all 11 `test/*Guard*.test.js` files, 81/81 tests pass -
  including `bl643NonPipelineAgentsStepsGuards.test.js` (7/7, an earlier
  BL-643 hardening pass's guard file, unaffected by this ticket's change).

No CRAP/DRY check: this ticket touches no `extension/src/*.ts` file (only
`specs/pipeline/steps/*.js` and `extension/test/*.test.js`), so neither
tool's scope applies.

## Manual review (mutation deferred, so read the logic by hand)

Traced `extractBuildStateClaims` / `checkBuildStateClaims` /
`resolveTicketBacklogState` for the usual survivor shapes: filter-condition
polarity swaps (`c.claim === claimKind`, `c.actual !== expected`) are each
caught by an existing positive/negative test pair; the slice-heading vs.
block-marker interaction (BL-1200 "not built yet" overriding a shipped
heading default) has its own dedicated test; the prefix-match guard against
a longer ticket id (`BL-62` vs `BL-624`) is unit-tested; the KNOWN_VALUES
step-handler guard rejects both an unknown `<claim>` and a mismatched
`<claim>`/`<backlog state>` pairing. No gap found that the existing 23 unit
+ 2 property tests would miss. This is a manual read standing in for the
gated-off mutation run, not a substitute for it - the deferred BL-113 pass
above is still owed once cooldown clears.

## Sibling-defect check

`git log --oneline $(git merge-base HEAD main)..main` restricted to this
parcel's three touched files: empty. Nothing landed on `main` since the
merge-base touching `bl643NonPipelineAgentsSteps.js` or either new test
file, so there is no sibling bounce-fix to fold in.

## Housekeeping

Reaped an orphaned `npm test` process tree (PPID 1, PGID 29468 - `npm test`
-> `sh -c npm run compile && node scripts/recordTestDuration.js` -> compile
+ vitest), running ~11 minutes before this pass started, unrelated to this
ticket. Killed by process group (`kill -- -29468`); confirmed gone via
`pgrep`. Pre-existing untracked `swarmforge/scripts/test/fixtures/daemon_log_freshness.fixture.conf`
left untouched - not created by me, not referenced by any test, surfaced
here rather than swept.

## Outcome

No code changes needed - the parcel arrived already well-hardened (coder's
23 unit tests + 2 reachability-floored property tests, architect's clean
sweep). Mutation is legitimately deferred by the cooldown gate, not skipped
for convenience. Forwarding to documenter.

By hardener.
