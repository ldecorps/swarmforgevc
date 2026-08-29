# BL-1194-missing-property-tests — Coordinator Wrong Commit

## Date
2026-08-29

## Issue
Coordinator sent parcel with commit `c9ecc7ecb5` for task `BL-1194-missing-property-tests-for-declared-invariants`, but that commit is:
- Title: "Expose the spy-grid launcher under scripts/ as well."
- Content: Adds `scripts/open_swarm_spy_grid.sh` wrapper
- Unrelated to BL-1194 property tests

## Context
- The architect bounced BL-1194 for missing property tests (commit `2cda575be`)
- The coder addressed the bounce by adding property tests in commit `47a1f3a1a7`
- The cleaner already merged `47a1f3a1a7` in an earlier parcel (task `BL-1194-hygiene-gate-relative-path-self-duplicate-false-positive`)
- The property test file `extension/test/bl1194HygieneGateSelfDuplicate.property.test.js` is already in the cleaner's tree

## Root Cause
Coordinator dispatch error: referenced the wrong commit hash. Likely a copy-paste error when dispatching multiple redo parcels (the same wrong commit `c9ecc7ecb5` was also sent for BL-581).

## Remediation
- The work is already done (property tests merged from `47a1f3a1a7`)
- Coordinator should re-dispatch with the correct commit or mark the task as complete
- Cleaner cannot proceed with the wrong commit (violates BL-506: approval authorizes only its ticket's work)

## Blame
- Role: coordinator
- Class: dispatch-error (wrong commit hash for task)
