# BL-1741 QA hold - unowned red (Article 4.2)

parcel commit: 193e08a310
red: extension/test/bl1252ExpensiveGuardTieringInvariant.property.test.js

Command: `cd extension && npm run test:properties` (one run). Host load: 4.49.

Verbatim failure:

    FAIL  test/bl1252ExpensiveGuardTieringInvariant.property.test.js > property (invariant 2): the expensive guard runs if and only if every cheap guard passes
    AssertionError: generator never reached a suiteOnly plan: {"clean":3,"multiIndexViolation":57,"unexpected":51,"missing":31,"suiteOnly":0}

This is a sampled reach floor: suiteOnly was never drawn in 142 draws, so the case needs to be constructed, not sampled. The file is not in the BL-1741 diff. It has no register row and no active or paused ticket on origin/main.

The other red in the lane, bl781LiveGrepOffender.property.test.js ("isAllowedBabysitterMatch must exist"), is owned by BL-1739. BL-1739's unlanded change on this branch causes it, and BL-1741's tip-pure land does not carry that change.

BL-1741's own gates are green:
- emitLifecycleSnapshotCli.test.js: 4 of 4, 76 ms at load 15.8.
- No lifecycle-snapshot.json written.
- BL-897 feature: 7 of 7.
- Unit suite: 637 of 637 files, exit 0, with no budget offender.

Log: tmp/prop-1741-keep.log.
