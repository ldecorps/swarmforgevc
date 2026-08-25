# BL-1031 — architect pass (QA bounce re-fix) — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `7828eaadb6` (on coder `76915b256a` fifo-handshake fixtures)
into `swarmforge-architect` after QA merge-up `4c123c4e0c`. Ancestry
confirmed. Prior QA bounce D1–D3: flaky depth≥2 pipe-hold fixtures returning
exit 0 instead of 124 under WSL race.

## Scope of this tip

Fixture-only: unit undrainable cmd and property hang-at-depth script
handshake on a fifo so the parent exits only after the pipe-holder retains
stdout. Production `sh!` / spawn-reachable libs unchanged from the prior
architect-passed lineage.

## Architecture

- Corrects the test oracle for the BL-1021 depth≥2 class; does not widen
  or weaken the chokepoint contract.
- No webview/host/secrets surface. Dep-gate N/A (babashka/APS test only).

## Gates

| Gate | Result |
|---|---|
| Unit (`daemon_cycle_guard_lib_test_runner.bb`) | ALL PASS; stress ×5 green |
| Properties (`daemon_cycle_guard_lib_property_runner.bb`) | ALL PROPERTIES HOLD |
| Acceptance (BL-1031 feature) | **7/7** |
| Stamp-off (BL-1113) | **9/9**; Spec `&nbsp;` intact |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree`.

By architect.
