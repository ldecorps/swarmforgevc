# BL-1001 — architect pass (bounce-refix) — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner bounce-refix `e629ccbb81` (closes architect bounce
`5c78d3ee21`) into `swarmforge-architect`. Ancestry confirmed.

## Bounce item closed

Undeclared seat on a tier-active stage → `:skip-ineligible` (probe:
mixed undeclared + high + hard busy → skip). Prefer-fit siblings also
require a declared tier. Untiered stages still `:claim` (BL-983 path).

## Architecture

- Filter still sits in front of BL-983 idle-first claim; declaration site
  remains `--seat-tier` on pack window lines (invariant 2).
- Asymmetric wait / spill-up / prefer-fit unchanged for declared seats.
- Live pack (single coder + `--seat-tier hard`) stays safe; re-adding a
  second window without a tier can no longer silently take hard work.

## Gates

| Gate | Result |
|---|---|
| Unit (`seat_difficulty_lib_test_runner.bb`) | ALL PASS |
| Properties | **4/4** |
| Acceptance (BL-1001) | **6/6** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka claim path) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1001-difficulty-aware-coder-seat-routing`.

By architect.
