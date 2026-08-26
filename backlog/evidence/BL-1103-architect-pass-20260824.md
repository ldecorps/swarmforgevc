# BL-1103 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `70350da9d5` (on coder `7f9bfb19b3`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Fold expedite `sh-bounded` and babysitter `run-bounded!` into
`swarmforge/scripts/bounded_run_lib.bb`. Callers keep local names as thin
aliases; timeout defaults / env seams stay at call sites. Cleaner: APS
steps parse JSON from the real runner.

## Architecture

- Matches approval naming (`bounded_run_lib.bb`, not inside
  `daemon_cycle_guard_lib`).
- Invariant 1: one setsid + `kill -KILL -- -<pgid>` + no-deref-on-timeout
  implementation; callers only `apply` the shared fn.
- Invariant 2: extraction preserves result shape `{:exit :timed-out?}` and
  per-caller bounds.
- Does not fold `daemon_cycle_guard_lib/sh!` (different contract; BL-1102).

## Gates

| Gate | Result |
|---|---|
| Unit (`bounded_run_lib_test_runner.bb`) | ALL PASS |
| Acceptance (BL-1103 feature) | **3/3** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/APS; no `extension/src` production) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1103-one-shared-bounded-runner`.

By architect.
