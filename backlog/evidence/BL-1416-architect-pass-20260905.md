# BL-1416 — architect pass, 2026-09-05

Ticket: BL-1416-busy-pane-never-auth-dead
Role: architect
Commit reviewed: 456d089a59 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1416BusyPaneNeverAuthDeadSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is entirely in Babashka daemon/lib code
  (`handoffd.bb`, `provider_auth_observe_lib.bb`) and a Node step handler
  using only `node:path`/`node:child_process` — no webview import, no VS
  Code API, no direct process-spawn from a view module, no secrets
  handling, no browser storage. `provider_auth_observe_lib.bb` stays pure
  (busy enters only as a `:busy?` config flag; the predicate itself,
  `chase-sweep-lib/actively-processing?`, stays where it lives, consulted
  only from `handoffd.bb`) — matches the ticket's own "keep the lib pure"
  direction.
- **Co-change report** on the three changed files: `handoffd.bb` shows the
  large standing-coupling list any change to that central daemon file
  always shows (it is the daemon's god-file, touched by nearly every
  subsystem) — pre-existing structure, not something this parcel's diff
  introduced or worsened.

## Invariants Review (BL-633/654)

Ticket declares three invariants; all three have a coder-authored property
test (`bl1416_busy_pane_never_auth_dead_property_runner.bb`), each shown
non-vacuous by the coder's own break-then-fix record
(`backlog/evidence/BL-1416-coder-20260905.md`). I independently re-ran it
in this worktree:

```
generator coverage: {:p1-min-attempts-nonzero 401, :p2-some-skipped 425, :p2-all-performed 75, :p3-nil-line 116}
bl1416 busy-pane-never-auth-dead properties: 500 runs each
ALL PROPERTIES HOLD
```

All three invariants held; reach floors (runs/10 = 50) cleared with wide
margin on every bucket. Also independently re-ran the pre-existing BL-536
unit and property suites for regression:

```
bb test/provider_auth_observe_lib_test_runner.bb        → PASS
bb test/provider_auth_observe_lib_property_runner.bb    → ALL PROPERTIES HOLD, 500/500
bash test/test_handoffd_auth_observe_wiring.sh          → PASS 01-03 (real daemon + fake tmux)
```

Traced the state-machine correctness by hand: on an `:alert` tick,
`decide-episode-action`'s alert branch does not increment `:attempts` (only
sets `:alerted true`), so `observe-pane-auth!`'s
`(get-in decision [:state :attempts])` passed to `send-auth-persist-alert!`
correctly reports the count already committed by prior ticks via
`resolve-committed-state` — i.e., the real performed count, not a
tick-inflated one.

## Acceptance wiring

Feature declares 5 scenarios / 7 scenario runs (Scenario Outline with 3
examples + 4 plain scenarios). I independently drove
`bl1416BusyPaneNeverAuthDeadSteps.js::registerSteps` against all 5
scenarios' step text (own harness, not reusing the coder/cleaner's runner
invocation) — all 7 runs passed. `registerSteps` export present per the
ticket's `required_wiring` anchor (BL-1371); `grep -n "actively-processing?
pane) :healthy" swarmforge/scripts/handoffd.bb` matches the other
`required_wiring` anchor.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.
