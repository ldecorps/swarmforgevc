# Spec navigation tree on the live console, with an epic tier (BL-592)

## What this is

A read-only drill-down on the LIVE holistic console (the same
token-authed bridge surface as the epic-reorder screen, BL-572):

```
Milestone -> Epic -> BL item -> Gherkin scenarios
```

It ports BL-117's existing `vision -> milestone -> ticket -> Gherkin` engine
(`extension/src/docs/docsTree.ts`'s `computeDocsTree`, `docs/gherkinScenarios.ts`)
with two deltas: it serves live from the bridge instead of a static
published artifact, and it inserts an **epic** tier between milestone and
ticket. Nothing about the underlying derivation changed — it is still a pure
projection over already-committed backlog YAML and `.feature` files, and
still fully read-only: no path from any level edits backlog YAML,
documentation, or files a ticket.

## Why a live route, not the static PWA

BL-117's tree already exists on the static backlog-dashboard PWA
(`pwa/app.js` fetching a git-SHA-reproducible `docs-tree.json`). Per this
project's two-phone-surfaces rule, that PWA stays a reproducible offline
projection; a human asking for "the mini app" means the LIVE console. BL-592
adds `GET /spec-tree-state?token=...`, computing `computeDocsTree` fresh
from the live target checkout on every poll — it reflects the working tree
now, not the last published commit.

## The epic tier

BL-117 predates first-class epics and groups tickets directly under a
milestone. BL-592 inserts a level:

- **No `epic:` field** — the ticket appears in a visible `(no epic)` bucket
  under its milestone; it is never dropped.
- **`type: epic` tracker ticket** — supplies the epic node's title/description,
  and is NOT also listed as a navigable leaf under its own bucket.
- **Cross-milestone epic** — the epic's header appears under **every**
  milestone that has at least one member ticket (by that member's own
  `milestone:`), and each appearance lists only the tickets whose
  `milestone:` matches. A ticket is never hidden behind a single guessed
  "dominant" milestone.

## Schema

`DOCS_TREE_SCHEMA_VERSION` bumped `1` -> `2` (structural, not additive):
`MilestoneNode` now carries `epics[]` between the milestone and its
tickets. `pwa/app.js` was migrated in the same parcel to drill
milestone -> epic -> ticket when `schemaVersion >= 2`, while still reading
the flat root `tickets[]` roll-up for lookup and search — the static PWA
explorer keeps working, not just the live console.

## Where it lives

| Piece | Location |
| --- | --- |
| Tree derivation (epic tier) | `extension/src/docs/docsTree.ts` — `buildEpicNodes`, `buildEpicTrackersByKey`, `buildMilestoneNodes`, `flattenMilestoneTickets` |
| Live route | `extension/src/bridge/bridgeServer.ts` — `isSpecTreePath` / `isSpecTreeStatePath`, `/spec-tree` and `/spec-tree-state` |
| Console menu entry | `extension/src/bridge/consoleMenuUiHtml.ts` — links the live spec tree screen |
| Live screen markup + drill-down script | `extension/src/bridge/specTreeUiHtml.ts` |
| Static PWA migration | `pwa/app.js` — `milestoneTicketCount` / `milestoneAllTickets` now epic-aware |

## Verify

```bash
npm test -- extension/test/docsTree.test.js extension/test/specTreeUiHtml.test.js \
  extension/test/specTreeBridge.test.js extension/test/pwaDocsExplorer.test.js \
  extension/test/pwaLocale.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-592-spec-tree-on-live-console-with-epic-tier.feature
```

## Out of scope

Editing specs or filing tickets from the tree (read-only, full stop);
removing the static PWA docs explorer beyond the schema migration needed to
keep it working; the BL-117 vision/top level (optional on the live
console, not required); per-epic ETA (BL-591) or epic reordering (BL-572) —
this ticket is navigation only, though it shares the epic surface with both.
