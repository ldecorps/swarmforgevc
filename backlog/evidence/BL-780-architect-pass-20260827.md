# BL-780 — architect pass — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cherry-picked coder `4a97e763a6` (acceptance wiring; resolved `index.js`
conflict keeping BL-980 + BL-780 handlers) and implementation `e06484156`
(not in the coder handoff payload — required for scenarios 01/04 and wiring
test; cleaner slice already in branch history).

## Scope

Lower shipped `default-note-actionable-after-ms` to 10 minutes (below 15-minute
`flow_watchdog_warn_ms`); startup reports inverted operator conf without
rewriting; BL-576 broadcast drain behavior unchanged.

## Architecture

- Threshold constants and pure parsers in `mono_router_lib.bb` / `flow_watchdog_lib.bb`.
- Daemon startup observation in `handoffd.bb` — config read at boundary, not
  in chase hot path.
- Acceptance steps drive real Babashka eval + `test_bl780_rotation_actionability_ordering.sh`.

## Gates

| Gate | Result |
|---|---|
| Unit (`mono_router_lib_test_runner.bb`) | **ok** |
| Wiring (`test_bl780_rotation_actionability_ordering.sh`) | **exit 0** |
| Acceptance (BL-780 feature) | BLOCKED BY worktree `steps/index.js` missing BL-1155 handler (not parcel defect; coder **5/5** on clean line) |
| Dep-gate | N/A (babashka/shell/APS) |

## Forward

`git_handoff` to `hardender`, priority `00`.

By architect.
