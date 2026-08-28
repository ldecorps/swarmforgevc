# BL-592 — coder declined the same regression, merging BL-751's QA broadcast

**Recurrence of the incident tracked in
`backlog/evidence/BL-592-documenter-declined-regression-20260828.md` and
`backlog/evidence/BL-1200-documenter-declined-regression-recurrence-20260828.md`.**

## What happened

Received QA merge-up note for BL-751 (commit `1188f29a17`) and merged it
into `swarmforge-coder` per the QA-merge-up protocol (Article 2.5 /
`workflow.prompt`). `1188f29a17` descends from `f8a41c1e2` (the false
"identical content" retirement) **without** its correction `779a036e5`, so
the plain three-way merge again silently reverted BL-592's implementation
even though most of the affected files merged with no conflict (git read
the pair as "deleted on one side, unchanged on the other" against a virtual
merge base — same BL-571/BL-958 shape, and same root cause documented in
`BL-592-specifier-land-hazard-silent-drop-20260828.md`).

## What was dropped and restored (from this branch's own HEAD)

- `extension/src/docs/docsTree.ts` — schema v2 → v1, epic grouping removed
  (`EpicNode`, `buildEpicNodes`, `flattenMilestoneTickets` all gone)
- `extension/src/bridge/specTreeUiHtml.ts` — deleted outright
- `specs/pipeline/steps/bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` —
  deleted outright (registration line in `specs/pipeline/steps/index.js`
  also dropped by the same merge; re-added)
- `extension/test/bl592SpecTreeEpicTierInvariants.property.test.js` —
  deleted outright
- `extension/src/bridge/bridgeServer.ts`, `consoleMenuUiHtml.ts` — epic-tier
  route/menu-link wiring stripped
- `pwa/app.js`, `extension/test/pwaDocsExplorer.test.js`,
  `extension/test/pwaLocale.test.js` — downgraded to the flat (no-epic)
  shape
- `backlog/evidence/BL-1124-property-fixture-git-env-leak-20260827.md`,
  `backlog/evidence/BL-592-coder-pass-20260827.md` — evidence files deleted

All restored via `git checkout HEAD -- <path>` before committing the merge.
Verified: `npm run compile` clean, `docsTree.test.js` / `pwaDocsExplorer.test.js`
/ `pwaLocale.test.js` / `specTreeBridge.test.js` (non-CURSOR_API_KEY cases)
all green post-restore.

## Backlog pool also stale on this branch

Independently of the merge, this branch's own pre-merge `HEAD` still carried
BL-644/751/1196/1200 at their `f8a41c1e2`-era locations
(`paused/`/`active/`), while `origin/main` (and local `main`) already has
all four correctly in `backlog/done/` (per
`coordinator-false-identical-content-claim-backlog-retire`, pool closed
2026-08-28). Synced this branch's copies to match `origin/main`'s `done/`
location rather than keep the stale duplicates.

## Disposition

Landed as `86d147c21` on `swarmforge-coder`. No new ticket minted — same
underlying gap as the prior three occurrences (BL-1216 family): `779a036e5`
has still not been merged forward into whatever feeds the QA-side lineage
that produced `1188f29a17`, so the next QA merge-up from that lineage will
almost certainly repeat this. Escalating via priority-00 note to specifier
and coordinator.

By coder.
