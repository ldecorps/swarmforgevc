# BL-1162 — cleaner pass — 20260826

- merge_and_process coder tip `e4f0bf433c` (conflict in
  `specs/pipeline/steps/index.js`: kept bl1162 handler once; dropped duplicate
  bl588/bl1160/bl653/bl660 registrations already present upstream).
- DRY: consolidated reconcile JSON parse in `install_shift_schedule_cron.sh`
  from four python3 invocations to two heredoc reads.
- DRY: `assertPassMarker` + property-suite exit check in
  `bl1162StartStopSwarmCronLifecycleSymmetrySteps.js` (mirrors BL-1151).
- Verified: `test_bl1162_start_stop_swarm_cron_lifecycle.sh`,
  `bl1162_swarmforge_cron_property_runner.sh` all green.

By cleaner.
