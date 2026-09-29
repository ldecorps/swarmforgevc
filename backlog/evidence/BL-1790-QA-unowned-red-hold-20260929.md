# BL-1790 - QA unowned-red hold, 2026-09-29

Parcel: documenter 3e5b4e0e44, merged into QA as e177599d02.
parcel_commit: e177599d02

BL-1790's own gates are green; approval is withheld under Article 4.2
because the property lane carries two red files with no open owner. The
parcel waits for their owner; it is not bounced (it touches neither file).

## Unowned reds (no row in backlog/standing-reds.tsv, no open ticket)

red: extension/test/bl1642QaNoteEvidenceInvariants.property.test.js
  > property (BL-1642 invariants 1 & 2): note evidence completes a QA forward, never another role's, and both kinds obey the same since/ticket-match rule
  Error: Test timed out in 20000ms.
  (test/bl1642QaNoteEvidenceInvariants.property.test.js:119:1; file 23.2 s)
  Owner grep: no ticket in backlog/ (active, paused, hold, done) names the file.

red: extension/test/bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js
  Failure line NOT captured: qa-gather's excerpt is the last 4000 chars of
  the lane output and does not reach this file's FAIL block. Its
  register_join (parsed from the whole output) names the file, and vitest's
  results cache for this run records it `failed: true`, file duration
  22690 ms - the same 20-23 s shape as the three 20000 ms timeouts beside
  it. Not re-run (one lane run per parcel). The owner's reproduction must
  capture the message.
  Owner grep: only closed BL-1328 and BL-1457 name the file.

## Owned reds in the same run (not blocking)

extension/test/bl1445StaffingGateWiringTestDecidesOverrideInvariants.property.test.js [BL-1808]
  Error: Test timed out in 20000ms.
extension/test/bl1715DriverSeatGiveUp.property.test.js [BL-1808]
  Error: Test timed out in 20000ms.
Plus `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` (BL-871
allowlisted).

## BL-1790's own gates (all on e177599d02, one run each)

- qa-sibling-check status: VERIFY BL-1790.
- pre_qa_gate.sh (required_wiring, honest empty): OK.
- Unit (npm test): exit 0.
- Acceptance (BL-1790 feature): 2/2 ok.
- qa_e2e 2: `npx vitest run --config vitest.properties.config.mjs
  test/bl586PipelineBoardTopicIdentity.property.test.js`: 2/2 passed
  (99 ms); in the lane run the file also passed (218 ms).
- qa_e2e 3: the bl586 register row is present and names BL-1790.
- qa_e2e 4: BL-1790's own commits touch only the test file, the step
  handler and backlog/evidence/BL-1790-*.md (the feature landed at mint;
  handlers are auto-discovered, no index.js registration exists any more).
- Review: every floor (50/5/5, 100/50/80/25) and every per-case assertion
  is unchanged; budgets 150 >= 100 and 1000 == 1000; no seed or retry.

Stragglers after the lane: the vitest processes it listed belonged to the
coder's worktree; none of QA's were alive.

By QA.
