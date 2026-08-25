# BL-888 cleaner pass (property rematch) — 2026-08-25

## Inbound

Coder tip `c99c696cee` — hitchhike CLEAN. Architect bounce D1 encoded.
Rematched onto `origin/main` = `12a71424d1`.

## Checks run

1. `test_kill_pipeline_copilot_scope.sh` — ALL PASS (incl. property #06)
2. `bl888_copilot_kill_scope_property_runner.sh` — ALL PROPERTIES HOLD (200)
3. APS `BL-888-teardown-copilot-kill-scope.feature` — 3/3

## Cleanup performed

- Property runner: kind dispatch table + `expect_match` /
  `expect_reject` / `assert_pid_scan` (CC≤6).

## Forward

`git_handoff` to architect, priority 50, task
`BL-888-teardown-copilot-pkill-unscoped-kills-siblings`.

By cleaner.
