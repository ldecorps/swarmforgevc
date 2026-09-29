# BL-1707 — QA hold: unowned property red (Article 4.2), 2026-09-27

Parcel commit: 849fd723ca (documenter 488ceeefb9 merged into QA)
Red: extension/test/bl586PipelineBoardTopicIdentity.property.test.js

BL-1707's own gates are green on 849fd723ca: feature 6/6,
test_agent_runtime_inject_mock.sh ALL PASS, model_steward_test_runner.bb
ALL PASS, hotfix-ledger rows 22a2a9fc7f/7ba57573ff/e94b78a7a3
human_decision: null, scope = evidence + step handler, npm test exit 0,
pre_qa_gate OK, acceptance 0. The parcel touches no extension/test file.

`npm run test:properties` (qa-gather, one run): exit 1, one failing file,
register_join `absent` - no row in backlog/standing-reds.tsv, no open
ticket. BL-1583 (paused epic) names bl586 only as a census phrase blind
spot (item (d)), not as an owned red. Verbatim:

    FAIL  test/bl586PipelineBoardTopicIdentity.property.test.js > property (BL-586 invariant 1): for any topic map and any stored id, the board only ever posts into a topic the map does not attribute to another subject
    AssertionError: generator reached only 3 already-board-bound states
     ❯ test/bl586PipelineBoardTopicIdentity.property.test.js:125:10
       125|   assert.ok(reach.boardBound >= 5, `generator reached only ${reach.boa…

A sampled reach floor (boardBound >= 5) missed on this draw: the
BL-1786 / BL-1583 shape. The rest of the lane's excerpt is the allowlisted
`[vitest-worker]: Timeout calling "onTaskUpdate"` (BL-871). Full lane report:
QA worktree tmp/BL-1707-gather.json (kept until the parcel lands).

The parcel waits for an owner; it is not bounced.

By QA.
