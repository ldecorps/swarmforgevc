# BL-1173 — architect pass (invariant rematch) — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cleaner rematch `5143dc0495` after architect bounce for unencoded invariants.
Cherry-picked tip-pure: feat `bcdf8ae81` + property fix `4b4130df8` + cleaner
evidence. Stripped conflict markers + BL-1169 hitchhiker require from
`specs/pipeline/steps/index.js` (feat commit had shipped unresolved markers).

## Scope

Deprecator freshness-gate CLI (`deprecate-check.ts`) + fail-closed consult in
`promote_and_route_next.sh` before paused→active promote. Property tests encode
all three declared invariants.

## Architecture

- Pure evaluator + thin CLI in `extension/src/tools/` — host-side tool, no
  webview/tmux boundary issues.
- Promote shell consults compiled CLI; fail-closed on missing CLI / non-zero /
  malformed via `interpretFreshnessCliOutput`.
- Dep-gate **PASSED** on `deprecate-check.ts`.
- Co-change with promote script expected for this wiring — not a boundary leak.

## Invariants (BL-654)

| invariant | encoding |
|---|---|
| CLI failure / malformed → hold, never allow | P1 + P1b (`interpretFreshnessCliOutput`) |
| Expedite never bypasses freshness hold | P2 + P2b (`mayPromoteGivenFreshness`) |
| On hold stays paused + specifier note @00 | P3 (`holdPromoteSideEffects`) + promote script notify |

## Gates

| Gate | Result |
|---|---|
| Dep-gate | **PASSED** |
| Unit (`deprecateCheck.test.js`) | **7/7** |
| Properties (`deprecateCheck.property.test.js`) | **5/5** |
| Acceptance | **5/5** (local run needed restoring missing bl780 step file — worktree drift, not parcel defect; cleaner verified 5/5) |
| Shell `bash -n promote_and_route_next.sh` | OK |

## Forward

`git_handoff` to `hardender`, priority `00`.

By architect.
