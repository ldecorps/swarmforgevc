# BL-754 — architect pass — rematch — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cherry-picked cleaner `325b816efc` + coder `2c26e8f9eb` (avoided full merge —
cleaner tip carries unrelated backlog/conf hitchhikers). Adds declared-invariant
encoding in `required_stages_test_runner.bb` atop implementation already on
`main`.

## Scope

BL-654 follow-up: encode declared invariants 1–2 in unit tests (quote-style
parity; malformed never returned as complete). Production parse unchanged on
`main`; this parcel is test-encoding only.

## Invariants (BL-654)

| invariant | encoding |
|---|---|
| 1 — malformed never read as well-formed | unit asserts `(:malformed …)` present + names remainder |
| 2 — quote style alone never changes parse | unit `assert=` double- vs single-quoted reads |
| 3 — observational, never blocks send | acceptance scenarios (cleaner **5/5** on parcel line) |

## Architecture

- Tests target pure `required_stages_lib` reads — no boundary violation.
- Encoding lives in Babashka unit runner (BL-472 degraded lane) — appropriate.

## Gates

| Gate | Result |
|---|---|
| Unit (`required_stages_test_runner.bb`) | **ALL PASS** (this worktree) |
| Acceptance (BL-754 feature) | BLOCKED BY worktree `steps/index.js` pollution (missing BL-1155 steps file); cleaner verified **5/5** on parcel line |
| Dep-gate | N/A (babashka/APS) |

## Forward

`git_handoff` to `hardender`, priority `00`.

By architect.
