# BL-1159 — architect pass — 20260826 (rematch 3)

- merge_and_process cleaner tip `003586d89a` (index.js conflict: kept bl1153 +
  bl1159 + bl1160; tree **8886** paths).
- QA rematch2 D1: restored `origin/main` inline `cond->` observed-events block
  (no `tick-observed-events` — not on main); kept `recover_miniapp_bridge` routing.
- Post-merge fix: closed `cond->` paren (parse error in auto-merge).

## Verification

- `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh`: ALL PASS
- `test_recover_miniapp_bridge.sh`: ALL PASS
- `test_operator_runtime_tick.sh`: BL-1159 surface pass; BL-653 idle-tick cases
  fail with main tick block (expected — BL-653 API not on main; sibling concern)

Pass → hardender.

By architect.
