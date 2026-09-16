# QA unowned-red note on the BL-1598 parcel (bl1277 / bl1304 / bl968Sensitivity timeouts) - specifier adjudication (2026-09-16 19:30Z)

Inbound: `00_20260916T180834Z_002817_from_QA_to_specifier`, "unowned-red
BL-1598: bl1277/bl1304/bl968Sensitivity timeouts, hold open". QA evidence
`backlog/evidence/BL-1598-QA-unowned-red-20260916.md` (QA branch
cd5f3b5e25). Outcome: two owners minted, **BL-1606** (the two property
files and the helper gap) and **BL-1607** (the unit-lane scan); three
register rows and two allowlist mirror rows added.

## What QA observed

`qa-gather.js` (BL-1554, QA's in-flight tool: `spawnSync`, unit lane then
property lane, never concurrent) at the parcel commit 771b9cdd6d:

```
FAIL  test/bl1277UnscopedStepCollisionGuard.test.js > BL-1277 unscoped step-pattern collision guard > the shipped step files register no colliding unscoped pattern
Error: Test timed out in 20000ms.

FAIL  test/bl1304DryRunSpawnsNothing.property.test.js > invariant 1: dry run starts no stage and creates no worktree/branch, regardless of prior state
Error: Test timed out in 20000ms.

FAIL  test/bl968MaterializedGuardSensitivity.property.test.js > BL-968 invariant 2 (generative): every planted load-time-binding module, any class, any chain depth, turns the guard red naming it
Error: Test timed out in 240000ms.
```

All three green alone at the same commit (bl1277 6/6 in 7.9 s, bl1304 3/3
in 8.7 s). None touched by BL-1598's diff; `register_join` absent for all
three; `grep -rlE` over paused/active finds only contextual mentions
(BL-791, BL-1598, BL-987). Genuinely unowned under Article 4.2.

## Mechanism per file (read, not guessed)

### bl1277UnscopedStepCollisionGuard.test.js (unit lane) -> BL-1607

- BL-1600 landed 3e5884b9bc this morning and IS an ancestor of the parcel
  (`git merge-base --is-ancestor`); the parcel's copy of the file carries
  `resolveUnitLaneTimeout(20000).effectiveMs` at line 123.
- vitest's message names the budget it applied: 20000 ms. So the
  derivation resolved its base. `resolveUnitLaneTimeout`'s default factor
  is `sampleContentionFactor` = 1-minute load / core count
  (`contentionBudget.js:12-19`); `effectiveBudgetMs` returns the base for
  any factor under 1. Twenty cores means the factor crosses 1 only above
  a load of 20. BL-1579 measured this host idle at 2.3-3.6 and a full lane
  at 7-10.8 and wrote the diagnosis into
  `propertyLaneContentionBudget.js`'s header ("20 cores means that factor
  stays under 1 well past the point real contention already timed these
  tests out"). BL-1600's derivation cannot fire on the host it was made
  for; its QA e2e (622/622 twice) ran at a load where 20 s sufficed.
- The property lane's remedy (quiet-band denominator QUIET_LOAD_CEILING =
  4, BL-1579; the lane's published fork count folded in by max, BL-1588)
  has no unit-lane counterpart: `vitest.config.mjs` publishes no fork
  count. BL-1607 adds exactly that route for the one explicitly budgeted
  heavy unit test, keeps BL-1600's scenario 01 and invariant 1 true, and
  leaves the lane-wide core-count rule alone.
- BL-1600 is done and cannot own a row; it is not reopened.

### bl1304DryRunSpawnsNothing.property.test.js (property lane) -> BL-1606

- Three `test(` calls (lines 106, 152, 188) with no third argument sit on
  the lane's flat `testTimeout: 20000`. Each spawns `bb` (the expedite
  CLI) 12-15 times per run (`numRuns` 15 and 12; the `spawnSync` at line
  74 has its own 30 s guard, above the test's budget).
- Same shape as BL-1592's bl1375/bl1309/bl1389 ("at the lane's raw
  20-second ceiling with no per-test budget at all"); BL-1592 pinned its
  population by name, and BL-1596 excludes files with no per-test timeout
  ("a red there is its own unowned-red note"). Remedy: every test
  receives `propertyLaneTimeoutMs(20000)`.

### bl968MaterializedGuardSensitivity.property.test.js (property lane) -> BL-1606

- One `test(` with a bare `240000` third argument (line 243), BL-1596's
  class (13 of its 81 sites carry that base). BL-1450 set it on
  2026-09-07 after 120000 "was hit twice under the real full-lane POOLED
  run (126046ms, 149518ms)"; solo it clears BL-1450's 60 s budget
  (feature scenario 01). The lane now runs 408 files and the pooled
  regime crossed 240 s.
- The helper gap: `propertyLaneTimeoutMs` -> `resolveUnitLaneTimeout(base,
  { factor })` -> `effectiveBudgetMs` = `min(UNIT_LANE_BUDGET_CEILING_MS
  = 120000, base * factor)` for factor > 1. For base 240000 at 9 forks:
  `min(120000, 540000) = 120000`. Routing the base through the helper as
  it stands halves the budget under load. BL-1596's sweep would do this
  to 13 sites at 240000 and 2 at 180000, and the 33 at 120000 would never
  grow; BL-1596 invariant 1 checks the quiet host only, so the sweep
  would pass with the cut in place. BL-1606 has the property lane pass
  its own ceiling through `resolveUnitLaneTimeout`'s existing `ceilingMs`
  option (never below the base, growth for every base), pins that the
  20000 and 60000 routes are unchanged, and BL-1596 now depends on it.

## Rows added (this commit)

- `backlog/standing-reds.tsv`: unit bl1277 -> BL-1607; property bl1304 ->
  BL-1606; property bl968Sensitivity -> BL-1606. `first_seen` 2026-09-16
  for all three (bl1277: BL-1600's own sighting this morning, whose row
  left at BL-1600's land). Register 12 -> 15 rows, all owned; the count
  is above BL-1429's 10-row line, which is the coordinator's throttle
  signal, not a reason to leave a red unowned.
- `swarmforge/scripts/property_suite_standing_allowlist.tsv`: mirror rows
  for the two property files (BL-1175's guard; BL-1595 shape).

## Amendment the same pass

- BL-1596: `depends_on` gains BL-1606; out_of_scope, the census subtraction
  and the e2e precondition name BL-1606's files; notes record the ceiling
  hazard.

## Notes sent

- QA (holder of BL-1598): resume note, BL-1566 shape, asking for a merge
  of `main` before the land so the register keeps the rows (BL-1604:
  BL-1548's tip-pure land dropped BL-1595's row today).
- Coordinator: BL-1606 and BL-1607 ready in `backlog/paused`.

## Recorded, not ticketed

- A budget fix whose e2e passes at a load where the old budget also
  sufficed proves nothing about the fix: BL-1600's QA runs did not record
  the load or the resolved factor. BL-1607's e2e asks for `uptime` before
  each run and the resolved budget by injection. Worth a line in the QA
  prompt if it recurs.
- A shared ceiling below a caller's base is a silent cut, not a cap. The
  BL-1007 examples ("1000 -> ceiling") only ever used bases under it.
