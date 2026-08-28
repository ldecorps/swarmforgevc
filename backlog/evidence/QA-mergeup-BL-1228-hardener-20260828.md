# QA merge-up (BL-1228, commit cb742b22b) — hardener worktree, 2026-08-28

QA note: "BL-1228 QA-approved cb742b22b — merge your branch up to QA's
approved commit."

`git merge cb742b22b` produced 2 conflicts, both additive/no-real-loss:

1. `extension/test/bl1211OperatorCli.test.js` (modify/delete) — this file
   is my own hardening addition (unit coverage for the still-live
   `quarantine-lift-check.ts`), not part of any bounced ticket's content.
   QA's line never had this file (it predates my BL-1211 hardening pass,
   which itself sat on top of already-reverted BL-1211 content — see
   `backlog/evidence/QA-mergeup-BL-1227-hardener-20260828.md`). Kept it:
   `quarantine-lift-check.ts` still exists on QA's line (confirmed via
   `git cat-file -e`), is exercised there via
   `specs/features/BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature`,
   but had no in-process unit coverage of its own `parseArgs`/`main()` — this
   file supplies exactly that, with no dependency on anything reverted.
2. `specs/pipeline/steps/index.js` — additive-only: both sides added
   distinct new step-module requires (mine: `bl1207AbandonedLockLivenessSteps`,
   `bl1230NestedGitRepoGuardSteps`, `bl1179CrossVendorMemoryAdapterSteps`;
   theirs: nothing new beyond what I already had). Kept all of mine.

## Verification
- `npm run compile` — clean.
- `node -e "require('./specs/pipeline/steps/index.js')"` — loads clean.
- `npx vitest run test/bl1211OperatorCli.test.js test/nestedGitRepoGuard.test.js test/activePoolFreshnessAudit.test.js test/agentMemoryVendorAdapters.test.js test/cursorBridgeAgentSession.test.js` — 121/121 green.

Per "QA merge-up broadcast (worktree roles)": merged, resolved, verified —
no forward, ending here as part of this batch's combined pass.

By hardener.
