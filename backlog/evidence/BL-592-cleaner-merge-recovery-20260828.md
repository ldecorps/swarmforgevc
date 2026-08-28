# BL-592 cleaner merge-up recovery (2026-08-28)

## Context

QA merge-up broadcast for BL-751 (`1188f29a17`) landed in the cleaner
worktree via a `note` (priority 00). Per the constitution's merge-up
protocol, merging it in is a plain `git merge`, not a review — but the
merge itself tried to silently drop BL-592's entire shipped feature.

## What the merge silently reverted

QA's branch never had these files/hunks past their merge-base ancestor
with this worktree (`e5cf2a3af`, "BL-592: live spec tree on Mini App
console with epic tier (schema v2)") — and no commit anywhere on QA's line
touches these paths to explain the loss:

- `extension/src/bridge/specTreeUiHtml.ts` — deleted (auto-merge, no conflict)
- `extension/test/bl592SpecTreeEpicTierInvariants.property.test.js` — deleted (auto-merge, no conflict)
- `backlog/evidence/BL-592-coder-pass-20260827.md` — deleted (auto-merge, no conflict)
- `backlog/evidence/BL-1124-property-fixture-git-env-leak-20260827.md` — deleted (auto-merge, no conflict)
- `specs/pipeline/steps/bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` — modify/delete conflict (QA side deleted, HEAD modified)
- `extension/src/bridge/bridgeServer.ts` — auto-merged clean, but every BL-592 route/import hunk silently dropped (import, `isSpecTreePath`/`isSpecTreeStatePath`, the JSON route entry, the HTML route)
- `extension/src/docs/docsTree.ts` — auto-merged clean, but reverted whole to schema v1 (no `EpicNode`, no `buildEpicNodes`, no `flattenMilestoneTickets`, `DOCS_TREE_SCHEMA_VERSION` back to 1)
- `extension/src/bridge/consoleMenuUiHtml.ts` — auto-merged clean, but the "Spec tree" menu button silently dropped
- `pwa/app.js` — auto-merged clean, but every epic-aware helper (`milestoneEpics`/`milestoneTicketCount`/`milestoneAllTickets`) and epic-aware filter/render logic silently dropped, reverted to flat-tickets-per-milestone
- `extension/test/pwaDocsExplorer.test.js`, `extension/test/pwaLocale.test.js` — auto-merged clean, but fixtures silently reverted to `schemaVersion: 1` / flat `tickets` shape
- `specs/pipeline/steps/index.js` — auto-merged clean, but the `bl592SpecTreeOnLiveConsoleWithEpicTierSteps` require silently dropped

This is the same "silent revert, no authoring commit" class this session
has already hit repeatedly for this exact feature (the
swarmforge-architect tree-collapse saga, BL-1198's git-index-collapse
hypothesis, BL-1195's own investigation). BL-592 appears to be a recurring
casualty of whatever git-state corruption keeps producing this shape.

## What I did

Diffed the merge result against HEAD (both parents were healthy in this
worktree's own history) for every touched file; every hunk that
disappeared was BL-592-shaped and nothing else. Restored HEAD's content
file-by-file (`git checkout HEAD -- <path>`) rather than accepting the
merge's auto-resolution, and re-added the dropped require in
`specs/pipeline/steps/index.js` by hand (that file's other change — an
unrelated require reordering/addition from QA's side — was preserved).

## Verification (all green post-restore)

- `npm run compile` — clean.
- `docsTree.test.js`, `pwaDocsExplorer.test.js`, `pwaLocale.test.js` — 100/100 pass.
- `bl592SpecTreeEpicTierInvariants.property.test.js` (via `vitest.properties.config.mjs`, scoped to this file only — did NOT run the full `npm run test:properties`, per this session's own standing hazard note that the full run has previously corrupted a role worktree's branch ref) — 2/2 pass.
- BL-592's own acceptance feature (`specs/features/BL-592-spec-tree-on-live-console-with-epic-tier.feature`, via `specs/pipeline/cli.js`) — 8/8 scenarios pass.

## What I did NOT touch

Two add/add conflicts (`BL-1203`, `BL-1204` paused tickets) differed only
in `human_approval: pending` vs `approved`, each backed by a real, verified
"Approve BL-xxxx: record human_approval" commit on QA's side — kept QA's
`approved`. One add/add (`docsTree.test.js`) had HEAD adding four newer
BL-592 tests absent from QA's side with nothing removed — kept HEAD's
additions. The pack/conf effort-level retuning
(`swarmforge/packs/full-forge.conf`, `swarmforge/swarmforge.conf`) reads as
a deliberate operator change, not a revert — left as QA's version.

## Disposition

Not a bounce — this is a merge-up receipt (chain ends at QA per the
constitution), not a parcel to forward. Recording here for the standing
BL-592-recurrence pattern and because whatever produces this class of
loss on the QA/main line is a live, unresolved reliability hazard this
session already tracks under multiple prior incident names.

By cleaner.
