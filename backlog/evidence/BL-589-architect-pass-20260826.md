# BL-589 — architect pass — 20260826

- Detached review at cleaner tip `0c189ea2d1` (15 paths vs `origin/main`;
  zero sibling hitchhikers).
- Did **not** merge recut into stacked architect branch (re-pollution guard).

## Architecture / boundaries

- Ruling options flow: `backlogReader` reads `ruling_options` from ticket yaml;
  `topicRouter` / `approvalAskClosing` compose keyboards; `pendingApprovalReply`
  records `human_ruling` durably; front-desk bot core dispatches callback taps.
- Pure policy in concierge modules; Telegram I/O at bridge/bot edge — no parallel
  option-parsing paths outside the approval ask contract.
- APS handler `bl589ApprovalAskCarriesRulingOptionsSteps` registered in
  `specs/pipeline/steps/index.js`.

## Verification

- Dependency gate (BL-589 TS sources): **PASSED**
- `backlogReader.test.js`, `conciergeTopicRouting.test.js`,
  `pendingApprovalReply.test.js`, `telegramFrontDeskBotCore.test.js`: **672/672**
- `approvalAskClosing.property.test.js`: **1/1**

Inventory: NONE

Pass → hardender (clean tip only).

By architect.
