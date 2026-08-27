# BL-1162 — cleaner re-cut pass — 20260826

- merge_and_process QA bounce `764552bcef` (D1: tip entangled with BL-653/660/588/1160).
- Re-cut from `origin/main` @ `97394ccb3`: restored BL-1162 cron registry +
  schedule reconcile slice only (22 paths vs main).
- Dropped BL-653/660/588/1160/1152 hitchhikers; reconcile uses legacy
  `continuous-shifts.json` path only until BL-660 lands (no swarm_shift_lib).
- Verified: `test_bl1162_start_stop_swarm_cron_lifecycle.sh`,
  `bl1162_swarmforge_cron_property_runner.sh` all green.
- Purity: `git diff origin/main --name-only | rg '653|660|588|1160|1152'` — empty.

By cleaner.
