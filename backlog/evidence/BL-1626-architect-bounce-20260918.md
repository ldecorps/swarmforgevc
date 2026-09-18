# BL-1626 — send-back to coder, 2026-09-18 (architect)

## What happened

`buildFixtureScriptsDir()` — new exports added by this parcel on both
`specs/pipeline/steps/bl803PromoteRouteSedBsdPortabilitySteps.js:248-251`
and `specs/pipeline/steps/bl1028PromotionRefusalSteps.js:262-266` — each
calls `fs.mkdtempSync(path.join(os.tmpdir(), '<ticket>-scripts-closure-'))`
and returns the path with no cleanup: no `finally`, no push onto a tracked
list, no `afterEach`. Every call leaks one directory under the host's
`os.tmpdir()` permanently. `bl1028PromotionRefusalSteps.js` already has a
working cleanup convention in the same file (`trackedPaths` +
`node:test`'s `afterEach`, lines 79-85) that every OTHER fixture builder in
that file uses — `buildFixtureScriptsDir` bypasses it entirely rather than
extending it.

This is not a hypothetical: BL-1626's own new scenario 01
(`specs/features/BL-1626-*.feature`) calls both builders once per run via
`bl1626PromotionFixturesCarryTheClosureSteps.js`'s
`the fixture scripts directory that the (\S+) step handler builds` step,
and the coder's own commit message records "Verified: ... BL-1626 4/4
acceptance green" — meaning this leak already fired during the coder's own
verification.

## Confirmed today

Before running anything:
```
$ ls -d /tmp/bl803-scripts-closure-* /tmp/bl1028-scripts-closure-* | wc -l
4
```
(four already leaked from the coder's own prior verification runs). Then
one acceptance run:
```
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1626-*.feature
... 4/4 scenarios pass ...
$ ls -d /tmp/bl803-scripts-closure-* /tmp/bl1028-scripts-closure-*
/tmp/bl1028-scripts-closure-FA5YZU
/tmp/bl1028-scripts-closure-m0aEkz
/tmp/bl1028-scripts-closure-nInfWc
/tmp/bl803-scripts-closure-dv7XQY
/tmp/bl803-scripts-closure-gyQ0Zo
/tmp/bl803-scripts-closure-to7QRX
```
Two new directories (one per builder, matching scenario 01's two-row
Examples table), never removed. This feature lands and will run
repeatedly (QA's own e2e step, and the standing acceptance lane BL-1625
absorbs BL-1628 for) — every run adds two more permanent leaked roots
under `os.tmpdir()`.

## Why this bounces rather than gets fixed here

A correctness defect the architect can see is a send-back per
`architect.prompt`'s own rule (BL-333), even though the parcel is
otherwise architecturally clean (dependency-gate passed, no new
coupling, the declared invariant is covered by real scenarios). This is
also exactly the class of defect this codebase's engineering guardrails
call out repeatedly (BL-1385/BL-1390/BL-1623/BL-1632: a leaked/blindly-
swept mkdtemp fixture root) — a growing pile of untracked `os.tmpdir()`
roots is the precondition every one of those incidents needed. Left
alone, this pile grows by two roots on every run of the newly-landed
BL-1626 feature (QA e2e, and any future landed-feature lane).

## The fix (direction, not mandate)

Give both `buildFixtureScriptsDir()` exports the same discipline
`bl1028PromotionRefusalSteps.js`'s OTHER fixtures already use in this
file: track the directory and remove it in a `finally`/`afterEach`, or
have the caller (`bl1626PromotionFixturesCarryTheClosureSteps.js`'s
scenario-01 step) `fs.rmSync(ctx.fixtureScriptsDir, { recursive: true,
force: true })` once the diff assertion has read it. Either shape
satisfies the guardrail; the ticket's own `constraints:` still bind (no
other production/library change).

Not bounced: `bl1100PromotionProseNeverBlocksSteps.js`'s pre-existing
`makeRoot`/`buildFixtureRootWithPausedTicket` fixture also has no cleanup
— but that convention predates this ticket (every existing bl1100
scenario already builds via `makeRoot` with no cleanup) and this parcel's
`buildFixtureRootWithPausedTicket` only wraps the existing, unchanged
`makeRoot` the same way its siblings do. Refactoring that file's whole
fixture-cleanup convention is out of this ticket's constraints (three
handlers' closure/gate fix, not a cleanup pass across an unrelated file);
recorded here so a future ticket on that file's own leak has this as a
sibling pointer, not silently absorbed.

By architect.
