# BL-1744 QA hold - unowned red (Article 4.2)

parcel commit: 21a188d947
red: extension/test/bl1517ProjectRootArgInvariants.property.test.js

Command: `cd extension && npm run test:properties` (one run). Host load: 12.55.

Verbatim failure:

    FAIL  test/bl1517ProjectRootArgInvariants.property.test.js > property (BL-1517 invariants 1 & 3): every wired site refuses a bad root-position argument, names it verbatim, and leaves the scratch cwd byte-identical
    AssertionError: expected the generator to reach every site, reached: ["operator_runtime.bb","expedite_cli.bb","dropped_parcel_sweep_harness.bb","dispatch_gap_sweep_harness.bb","main_sync_status_cli.bb"]

This is a sampled reach floor: the generator did not draw every wired site, so every site needs to be constructed, not sampled. The file is not in the BL-1744 diff. It has no register row and no active or paused ticket on origin/main.

BL-1744's own gates are green:
- BL-1744 feature: 2 of 2.
- bl1235LocalQwenSeatLive.test.js: 20 of 20.
- Both changed files are byte-identical to the master checkout's unstaged copies (qa_e2e step 3).
- Unit suite: 637 of 637 files, exit 0.

Log: tmp/prop-1744-keep.log.
