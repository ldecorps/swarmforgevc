# BL-1107 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `f89ff3e139` (on coder `4579fe124d`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

`bl796NvmNodePathFollowUpAdoptInvariants.property.test.js` invariants 2–3:
replace oversampling fast-check (10/12 draws over 4/6-point spaces) with
exhaustive enumeration; spawn count ≤ space size; per-test `120000` timeout
matching invariant 1 (BL-1063). Lane default `testTimeout: 20000` unchanged.
Cleaner: shared `cartesianCases`.

## Architecture

- Matches approval recommendation: drop fast-check for these two small
  spaces; coverage by construction (invariant 2).
- Verdict no longer load-bound via duplicate subprocess work (invariant 1).
- Test-only change; no production module rewrite. Stamp-off tip hygiene OK
  (`27273f2b0a`, BL-1113 9/9).

## Required hard gate

`node extension/out/tools/dependency-gate.js test/bl796NvmNodePathFollowUpAdoptInvariants.property.test.js`
→ PASSED.

## Invariants review (BL-633/BL-654) — 2 declared, encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Lane verdict = code, not host load | enum + 120s override + feature | Green |
| 2 | Small spaces exercised by construction | cartesianCases + coverage assert | Green |

## Property-testing support (undeclared)

Declared pair covered by the same file (3/3 including invariant 1). No
additional undeclared property authored.

## Correctness read-through

- Properties 3/3; acceptance 5/5 (incl. mutation still fails).
- Distinct from BL-1062 (coverage-floor asserts elsewhere).
- No prior BL-1107 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1107-property-lane-verdict-turns-on-host-load-not-code`, commit = this
evidence commit (BL-536 / BL-806).

By architect.
