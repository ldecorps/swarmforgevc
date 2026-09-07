# BL-1349 — architect review pass, 2026-09-07 (BOUNCE)

Reviewed commit: `832429ff79` (cleaner merge of coder's bounce-fix
`5552dbd2f6` / evidence `BL-1349-coder-bounce-fix-20260907.md`), merged into
architect at `c92e250451`.

## Checklist run

- Dependency-rule gate (`node extension/out/tools/dependency-gate.js`
  against all four touched files, run from `extension/`): **PASSED**, no
  forbidden edges.
- Co-change report (same file set): the three property files show mutual
  "SUSPECTED COUPLING" (up to 8 co-changes) and one shared-suite-wide file
  (`specs/pipeline/steps/index.js`, 6 co-changes). Read as noise from prior
  bulk property-suite passes (BL-871, BL-971) that touched many property
  files together, not a real architectural coupling introduced by this
  ticket — the three files are edited together here only because this
  ticket names exactly those three. No action.
- Two-layer boundary / extension-host-owns-IO / webview-storage / secrets:
  not implicated — no `extension/src/**` file touched.
- Declared invariant 2 (reduced sample count only where the property body
  spawns): re-checked against the current diff — every `numRuns` reduction
  (15→2, 120→60 ×5, 6→2) lands on a property whose body calls `spawnSync`.
  No violation.
- Declared invariant 1 (no property deleted / no assertion weakened): counted
  `test(`, `fc.property(`, `fc.assert(` occurrences at `7f0e5766c9^` (true
  parent, matching the fixed step handler's own reference) vs the current
  on-disk files for all three — identical counts each (2/2, 10/10, 6/6). No
  deletion.
- D1 from the 2026-09-06 bounce (`no-property-is-dropped-02` compared `HEAD`
  to itself, vacuous): **fixed correctly**. The step handler now reads
  "before" from `${TUNING_COMMIT}^:<path>` (`TUNING_COMMIT = '7f0e5766c9'`,
  a fixed real SHA, confirmed an ancestor of the current HEAD via
  `git merge-base --is-ancestor`), and "after" from the live on-disk file —
  a genuine diff. Ran the acceptance feature directly; the no-deletion
  scenario passes and is non-vacuous (confirmed independently: the pre-tuning
  file has `numRuns: 15` un-annotated, the on-disk file has `numRuns: 2` plus
  a cost-driver comment — a real difference the scenario is now capable of
  catching).
- bl787's coder comment (2026-09-07) discloses that reducing `numRuns` 6→2
  means a single run now reaches at most 2 of the 4 (mode × keepalive)
  combinations rather than reliably all 4. Checked whether this violates
  invariant 1 or the ticket's "same coverage" constraint: it does not — the
  property has no reach-assertion (`assertReach`/`seen` tracking) gating
  combination coverage, only a per-run pidfile-teardown assertion, which is
  unchanged. The ticket's own direction explicitly trades sample count for
  budget on spawn-heavy properties; disclosed honestly, no invariant text
  requires categorical reach here. No violation, no bounce on this point
  alone.
- `specs/pipeline/steps/bl1349SpawnHeavyPropertyBudgetSteps.js` wiring:
  matches the `*Steps.js` top-level auto-discovery predicate in
  `specs/pipeline/steps/index.js` (BL-1371) — no manual registration needed,
  none missing.

## D1 (new) — the per-file budget is not met: `bl1252CommitGuardAggregationInvariants.property.test.js` runs 40–44s alone, not under 15s

**Class:** behavior (correctness defect visible on review, not an
architecture-boundary issue). **Blamed role:** coder.

The ticket's own `qa_e2e_procedure` requires: "run each of the three named
files alone through the property lane and record its wall clock... each must
come in under 15 s." Ran this directly, from `extension/`, twice:

```
$ npx vitest run test/bl1252CommitGuardAggregationInvariants.property.test.js --config vitest.properties.config.mjs
 ✓ ... (5 tests) 40147ms
 Duration  40.54s

$ npx vitest run test/bl1252CommitGuardAggregationInvariants.property.test.js --config vitest.properties.config.mjs
 ✓ ... (5 tests) 43166ms
 Duration  43.55s
```

Both runs: all 5 properties pass (no assertion failure), but the FILE takes
~2.7-2.9x the 15s budget. The full acceptance suite run
(`bash specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-1349-spawn-heavy-property-files-fit-a-budget.feature`)
reproduces the same failure through the ticket's own step handler:

```
not ok 2 - a spawn-heavy property file completes within the per-file budget [2]
  error: 'Scenario ... failed at step "Then it completes within 15 seconds":
  expected bl1252CommitGuardAggregationInvariants.property.test.js to
  complete within 15000ms alone, took 42264ms'
```

The other two tuned files DO meet budget, checked the same way, twice each
(onboarderLauncherPidGuard: 6.1s / 13.1s in-suite; bl787NamedTunnelInvariants:
13.6s / 11.5s in-suite) — this is specific to the one file, not environment
noise across the board.

This is not the same host-contention pattern the coder's own two prior
evidence files already documented and correctly excluded:

- `BL-1349-coder-pass-20260906.md` measured this same file at **75.7s**
  running the FULL 300+-file lane concurrently with the live swarm (load
  average up to 17.58) — expected slowdown, out of scope, correctly not
  bounced on.
- `BL-1349-coder-bounce-fix-20260907.md` measured this same file at
  **18150ms** inside the full acceptance run (attributed to running "back to
  back" with the other two heavy files in one acceptance invocation), then
  claimed **10.70s** running it "alone."

My two runs isolate the file exactly the way that 10.70s claim was made
(`npx vitest run <single file>`, nothing else running concurrently beyond the
normal idle swarm panes — `uptime` load average 3.1-4.9 on 20 cores, not the
17.58 the coder's contended run saw) and get 40-44s both times, not 10.70s.
Traced the cost: `RUNNER` (`run_commit_guards.sh`) is real, but
`SWARMFORGE_COMMIT_GUARD_DIR` points it at fixture stub scripts
(`touch ...; exit <code>`) that are cheap in themselves — the cost is pure
process-spawn overhead, one `bash run_commit_guards.sh` spawning ~9-10 nested
`bash <guard>.sh` children, run 60 times per property × 5 properties = up to
300 outer spawns / ~2700-3000 total process forks for this one file. The
guard list the fixture enumerates (`ALL_GUARDS`) matches the live
`run_commit_guards.sh` cheap tier exactly (9 guards, including the
BL-1385/BL-1395/BL-1428/BL-1440/BL-1424 additions) — not fixture drift,
genuinely that many real spawns per run.

**Remediation (per the ticket's own "How" section, which already anticipates
this):** "split a file whose remaining cost is genuinely several independent
properties so the lane can parallelise them." This file's 5 properties are
already independent (each is its own `test(...)`, sharing only the fixture
helpers) — splitting it into e.g. 2-3 files would let each meet the 15s
per-file ceiling on its own without a further `numRuns` cut that would erode
the reach `assertReach` already depends on. A further `numRuns` reduction is
the fallback if a split is impractical, but re-derive and re-record the reach
math (the existing 0.9^60 comment) against the new count — do not just retune
blind.

## No other defect found

Dependency, co-change (informational), both declared invariants, the D1 fix
from the prior bounce, and the bl787 reach-reduction disclosure are all
sound. This is the one item.

By architect.
