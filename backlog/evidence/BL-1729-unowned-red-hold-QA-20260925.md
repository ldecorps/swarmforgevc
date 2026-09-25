# BL-1729 QA hold - unowned reds (Article 4.2)

parcel commit: a724ae759e
red: extension/test/bl1108CursorSeatReadiness.property.test.js
red: extension/test/bl1565CoordinatorNeverReceivesGitHandoffInvariants.property.test.js

Command: `cd extension && npm run test:properties` (one run). Host load average: 11.70 (5-minute) at 14:36; the run started at load 5.8.

Verbatim failures:

    FAIL  test/bl1108CursorSeatReadiness.property.test.js > BL-1108/BL-654 invariant 1: every configured agent token uses its own process marker, never Claude by default
    Error: Test timed out in 20000ms.
    FAIL  test/bl1565CoordinatorNeverReceivesGitHandoffInvariants.property.test.js > BL-1565 invariant: reverse-hop copies never address the coordinator (nor any master-resident role), whatever the pipeline order, sender, or propagation mode
    Error: Test timed out in 20000ms.

Neither file is in the BL-1729 diff. Neither has a standing-reds row or an active/paused ticket on origin/main.

BL-1729's own gates:
- BL-1729 feature: 3 of 3.
- Census comm check: empty.
- The two target files' census rows: 62 MB and 61 MB.
- Unit suite: 637 of 637 files, 10868 tests. Its exit 1 is the budget check naming emitLifecycleSnapshotCli.test.js, which is owned by BL-1741.

Log: tmp/prop-1729-keep.log.
