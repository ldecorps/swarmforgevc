# BL-731 hardener pass — multi-worktree pilot acceptance gate — 20260825

**Architect tip:** `86d8304fc9`
**Task:** `BL-731-bl637-pilot-never-ran-acceptance-multiworktree`
**Batch:** merged QA tip `b4046d6877` (BL-669 merge-up) + architect `86d8304fc9`

## Worktree recovery

`swarmforge-hardender` ref pointed at missing object `15f1133e`; reset to
`020936d80` from worktree reflog before merges.

## Gates

| Gate | Result |
|------|--------|
| `node --test` multiworktree + pilotAcceptanceGate (+ property) | 42/42 |
| APS BL-731 | 4/4 |
| Gherkin mutation | `inapplicable` (no Scenario Outline) |
| Surgical sweep `bl731_mutation_sweep.sh` | killed=7 survived=0 skipped=0 |
| BL-149 cooldown | `run` (host quiet, load ~1.5/20 cores) |
| CRAP | not computed — full `npm run crap` aborts when vitest tries to load `node:test` suites as vitest files (pre-existing lane split); changed helpers are small pure functions |

## Hardening delta

- Import `node:test` in `pilotAcceptanceGate.property.test.js` (cleaner fixed sibling unit files but missed property file).
- Three unit tests closing surgical-sweep survivors: pilot-root exclusion from sibling handoffd roots, supervisor substring guard, non-script required_wiring rejection.
- Hand-authored sweep script for `multiworktreeAcceptanceFixture.js` (BL-638 fallback).

By hardender.
