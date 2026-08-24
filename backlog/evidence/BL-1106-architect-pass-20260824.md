# BL-1106 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `a993f3e533` (on coder `e74f01e1ac`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

Make every effective-depth input resolve at the repository master checkout:
pause marker and throttle recommendation join the conf path already fixed
by BL-966, via the existing memoized `resolve-identity-root`. Cleaner DRYs
the two path builders through private `master-runtime-path`.

Parcel surface:
- `swarmforge/scripts/backlog_depth_lib.bb`
- `specs/pipeline/steps/bl1106PauseVisibleEverywhereSteps.js` + index
- `extension/test/bl1106PauseVisibleEverywhere.property.test.js`
- cleaner evidence

No `extension/src/**` production change. Out-of-scope daemon pause readers
left alone (matches approval_context blast-radius call).

## Architecture

- Completes BL-966's master-checkout identity rule for the pause (and
  throttle) dimension without inventing a second normalizer —
  `resolve-identity-root` already fail-softs non-git / failed-git to the
  given root (invariant 2).
- Policy stays in `backlog_depth_lib`; CLI / promotion callers unchanged.
  Dependency direction inward; no webview/host boundary, secrets, or
  browser storage.
- Integrate-not-fork: maintained SwarmForge script only.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

    node extension/out/tools/dependency-gate.js \
      test/bl1106PauseVisibleEverywhere.property.test.js
    → PASSED: no forbidden edges.

## Co-change (`node extension/out/tools/co-change-report.js`)

`backlog_depth_lib.bb` couples to its test runners / CLI / depth steps —
expected. Advisory only; no send-back.

## Invariants review (BL-633/BL-654) — 2 declared, both encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Cap, throttle, and pause all resolve at master | `bl1106PauseVisibleEverywhere.property.test.js` + feature Outline | Properties green; acceptance 6 outline rows agree master vs worktree with a real pause on master only. |
| 2 | Non-git scratch root keeps BL-966 stdout/exit | Same property file + BL-966 scenario 04 (unchanged) | Property green against plain temp dir. |

Coder non-vacuity claim: raw `project-root` pause path → worktree prints
cap while master prints 0. No `invariant-unencoded` item.

## Property-testing support (undeclared)

Declared pair covers the pure path-resolution surface this parcel changed.
No additional undeclared property authored (would duplicate).

## Correctness read-through

- Measured defect (0 vs 6 across checkouts) addressed at the path builders
  that `read-effective-max-depth` uses — the promotion CLI's sole depth
  source.
- Throttle path normalized too so invariant 1 is complete (not only pause).
- Unit ALL PASS; acceptance 7/7; properties 2/2. No correctness defect
  spotted.

## Prior bounce check

No BL-1106 bounce evidence under `backlog/evidence/`.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1106-a-pause-is-visible-from-every-checkout`, commit = this evidence
commit (BL-536 / BL-806).

By architect.
