# BL-1727 QA hold - unowned red (Article 4.2)

parcel commit: e9b1c4f30e
red: extension/test/bl1670LandStrayConflictSupersededInvariant.property.test.js

Command: `npm run test:properties` (one run, via qa-gather.js), host load: 5.56

Verbatim failure:

    FAIL  test/bl1670LandStrayConflictSupersededInvariant.property.test.js > BL-1670/BL-654 invariant: a pure-evidence/doc stray conflict superseded on either provable ground reports LAND_STRAY_SUPERSEDED and the replay completes; an unrelated ticket having rewritten the conflicting line still escalates
    Error: Test timed out in 20000ms.

(Also 3x the allowlisted BL-871 `[vitest-worker]: Timeout calling "onTaskUpdate"`.)

The file is not in the BL-1727 diff. `grep -rl bl1670LandStrayConflictSupersededInvariant backlog/` is empty; the register join reads absent. BL-1727's own gates are green: its feature 4/4, test_ollama_ancillary_stop_pid.sh and test_ollama_ancillary_launch_gate.sh ALL PASS, BL-1703's feature 5/5, and the unit, acceptance, wiring and sibling checks all exit 0. It is wired into its one internal caller, ollama_ancillary_lib.sh:197. Full log: tmp/qa-gather-1727-keep.json.
