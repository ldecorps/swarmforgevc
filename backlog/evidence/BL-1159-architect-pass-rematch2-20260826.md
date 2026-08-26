# BL-1159 — architect pass — 20260826 (rematch 2)

- merge_and_process cleaner tip `bab418c421` (index.js conflict resolved — restored
  `bl1153StickyWebFontSizeChoiceSteps` alongside BL-1159 + BL-1160; tree **8880** paths).
- Addresses QA bounce D1: BL-1153 APS handler no longer dropped when BL-1159 registered.
- D2 satisfied at HEAD: `residentSpyUiHtml.test.js` includes BL-1153 reload test (from
  BL-1160 stack). Cleaner re-cut `bab418c421` is BL-1159-only vs main.

## Architecture / boundaries (unchanged from rematch 1)

- `stop_bridge_headless.sh` defers when front desk owns stack.
- `recover_miniapp_bridge.sh` routes rearm vs bounce by front-desk liveness.
- `operator_runtime.bb` miniapp recovery uses recover script.

## Verification

- `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh`: ALL PASS
- `test_recover_miniapp_bridge.sh`: ALL PASS
- `test_start_stop_bridge_headless.sh`: ALL PASS
- `test_operator_runtime_tick.sh`: ALL PASS

Pass → hardender.

By architect.
