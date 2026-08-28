# BL-1215 hardener pass — 2026-08-28

Merged architect handoff `b94e7a1768` (clean pass, origin/main fail-closed
land gate verified). No conflicts.

## A real 50%-coverage gap found and closed, plus a differential-complexity fix

CRAP flagged `checkOriginLanding` (the new orchestration wrapper in
`pilotAcceptanceGate.ts` gating the move on `checkOriginMainLanding`) at
only 50% coverage. Traced why: its REFUSAL branch was exercised only by
the acceptance feature's step handler
(`bl1215OriginMainLandGateSteps.js`, node:test-driven, invisible to this
project's v8/CRAP tooling) and by `pilotAcceptanceGateCli.test.js`'s
direct tests of the lower-level `checkOriginMainLanding` git function —
nothing vitest-visible drove the refusal path through the full
`main()`/`landPilotedTicket` orchestration.

Added `main(): refuses in-process, writing nothing, when the run commit
never reached origin/main` to `pilotAcceptanceGateCli.test.js`, mirroring
the existing "lands in-process on a green run" test's real-git shape
(a genuine origin remote, a shared-base commit pushed, then a second
local-only implementation commit never pushed) — asserts `reasonKind:
'commit-not-on-origin-main'`, `unlandedCommit`, the yaml staying in
`active/`, and NO receipt directory being created at all. `checkOriginLanding`
is now 100% covered.

**Differential complexity gate, applied and actually fixed (not just
noted):** CRAP also showed `moveAndRecordReceipt` at complexity 28
against a confirmed `main` baseline of 27 — a +1 rise from BL-1215's own
new `if ('refusal' in originLanding)` dispatch. Read the surrounding code
before accepting this as unavoidable debt: `moveAndRecordReceipt`'s own
doc comment says "has only the move itself left to fail," and EVERY other
refusal-capable check in this file (`checkCommitClaims`,
`checkCrossFileDuplication`, 11 more) is dispatched from `landPilotedTicket`
itself, via the exact `const x = checkX(...); if ('refusal' in x) return
x.refusal;` shape, BEFORE `moveAndRecordReceipt` is ever called — my new
check was the one exception, placed inside the wrong function. Moved
`checkOriginLanding` (and the `getLandedCommit()` call it needs) out of
`moveAndRecordReceipt` and into `landPilotedTicket`, following that exact
established pattern, with `landedCommit` now passed into
`moveAndRecordReceipt` as a parameter instead of computed inside it.
Result: `moveAndRecordReceipt` is back to complexity 27 (matches
baseline exactly, confirmed against `main`). `landPilotedTicket` itself
rose from baseline 21 to 22 — the unavoidable, minimal cost of a 14th
required check added via the file's own repeated dispatch pattern; no
further extraction is reasonable without restructuring the whole
sequential-check architecture, which is out of hardening's scope.

## Non-vacuity, hand-verified

Reordered the compiled `moveAndRecordReceipt` to call `moveTicketToDone`
BEFORE the origin-landing check (simulating the exact ordering bug the
ticket's own constraint forbids). The acceptance suite caught it
immediately (scenario 3 failed: "expected moveTicketToDone to never be
called on refusal"). Restored; recompiled from source; re-ran the
refactor described above; both the acceptance suite and the new CLI test
pass, 3/3 and 32/32 (1 skipped — see below) respectively.

## Pre-existing, already-reported defect — confirmed, not re-reported

Architect's evidence already identifies and files a `note` (priority 00,
to specifier+coordinator) for a genuinely pre-existing, unticketed defect:
9 hand-built `mkDeps()` test fixtures (`pilotAcceptanceGate.test.js` and 8
siblings — `pilotMkdtempConventionCheck`, `pilotScopedCrapCheck`,
`propertyGeneratorReachCheck`, `shellEntryPointDriveCheck`,
`unreachableStepHandlerCheck`, `multiBranchParserCoverageCheck`,
`perHatRolePromptEvidenceCheck`, `crossFileDuplicationCheck`) crash with
`deps.checkOrphanedAuthoredDocs is not a function` on their full-land-path
tests (33 test failures across those 9 files via `node --test`, all one
root cause). Re-confirmed independently: `git log -S
checkOrphanedAuthoredDocs` predates BL-1215's own touch to this file, and
`git grep` across `backlog/active|paused|hold` finds no existing ticket
for this exact symptom (BL-1209 is a different symptom, `rawMkdtempGuard`
module resolution). Per BL-1063's posture, this is architect's report to
own, not mine to duplicate — recorded here only so a later pass does not
re-walk the same discovery. This blocks the `-t` exclusion I used above
(`pilotAcceptanceGateCli.test.js`'s own "claim-refused land now succeeds"
test hits the SAME `rawMkdtempGuard`-class symptom via `pilotMkdtempConventionCheck`
— matches BL-1209, also pre-existing, also already ticketed).

## Verification

- `npm run compile`: clean.
- `vitest run test/pilotAcceptanceGateCli.test.js` (excluding the one
  pre-existing BL-1209-class failure): 32/32 pass (was 31; +1 new).
- `run_acceptance.sh` on the BL-1215 feature, 3 consecutive runs: 3/3
  pass every run.
- `node --test test/pilotAcceptanceGate.test.js`: same pre-existing
  8-failure set as before my refactor (all `checkOrphanedAuthoredDocs`
  class, confirmed unchanged in nature and count).
- CRAP: `checkOriginLanding` 100% covered (was 50%); `moveAndRecordReceipt`
  back to its exact `main` baseline (27); `landPilotedTicket` at baseline+1
  (21→22), the minimal unavoidable cost of the new required check.
- DRY (`jscpd`): 1 pre-existing clone (confirmed present on `main` at
  the same location), not introduced here.
- Standing whole-tree guards: same 4 pre-existing failures as every prior
  pass this session, none naming any BL-1215 file.

## Cleanup

No orphaned `node --test`/`stryker` processes at handoff. Restored the
one hand-mutated compiled file from a `.bak` copy before recompiling from
source. No leftover scratch files.

By hardener.
