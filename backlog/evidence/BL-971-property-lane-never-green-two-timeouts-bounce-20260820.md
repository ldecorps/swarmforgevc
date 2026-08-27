# BL-971 — QA bounce to coder (complete inventory)

- **Ticket**: BL-971 — property lane never green (`type: defect`, `severity: high`, M8)
- **Commit reviewed**: `ad388b0f1` (QA's own merge of `main` into `swarmforge-QA`,
  carrying documenter's `6593ea7e15` plus the specifier's in-flight amendment
  `8c04243da`, discovered via `git log --grep=BL-971` while I held the parcel)
- **Reviewer**: QA, 2026-08-20
- **Verdict**: **BOUNCE to coder — inventory items: D1, D2 (two items, one root cause).**

## Context: an in-flight spec amendment landed after this parcel was already built

While this parcel was in the coder → cleaner → architect → hardener →
documenter chain, the hardener asked the specifier whether a THIRD file,
`test/bl760DuplicateChainGuard.property.test.js` (240s against the shared
`SUBPROCESS_HEAVY_TIMEOUT_MS` constant), also needed covering under BL-971's
invariant 1 ("any test in the lane failing by timeout is a violation of this
ticket, whatever the host load"). The specifier answered by amending the
ticket in place (`8c04243da`, "third timing-out file bl760 exhausts the
SHARED budget"), widening the acceptance feature's Outline to a third
Examples row and generalizing scenario 02's wording — explicitly stating
that a fix scoped to only the original two files "would leave the shared
budget untouched and close this ticket with the lane still red."

That amendment landed on `main` (local ref) but no `note` reached QA's inbox
before this parcel arrived (per the constitution's "Amending An In-Flight
Ticket's Spec" rule, the specifier sends a note to whoever holds the
parcel — none was found in `inbox/new/` or `inbox/completed/` naming
BL-971). Per that same rule, the holder merges `main` first: done (commit
`ad388b0f1`). The amendment is real, authoritative, and unambiguous — this
is not a spec-gap needing specifier clarification; the spec is precise. It
is unfinished coder-owned work that predates the amendment reaching this
parcel.

---

## D1 — `bl760DuplicateChainGuard.property.test.js` has no fix and no acceptance token

**Class**: `acceptance` (root cause: `behavior` — missing implementation) ·
**Blamed**: coder · **Files**:
`extension/test/bl760DuplicateChainGuard.property.test.js`,
`specs/pipeline/steps/bl971PropertyLaneTimeoutGreenSteps.js`

`bl632CommitTimeGuardInvariants` and `bl868PropertyLaneIsolationGuards` both
received a real fix (fixture-repo reuse + hardlinked warmed inodes for
bl632; batched child-vitest boots for bl868) with measured, comfortable
headroom afterward (~4-5x each, per the coder's own commit message). `bl760`
received **no equivalent treatment** — it still calls the raw
`SUBPROCESS_HEAVY_TIMEOUT_MS` shared constant with no optimization
(`grep -n "hardlink\|warmed\|runMany" extension/test/bl760DuplicateChainGuard.property.test.js`
matches nothing).

**Measured against the shipped code** (this session's own full lane run,
`npm run test:properties`, commit `ad388b0f1`, live swarm load): `bl760`'s
slowest case ran at `235137ms` against its `240000ms` budget — **97.9%
utilized, ~2% headroom**. It happened to pass this run, but this is exactly
the fragile-margin shape BL-971's invariant 1 exists to eliminate ("whatever
the host load") — the two originally-fixed files now sit at ~20-25%
utilization by contrast. A single-run green does not establish reliability
here.

The acceptance gate proves this directly: `specs/features/BL-971-property-lane-timeout-green.feature`'s
Outline now carries a third Examples row,
`test/bl760DuplicateChainGuard.property.test.js` (added by the specifier's
amendment), but `bl971PropertyLaneTimeoutGreenSteps.js`'s `KNOWN_LANE_FILES`
set (line ~23) still lists only the original two files:

```js
const KNOWN_LANE_FILES = new Set([
  'test/bl868PropertyLaneIsolationGuards.property.test.js',
  'test/bl632CommitTimeGuardInvariants.property.test.js',
]);
```

Running the acceptance scenario against the third row throws
`unknown <file> token: test/bl760DuplicateChainGuard.property.test.js` (see
command/output below) — the step handler was written before the amendment
landed and was never updated.

## D2 — scenario 02's generalized step text has no matching handler

**Class**: `acceptance` · **Blamed**: coder · **File**:
`specs/pipeline/steps/bl971PropertyLaneTimeoutGreenSteps.js`

The amendment generalized scenario 02's `Given` from (pre-amendment) "the
two property test files named in scenario 01" to (post-amendment) "the
property test files named in scenario 01" (dropping "two", since there are
now three). The feature file was updated; the step handler regex
(line ~72) was not:

```js
scoped(/^the two property test files named in scenario 01$/, (ctx) => {
```

still requires the literal word "two", so it no longer matches the current
feature text, and the acceptance run fails with `no step handler matched
"Given the property test files named in scenario 01"`.

---

## Failing command, commit, and output (both items, one run)

1. **Failing command**: `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-971-property-lane-timeout-green.feature`
2. **Commit hash**: `ad388b0f1` (QA's merge of `main`, carrying documenter's
   `6593ea7e15` + specifier's amendment `8c04243da`)
3. **First error excerpt**:
   ```
   not ok 3 - a formerly timing-out property file passes within budget under live swarm load [3]
     error: 'Scenario "..." failed at step "When the property lane runs scoped to
     "test/bl760DuplicateChainGuard.property.test.js"": unknown <file> token:
     test/bl760DuplicateChainGuard.property.test.js'

   not ok 4 - a subprocess-spawning property test's budget states its measured basis
     error: `Scenario "...": no step handler matched "Given the property test
     files named in scenario 01"`

   # tests 4
   # pass 2
   # fail 2
   ```
4. **Failure class**: `acceptance` (D1's underlying defect is `behavior` —
   bl760 genuinely lacks the fix; D2 is a step-handler/feature-text mismatch
   from the same amendment).
5. **Expected vs observed**: Expected all 4 acceptance checks green — the
   amended Outline's three Examples rows each pass within budget, and
   scenario 02's generalized step resolves. Observed 2/4: the two
   originally-fixed files pass (`30474ms`, `11389ms`); the third row and
   scenario 02 both fail as shown above.

## Everything else — run and PASSED

| Check | Result |
|---|---|
| Compile (`npm run compile`) | Clean |
| Full unit suite (`npm test`) | 446-448/448 files green across two runs this session; the 2 intermittent failures (`renderBriefingBurndownCli`, `renderBriefingDiagramsCli`) are confirmed load-induced by isolated re-run (9/9 tests pass clean in isolation, well under budget) — unrelated to BL-971's files |
| Full property lane (`npm run test:properties`) | **120/120 files, 373/373 tests green this run**, including `bl760` — but see D1: this is a lucky run at ~98% budget utilization, not a reliable pass |
| `bl632CommitTimeGuardInvariants` scoped (acceptance scenario 01, row 1) | PASS, 30474ms |
| `bl868PropertyLaneIsolationGuards` scoped (acceptance scenario 01, row 2) | PASS, 11389ms |
| BL-591, BL-963, BL-946 (this session's prior parcels) | Approved and landed separately, unaffected by this bounce |

No check was blocked.

## Remediation (per the specifier's own amendment)

Apply the same class of fix `bl632`/`bl868` received to `bl760` (the
amendment rules out a naive per-file rebudget alone — a fix must actually
reduce `bl760`'s wall-clock cost against the shared
`SUBPROCESS_HEAVY_TIMEOUT_MS`, not merely raise the budget, mirroring
`bl632`'s hardlinked-warmed-inode approach or `bl868`'s batching approach as
fits `bl760`'s own subprocess pattern). Add
`'test/bl760DuplicateChainGuard.property.test.js'` to
`KNOWN_LANE_FILES` in `bl971PropertyLaneTimeoutGreenSteps.js`, and update the
scenario-02 step regex to match the current feature text (drop the literal
"two"). Re-verify: acceptance 4/4, full lane green with `bl760` showing
comparable headroom to the other two fixed files (not a ~98%-utilized
near-miss).
