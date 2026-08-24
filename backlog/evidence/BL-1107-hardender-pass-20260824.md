# BL-1107 — hardener pass, 2026-08-24

## Inbound

Merged architect `d7f1bbb2a6` (on cleaner `f89ff3e139` / coder
`4579fe124d`) into `swarmforge-hardender`.

## Scope

Test-only: enumerate bl796 invariants 2–3 (`cartesianCases`); 120s
timeouts; spawn/coverage instrumentation for APS. No production `src`.

## Host / BL-149

No production files. Host quiet. Gherkin + surgical on the property file.

## Process fix this pass

1. Assert `INVARIANT2_CASES.length === 4` and `INVARIANT3_CASES.length === 6`
   by construction.
2. Acceptance spawn check is exact (`count === points`), not `<=`, so a
   half-enumerated space fails.

## BL-113 Gherkin (soft)

```
total=4 completed=4 killed=4 survived=0
outcome: pass
```

## Hand-authored surgical

| Mutant | Result |
|---|---|
| Inv2 half cartesian space | killed |
| Inv3 drop `back` position | killed |
| Drop inv2 length assert | **equivalent (BL-234)** |
| Drop exercised.size assert | **equivalent (BL-234)** |
| Drop inv3 spawn-cap assert | **equivalent (BL-234)** |

Equivalents: length/exercised/spawn-cap asserts are redundant with exact
spawn logging + ALL_PAIRS coverage acceptance once enumeration is locked;
dropping them cannot change the lane verdict.

Survivors (behaviour): 0.

## Verification

- Acceptance 5/5; properties 3/3; dep-gate PASSED
- HOTFIX stamp-off matches board (`27273f2b0a`)

## Findings

NONE (equivalents documented).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1107-property-lane-verdict-turns-on-host-load-not-code`.

By hardender.
