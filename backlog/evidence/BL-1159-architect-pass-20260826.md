# BL-1159 — architect pass — 20260826

- merge_and_process cleaner tip `75a6ec9ab7` (clean merge; tree **8865** paths).

## Root cause / fix

- **Root cause:** `stop_bridge_headless.sh` pgrep-killed `start-bridge-headless.js`
  orphans even when `front-desk-supervisor.pid` was live. Miniapp watchdog bounce
  path invoked stop → SIGTERM bridge child 4–6s after `BRIDGE_LISTENING` (`:crashed`,
  not `:build-stale`).
- **Process fix:** (1) `stop_bridge_headless.sh` defers when front desk owns the
  stack; (2) `recover_miniapp_bridge.sh` routes rearm vs bounce by front-desk
  liveness; (3) `operator_runtime.bb` miniapp recovery calls recover script, not
  direct bounce/stop kill path.

## Architecture / boundaries

- Deterministic shell edge (`recover_miniapp_bridge.sh`, `stop_bridge_headless.sh`);
  operator_runtime orchestration only — no bridge server logic change required.
- BL-1154/1158/1151 invariants preserved (build-stale vs crash, dual-owner, email).
- APS steps registered; fixture acceptance drives real `operator_runtime.bb` ticks.

## Verification

- `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh`: ALL CHECKS PASSED
- `test_recover_miniapp_bridge.sh`: ALL CHECKS PASSED
- `test_start_stop_bridge_headless.sh`: ALL CHECKS PASSED (defer paths)
- `test_operator_runtime_tick.sh`: ALL CHECKS PASSED

Pass → hardender.

By architect.
