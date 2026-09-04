# BL-1393 — hardener pass, 2026-09-04

Merged architect commit `6fa6d7dd36` (COMPLIANT, clean sweep — all three
invariants verified directly in the diffs, and the architect's own first
e2e run caught and corrected a stale-build false-failure before trusting
the result —
`backlog/evidence/BL-1393-architect-20260904.md`). Real `extension/src`
production code, so CRAP/DRY and Stryker mutation apply.

## Checks re-run, all independently (before my own CRAP fix)

- `npm run compile` — clean (repeated the architect's own stale-build
  lesson: compiled fresh before trusting any run).
- `test_bl1393_one_ceremony_every_sleep.sh` — 11/11 ALL PASS.
- `bl1393OneCeremonyEverySleep.property.test.js` — 3/3 pass.
- Unit suites (`nightClosingCeremonyLive`, `nightClosingCeremonyRun`,
  `nightClosingCeremony`, `closingCeremonyRun`, `closingCeremonyRunCli`)
  — 35/35 pass.
- Acceptance: BL-1393 9/9, BL-658 11/11, BL-820 12/12 — both re-tensed
  predecessors still fully green (confirmed the `retires:` scope
  exemption touched no scenario).
- `test_handoffd_closing_ceremony_gate_wiring.sh` — ALL CHECKS PASSED.
- `check_feature_handler_registration.sh` — rc 0.
- required_wiring anchors grepped directly: `finish_shift_lib.sh:74`
  calls `night-closing-ceremony-run.js`; `night-closing-ceremony-run.ts:27`
  imports `runClosingCeremony` from `closingCeremonyRun`, called at
  lines 233/238; `registerSteps` exported from
  `bl1393CeremonyOnEverySleepSteps.js:69/173`.

## Own finding: a real differential CRAP regression, found and fixed

Ran `crapReport.js` on the two touched files (`src/*.ts` paths, per the
CRAP-scopes-to-source rule) and found 10 functions over the CRAP<=6
threshold. Per the differential complexity gate (a standing rule from an
earlier hardening pass this session), compared each CHANGED function's
complexity against `main`'s pre-BL-1393 baseline directly via
`crapLib.js`'s own `extractFunctions`, not estimated:

- `applyAction`: 8 → 10 (+2, exactly the two new `case` branches for the
  ticket's own new action kinds `lean-packet`/`record-empty-outcome`).
- `runNightClosingCeremony`: 11 → 15 (+4, from the new `sleepPath`
  parameter's branching: a `&&` in the early-return guard, an `||` in the
  `ceremonyDue` computation, and a duplicated ternary appearing in both
  return statements).
- `advanceNightClosingCeremony`, `enterBriefing`: unchanged (11→11, 6→6).
- `startFrozen`: 3→4 (+1, the new `workedAShift === false` check the
  architect specifically verified) — CRAP stays 4.00, comfortably under
  threshold both before and after; not treated as blocking.

**Fixed `runNightClosingCeremony`** (commit `8ee4d982b2`): extracted three
helpers — `gateBypassed`, `ceremonyIsDue`, `gateModeLabel` (complexity 2
each) — and simplified a provably-dead ternary in the early-return branch
(reachable only when `sleepPath === null`, so it always evaluated to
`gate.mode` — a real, if minor, clarity bug beyond the complexity number).
Complexity restored to exactly **11**, matching baseline. Re-verified after:
`npm run compile` clean, unit 35/35, property 3/3, e2e 11/11, all three
acceptance suites still green, `jscpd` still 0 clones.

**`applyAction` left at 10 (+2), recorded as a reasoned exception, not
silently accepted.** A `switch` on a discriminated union's cyclomatic
complexity is inherently the number of cases it handles; the only
mechanical way to reduce it below the +2 rise would be converting to an
object-keyed dispatch table, which would sacrifice TypeScript's
type-narrowing on `LiveAction`'s per-case payload fields (`untilMs`,
`code`, `heldParcelIds`, `dayKey`, `shiftKey`) for a purely metric-driven
change — against "the simplest design" and "don't design for hypothetical
requirements". Both new cases are single-line delegate calls, already
covered (100%/76% in-process coverage per the CRAP report), and both are
required by the ticket's own declared action set. Judged: extracting here
would make the code worse to satisfy a number, not better. Recorded
explicitly rather than silently passed over.

## Stryker mutation — blocked by a pre-existing, unrelated standing red

`mutation_cost: medium`, BL-149 gate: run for both files. Load was fine
(4-8 on 20 cores, well under 2x). Attempted a real Stryker run scoped to
`out/quality/nightClosingCeremonyLive.js`; the dry run refused before any
mutant ran, failing on `test/liveRepoDerivationGuard.test.js`'s
`BL-1038: the real extension/test tree has no unjustified live-repository
derivation` assertion — two files unrelated to this ticket
(`bl1243PaneActivitySignal.test.js`, `deprecateRetiredReferents.test.js`)
flagged for unpinned live-repo reads. Confirmed genuinely pre-existing and
already tracked before accepting the blocker: `grep -rl` found
`backlog/paused/BL-1291-a-live-repo-read-is-pinned-or-justified.yaml`, a
standing paused ticket for exactly this class, and the two flagged files
themselves pass cleanly in isolation (`bl1243PaneActivitySignal.test.js`
8/8) — the guard's own repo-wide scan is what fails, not anything BL-1393
touched. **Full Stryker mutation could not run this pass** as a result;
substituted the extensive direct verification above (differential CRAP
analysis with a real fix, non-vacuity already proven by the coder's own
break-then-fix account per the architect's re-confirmation, 35/35 unit +
3/3 property + 11/11 e2e + 32/32 acceptance across three features). Not
silently accepted as equivalent to a mutation pass — recorded as blocked,
per the role's own BLOCKED-item discipline.

## Commit-time property-suite-guard override — disclosed

The `runNightClosingCeremony` CRAP-fix commit was refused by the
pre-commit property-suite-guard: `test/bl1252CommitGuardAggregationInvariants.property.test.js`
(a standing, already-QA-landed ticket from 2026-08-31, unrelated to this
ticket) timed out on isolated re-run rather than asserting cleanly —
the same recurring guard-jam class BL-1234/BL-1356 document, one
different file each time. Committed with
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`, disclosed in the commit message
itself, after independently re-confirming BL-1393's own property test
(`bl1393OneCeremonyEverySleep.property.test.js`) still passed 3/3
immediately before committing.

## CRAP / DRY (final state)

- `jscpd` on both touched files — 0 clones, both before and after the
  CRAP fix.
- CRAP: `runNightClosingCeremony` back to baseline (11, matching main);
  `applyAction`'s +2 rise recorded as a reasoned exception above;
  `startFrozen`'s +1 rise stays well under threshold.

## Process / fixture hygiene

Confirmed no orphaned vitest/Stryker processes belonging to this
worktree after the Stryker attempt and the guard-jam property run — the
only vitest processes found afterward belonged to a DIFFERENT worktree
(`.worktrees/coder`, its own commit-time guard), not reaped since they
are not mine. Cleared `.stryker-tmp/sandbox-*` created by the aborted
Stryker attempt.

## Result

A real differential CRAP regression found and fixed with a clean,
behavior-preserving extraction (verified against every test tier); a
second regression recorded as a reasoned, non-silent exception; a
Stryker mutation attempt genuinely blocked by unrelated pre-existing
infrastructure debt, documented rather than waved through; a
property-suite-guard jam worked around via the disclosed, documented
override after independently confirming this ticket's own property
coverage. Forwarding to documenter.

By hardener.
