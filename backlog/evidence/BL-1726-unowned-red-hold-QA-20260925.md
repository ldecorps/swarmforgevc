# BL-1726 QA hold - unowned red (Article 4.2)

parcel commit: 0bf0fada5e
red: extension/test/bl1474ReplayCommitRefusalReasonInvariants.property.test.js

Command: `cd extension && npm run test:properties` (one run), host load 3.66

Verbatim failure:

    FAIL  test/bl1474ReplayCommitRefusalReasonInvariants.property.test.js > property (invariant 1): nothing to commit is reported only when the index is empty, whatever stderr says
    AssertionError: generator never produced stderr kind "whitespace-only": ["false:empty","true:well-over-limit","false:short-with-newline","false:well-over-limit","false:one-over-limit","true:short","true:at-limit","true:short-with-newline","true:empty","false:short","false:at-limit","true:one-over-limit"]

This is a sampled reach floor: the generator's stderr kind "whitespace-only" was never drawn, so it needs to be constructed, not sampled. The file is not in the BL-1726 diff. `grep -rl` over backlog/ names only closed tickets (BL-1663, BL-1572) and old evidence, and there is no register row.

BL-1726's own gates are green:
- BL-1726 feature: 5 of 5.
- BL-1705 feature: 8 of 8.
- orphan_janitor_lib_test_runner: ALL CHECKS PASSED.
- bl1726 property test: 1 of 1.
- Live read (constructed lib/ollama path plus a real blob): true for ollama's own server, false for a llama.cpp path.
- Unit suite: 637 of 637 files.
- Property lane: 461 of 462 files; the one failure is the file above.

Log: tmp/prop-1726-keep.log.
