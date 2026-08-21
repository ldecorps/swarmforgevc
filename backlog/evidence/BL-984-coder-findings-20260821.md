# BL-984 — coder findings

Three things this parcel turned up that outlive it: a defect in the obvious
implementation of the sweep, the BL-971 provenance answer the ticket asked
for, and a pre-existing red in a sibling feature.

## 1. `kill(pid, 0)` reports a zombie as ALIVE — the sweep's first cut was wrong

The ticket suggests "a pid that is not alive" as the discriminator. Implemented
literally as `process.kill(pid, 0)`, that is wrong for the exact case the ticket
exists for.

Running the ticket's own `qa_e2e_procedure` step 5 — SIGKILL a helper invocation,
confirm the strand, run the helper again — the strand was NOT swept. A SIGKILLed
process whose parent has not reaped it is a **zombie**: dead, but still in the
process table, so the signal probe succeeds. `ps -o state=` reports `Z`.

The window is not exotic in this helper. Everything here is synchronous
(`spawnSync`), so a blocked event loop reaps nothing for the whole run — the
victim is a zombie for exactly as long as the next run is doing its work.

Fixed by reading `Z` as gone. Non-vacuity shown both ways: with the zombie check
removed, the live procedure fails and the dedicated unit test fails; with it, both
pass. An unreadable `ps` is read as *alive*, so the sweep errs toward keeping a
file it is unsure about.

Worth knowing for anyone else reaching for a liveness probe in this repo.

## 2. Was any BL-971 measurement taken on a worktree holding stranded fixtures?

BL-984's `notes` asks this explicitly, and says to record the answer against
BL-971 rather than silently re-baselining it. Answer: **no — BL-971's cited
figures are uncontaminated.** No re-baselining is needed and none was done.

### The overlap is real

The five stranded fixtures BL-984 was raised from are still present, in the
worktree BL-971 was reviewed in:

```
.worktrees/architect/extension/test/bl868-fixture-74865-{0..4 suffixes}.property.test.js
```

Left untouched — they are the architect worktree's to clear, per "never delete
what you did not create", and useful evidence while they last. PID 74865 is
gone, so BL-984's sweep claims all five (verified against byte-identical copies
in a scratch dir, not against the originals).

### Why the measurements are nevertheless clean

BL-971's scenario 01 is **file-scoped, not a full-lane run**.
`specs/pipeline/steps/bl971PropertyLaneTimeoutGreenSteps.js` validates each
`<file>` token against an explicit `KNOWN_LANE_FILES` set —
`bl868PropertyLaneIsolationGuards`, `bl632CommitTimeGuardInvariants`,
`bl760DuplicateChainGuard` — and spawns vitest pointed at exactly that file.
The lane's `include` glob is never allowed to expand, so a stranded
`bl868-fixture-*.property.test.js` sitting beside them was never collected.

The figures recorded in `backlog/evidence/BL-971-architect-review-20260820.md`
(bl868 14.97s, bl632 11.31s, bl760 106.34s, 4/4 pass, 142.4s total) therefore
measured only the three named files. They stand as written.

### The caveat worth carrying forward

What the strands *would* contaminate is a full `npm run test:properties` in that
worktree — the lane's actual gate, where the include glob does expand and each
strand boots its own child vitest. Any unscoped green/red claim made from
`.worktrees/architect` while those five files sat there carried five extra
child processes nobody wrote. That is precisely the failure BL-984 closes, and
it is a different claim from the scoped timings above.

## 3. BL-886's acceptance is RED on arrival — pre-existing, not this parcel

`BL-886-swarm-stamp-vitest-orphan-reaper-hotfix.feature` was re-run as a sibling
because its step handlers drive the same fixture helper this parcel changes. It
fails **3 of 11**, all three rows of "the supervisor reaps a crash-orphaned
property-lane group under any covered cmdline shape": *expected pid N (... vitest
run --config vitest.properties.config.mjs) to be reaped, but it is still alive*.

**Verified pre-existing, not charged to this parcel.** Both changed files were
temporarily restored to `HEAD` and the feature re-run: byte-identical outcome,
same 3 failures, 8 pass. Restored afterwards, checksums confirmed. The failing
scenarios exercise the supervisor's Babashka reaper, which this parcel does not
touch; the two scenarios that DO drive the fixture helper (06/07) pass.

Surfaced, not fixed — outside this ticket's authorization. Not yet traced to a
ticket of its own.

## Verification run for this parcel

- Unit `bl984SweepStaleFixtures.test.js` — 13 pass, incl. the zombie case.
- Property lane — both declared invariants pass; each shown failing against a
  targeted break (blind sweep / no sweep at the entry points).
- Helper's other property-lane consumers — bl868 (3), bl871 (2), bl886 (1) pass.
- Acceptance — BL-984 **5/5**; sibling BL-868 **5/5**; sibling BL-886 as above.
- Live SIGKILL procedure (`qa_e2e_procedure` step 5) — strand created, zombie
  state confirmed, strand swept.
- Registry-consuming tests (the only other route this parcel could reach, via
  `specs/pipeline/steps/index.js`) — `bl968StepRegistryMaterializedTreeGuard`,
  `bl1005OnboarderBuildStateGate`, `bl800StepRegistryScopingConsistency`,
  `acceptanceContractGate`, `bl968MaterializedGuardSensitivity`: all pass.

### NOT run to completion: the full 452-file unit suite

Stated plainly rather than implied clean. Under live swarm load (1-min average
16-26) the suite was moving at roughly 5 files/minute — about 80 minutes — and
handoff mail was already queuing behind this parcel in `inbox/new/`, the same
busy-skip that left BL-1003's QA bounce unclaimed for ~2h. It was started twice
and stopped at 27 of 452 files with **0 failures**.

The reasoning for forwarding anyway, so the next stage can weigh it rather than
inherit a bare assertion: this parcel changes **no production code**. Nothing
under `extension/src/` is touched. The complete set of routes by which it can
reach any other test is (a) `propertyLaneFixtureRunner.js`, whose every consumer
in the repo is enumerated above and re-run green, and (b) the one added line in
`specs/pipeline/steps/index.js`, whose consumers are likewise enumerated and
re-run green. The remaining ~425 files import neither.

The cleaner and hardener both re-verify as batch roles; if the full suite is
wanted as a gate on this parcel, it should be run there, on a quieter host.
