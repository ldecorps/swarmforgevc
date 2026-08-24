# BL-752 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `5b9c621b3d` (on coder `01c76572da`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Exercise BL-694 Outline 04's previously-dead "non-stage path under the
backlog" handler; scope BL-694 steps to their feature; BL-752 acceptance
pins non-stage basename collision + unreachable-handler check for that
step file. Cleaner: grandfather new step file; split outline helpers.

## Architecture

- Matches approval: prove the claim via real `backlog/topics/` path; keep
  stage-move exemption; scenario 03 scoped to bl694 handlers only (no
  repo-wide gate).
- Invariant: every registered bl694 pattern matches ≥1 rendered step.
- `defineScoped` prevents "the scan runs" theft across features.

## Gates

| Gate | Result |
|---|---|
| Acceptance (BL-752 feature) | **3/3** |
| Acceptance (BL-694 regression) | **9/9** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (APS/test allowlist only) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-752-bl694-unreachable-step-handler-untested-non-stage-basename-case`.

By architect.
