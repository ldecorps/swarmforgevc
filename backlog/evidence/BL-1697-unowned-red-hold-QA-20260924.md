# BL-1697 - QA hold on unowned reds (Article 4.2), 2026-09-24

Parcel commit: 8e0fd17c06 ("Merge documenter 89d5a46c3a into QA.")
One run per lane via qa-gather.js, host load average 11-14 throughout.

Red paths with no row in backlog/standing-reds.tsv or suite-poles.tsv:

1. extension/test/bl1652HandoffdRespawnReadingsWiring.test.js (unit, per-file budget guard)
   `extension/test/bl1652HandoffdRespawnReadingsWiring.test.js: 13.4s exceeds the 7.0s per-file budget`
   Every test in it passes; only the time budget fails. The file loads the real handoffd.bb
   in 8 places. BL-1697 adds a load-file of local_parcel_driver_lib.bb to handoffd.bb.
   Interleaved at load ~12, bare `load-file handoffd.bb` took: main 737/1105/1048ms, parcel
   971/1054/1140ms. That is roughly 0.1s per load from the parcel, about 0.7s across the file.
   The file alone at load 13.2 ran 7/7 in 9.6s. Load drives this red, and the parcel's share
   is marginal. Same class as BL-1721's rows.

2. extension/test/bl1650LandStepPureEvidenceStrayInvariants.property.test.js (property)
   `Error: Test timed out in 20000ms.` - "BL-1650/BL-654 invariant 2: a landed stray is recorded"
   (test/bl1650LandStepPureEvidenceStrayInvariants.property.test.js:177). BL-1697 touches no land
   step code.

Also in the unit run: emitLifecycleSnapshotCli.test.js over budget (11.9s), already owned by
BL-1721. The two unhandled errors in the property run are the allowlisted BL-871
`[vitest-worker]: Timeout calling "onTaskUpdate"`.

BL-1697's own gates in the same pass: acceptance (the BL-1697 feature) green; pre_qa_gate
OK (both required_wiring anchors); sibling-check VERIFY. qa_e2e step 2:
test_handoffd_chase_sweep_wiring.sh, test_handoffd_driver_seat_injection_skip.sh,
test_handoffd_startup_notify.sh, test_handoffd_wake_attribution_wiring.sh and
test_handoffd_startup_notify_fresh_target.sh all pass. Step 3: every new skip reads
local-parcel-driver-lib/driver-seat?, which reads prompt-engine-lib/parcel-driver-capable?,
never the string "aider".

By QA.
