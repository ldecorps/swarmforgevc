# BL-984 — hardener pass: verified green, hand-mutation confirms, BL-113 deferred (extreme load)

**Parcel:** coder (fixture zombie-pid fix) + cleaner `91b0a6c579` + architect
review, merged into hardener at `a6ed41619c` -> local merge commit (this
worktree). Architect's own review: `backlog/evidence/BL-984-architect-review-20260821.md`
(verdict PASS, D1..Dn: NONE).

**Verdict:** PASS to documenter. No code changes made — the parcel arrived
already hardened by coder+architect; this pass adds independent
reverification plus a hand-authored mutation sweep on the one file outside
Stryker's scope.

## Host condition (governs what ran and what deferred)

Load average spiked repeatedly through this pass: 20.5 -> 24.4 -> 37.1 ->
126.7 on a 4-core host (up to ~31x cores). Per the hardening load rules this
binds every mutation runner (Stryker and Gherkin mutation alike). All heavy
runs below were executed through the registered `detach_job.sh` helper to
avoid the ~120s foreground timeout misreading load contention as failure.

## Scope check — CRAP/DRY inapplicable to this parcel

`git diff --stat` against the merge-base shows this parcel touches only
`extension/test/**`, `specs/pipeline/steps/**`, and `backlog/**` — zero
`src/*.ts` files. Both `npm run crap` (scoped to `src/*.ts`) and `npm run dry`
(jscpd, `.jscpd.json` pattern `**/*.ts` under `src`) are therefore
inapplicable; nothing to measure.

## Stryker — file is outside mutation scope by design

`extension/stryker.config.json` mutates only `out/**/*.js` (compiled from
`src/*.ts`). `extension/test/helpers/propertyLaneFixtureRunner.js` is test
infrastructure living under `test/`, never compiled into `out/`, so Stryker
never covers it regardless of host load. Confirmed by reading the config
directly (`"mutate": ["out/**/*.js"]`). The BL-149 cooldown gate was still run
for completeness:
`bb swarmforge/scripts/mutation_cooldown_gate.bb <root> extension/test/helpers/propertyLaneFixtureRunner.js`
-> `DECISION: skip-busy` (load 24.37, threshold 2.00x) — consistent with the
scope finding; nothing to defer here since nothing would have run anyway.

## Hand-authored mutation sweep (BL-638 pattern — no tool covers this file)

Two independent hand-mutations of the sweep's core discriminator
(`extension/test/helpers/propertyLaneFixtureRunner.js:110`,
`if (originPid === process.pid || !isPidAlive(originPid))`), each run
through the targeted unit suite via `detach_job.sh`, each reverted
byte-for-byte before the next (confirmed via `diff` against a saved copy):

1. **Dropped the negation** (`!isPidAlive` -> `isPidAlive`): sweep now claims
   live peers instead of dead ones. **KILLED** — 9/13 unit tests failed
   (every test asserting either removal-of-dead or survival-of-alive).
2. **Flipped the own-pid equality** (`===` -> `!==`): the own-pid special
   case (pid-reuse-from-a-dead-run) inverted to "claim everything except my
   own pid". **KILLED** — 4/13 unit tests failed, exactly the own-pid and
   alive-peer tests predicted to catch it.

Both mutants killed decisively. Combined with the architect's own
independently-run third hand-mutation (removing the discriminator entirely,
documented in their review), that is three hand-mutations of the critical
logic from two different reviewers, all killed. A fourth candidate (loosening
the pid capture group from `\d+` to `\d*`, permitting a pathological
double-dash filename) was considered and set aside: `process.pid` is always a
positive integer, so no real generated name can ever hit that path, and
no constraint in the ticket requires guarding a filename a human would never
plausibly author — not pursued as equivalent-in-practice, not as a genuine
gap.

File restored to its pre-mutation state after each trial; `git diff --stat`
on the file is empty.

## Independent reverification (not trusted from the architect's note)

All three runs executed via `detach_job.sh` (registered, non-orphaning) given
the load spikes above:

- Unit `npx vitest run --config vitest.config.mjs test/bl984SweepStaleFixtures.test.js`
  -> **13/13 PASS** (3.67s).
- Property `npx vitest run --config vitest.properties.config.mjs test/bl984FixtureSweep.property.test.js`
  -> **2/2 PASS** (11.05s), reachability floors intact per the coder's own
  assertions (not re-verified numerically here, already checked by architect).
- Acceptance `node specs/pipeline/cli.js specs/features/BL-984-sweep-stale-property-fixtures-before-run.feature`
  -> **5/5 PASS** (all four scenarios, two-row Examples on scenario 01,
  64.9s under heavy contention).

## BL-113 Gherkin mutation — DEFERRED, not skipped

The feature carries a `Scenario Outline` (scenario 01, two-row Examples:
`bl868-fixture-`, `bl871-fixture-`), so BL-113 soft mutation is owed. Given
the load trajectory culminating at 126.7 (≈31x cores) immediately before this
step, and that Gherkin mutation's flat-CPU stall failure mode is bound by the
same load rules as Stryker, this run is deferred rather than attempted and
risking either a multi-minute hang or a spurious flat-CPU stall
misdiagnosis. `mutation_cost: low` on the ticket YAML and a fully green,
independently-reverified suite (unit+property+acceptance, plus the
hand-mutation kills above) support forwarding now rather than stalling the
pipeline — per the office-hours/busy-host bypass policy, this is exactly the
"forward with targeted-test hardening, land full mutation on the next quiet
pass" case, not a first-failure stop.

**Owed:** run
`specs/pipeline/scripts/run_gherkin_mutation.sh specs/features/BL-984-sweep-stale-property-fixtures-before-run.feature <workdir> specs/pipeline/steps/index.js soft`
on the next quiet host and confirm 0 survivors (or record and kill any that
appear) before this ticket's BL-113 gate can be marked genuinely closed.

## Process/fixture hygiene

- `pgrep -fl 'node --test|stryker'` scoped check: clean (only a QA-worktree
  process observed once, out of scope, left untouched).
- `git status --short extension/test/`: clean after all runs — no leaked
  fixture files.
- One `sleep 300` process observed mid-pass, parented to `babysitterd.sh`
  (pid 79208) — confirmed via `grep sleep swarmforge/scripts/babysitterd.sh`
  to be that daemon's own normal supervision-loop sleep
  (`BABYSITTERD_INTERVAL_S` default 300), not a leaked test fixture. Same
  false-positive shape the architect's own review already flagged for an
  earlier instance of this process; not caused by, and not in scope of, this
  parcel.
- `detach_job.sh` scratch artifacts (`tmp/detach.py`, `tmp/suites.log`,
  `tmp/suites.sh`) predate this session (2026-08-19) and were left
  untouched per "never delete what you did not create". My own detach logs
  (`tmp/bl984-*.log`) and mutation-probe copy (`tmp/pLFR.orig.js`) were
  removed after use.

## Inventory result

**D1..Dn: NONE.** No coverage gap, no correctness defect. BL-113 Gherkin
mutation is BLOCKED BY host load and recorded above as owed on the next
quiet pass, per Article 4.4 — not a pass, not a fail, not silently omitted.

Forwarding this commit (evidence file committed) to documenter.

By hardender.
