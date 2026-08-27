# BL-781 — architect pass — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cherry-picked coder `fc308bf133` (acceptance wiring) and implementation
`d42ede9b2` (deletions + BL-611 allowlist/retired-path updates).

## Scope

Retire dead babysitter wake-runtime files (`babysitter_lib.bb`,
`babysitter_enqueue_wake.sh`, `babysitter_assess.bb`) and
`babysitter_lib_test_runner.bb`. BL-611 scenario 15 no longer exempts product
wake-runtime paths from the scan.

## Architecture

- Pure deletion + allowlist correction — no new production logic.
- Salvaged libs preserved: `babysitter_assess_lib.bb`, `babysitter_nudge_lib.bb`,
  `babysitter_nudge_resident.bb` (invariant 2).
- Retired paths registered in `bl611BabysitterdLifecycleSteps.js` RETIRED list;
  removed from scenario-15 product allowlist (invariant 1).
- `required_wiring`: bl781 handler registered; assess_lib stays allowlisted.

## Gates

| Gate | Result |
|---|---|
| Unit (`babysitter_assess_lib_test_runner.bb`) | **ok** |
| Shell (`test_babysitter_nudge_resident.sh`) | **ALL PASS** |
| Acceptance (BL-781 feature) | BLOCKED BY worktree `steps/index.js` missing BL-1155 handler (not parcel defect) |
| Dep-gate | N/A (deletions / babashka / APS) |

## Forward

`git_handoff` to `QA`, priority `00` (per `required_stages: [coder, architect, qa]`).

By architect.
