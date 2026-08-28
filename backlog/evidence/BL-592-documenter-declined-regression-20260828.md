# BL-592 — documenter declined a silent regression on QA merge-up (2026-08-28)

## What happened

QA sent a merge-up broadcast note for BL-751 (approved commit `1188f29a17`).
Merging it into the documenter worktree conflicted on
`extension/test/docsTree.test.js` and
`specs/pipeline/steps/bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js`
(modify/delete). Investigating the delete side showed `1188f29a17` descends
from the coordinator's false "confirmed identical content" retirement
commit `f8a41c1e2` (2026-08-27, see memory
`coordinator-false-identical-content-claim-backlog-retire`) but **not**
from its correction commit `779a036e5` ("Correct BL-891 fixup: restore
BL-1188/1189/592 with real content, not stale").

Merging `1188f29a17` verbatim would have silently reverted, across 9 files,
the live BL-592 epic-tier docs-tree implementation even though the BL-592
ticket is still `status: todo` in both branches (never retired, never
closed):

- `extension/src/docs/docsTree.ts` — schema v2 (epic tier: `EpicNode`,
  `NO_EPIC_KEY`, `flattenMilestoneTickets`) downgraded back to v1.
- `extension/src/bridge/specTreeUiHtml.ts` — deleted.
- `extension/src/bridge/bridgeServer.ts` — spec-tree route/import wiring
  removed.
- `extension/src/bridge/consoleMenuUiHtml.ts` — "Spec tree" menu link
  removed.
- `specs/pipeline/steps/index.js` / `bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js`
  — acceptance step handler unregistered / deleted.
- `pwa/app.js`, `extension/test/docsTree.test.js`,
  `extension/test/pwaDocsExplorer.test.js`, `extension/test/pwaLocale.test.js`
  — epic-tier consumers/tests reverted to pre-BL-592 shape.
- `backlog/evidence/BL-592-coder-pass-20260827.md`,
  `backlog/evidence/BL-1124-property-fixture-git-env-leak-20260827.md` —
  evidence files QA's branch never had, also restored.

## Resolution

Per the established precedent for this exact incident family: declined the
incoming regression, kept HEAD's (documenter's, already-corrected) content
for every BL-592-touched path, and took QA's real BL-751/BL-644/BL-1186/
BL-1219/BL-1184 backlog bookkeeping unchanged. Merge committed as
`01e1bfe11` ("merge: QA merge-up broadcast for BL-751 (1188f29a17); BL-1184
closed to done"). No production behavior was lost; nothing was fixed that
needed fixing — this is a report, not a bounce.

## Ask

Someone with write access to the QA/coordinator lineage should merge
`779a036e5` (or equivalent) forward into whatever branch fed `1188f29a17`,
so future merge-ups from that side don't carry the same regression again.
This is the same underlying gap BL-1216 was minted for (a "confirmed
identical"-style claim landing on `main` before being fully verified) —
check BL-1216's disposition before minting a new ticket for this.
