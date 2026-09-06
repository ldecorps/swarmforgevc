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

## Text filter (BL-1412)

A filter box above the crumbs narrows the tree to a typed term, the
classic IDE tree filter: entries whose own label matches, or that hold a
matching descendant, stay — everything else hides, case-insensitively.
Two match kinds, both applied by the bridge, never the inline script:

- **Ticket match** — title, description or scenario text contains the
  term (BL-254's own `filterDocsTree`, reused byte-identical — it is not
  reimplemented here, since `pwa/app.js` mirrors it by hand and must stay
  in sync with what it mirrors).
- **Label match** — a milestone name, epic title, or ticket id contains
  the term; a label match keeps that node's WHOLE subtree, not just the
  matching node.

`filterSpecTree(tree, query)` (`docsTree.ts`) composes both; the bridge's
`/spec-tree-state` route calls it with the `?q=` query parameter
(`GET` only — `q` rides the same token-eligible path as before, BL-592's
read-only-gate is unchanged). No `q`, or a blank one, returns the full
tree. Filtering PRUNES — a kept ticket keeps its full scenario list and
its exact milestone/epic placement; it is never regrouped. Clearing the
box restores the full tree; a term matching nothing shows a no-results
state naming the term. Out of scope: the static PWA's own copy of the
tree (BL-254, shipped) — this filter reaches the live console only.

## Where it lives

| Piece | Location |
| --- | --- |
| Tree derivation (epic tier) | `extension/src/docs/docsTree.ts` — `buildEpicNodes`, `buildEpicTrackersByKey`, `buildMilestoneNodes`, `flattenMilestoneTickets` |
| Text filter | `extension/src/docs/docsTree.ts` — `filterSpecTree` (reuses `filterDocsTree`, BL-254, unchanged) |
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
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1412-a-text-filter-on-the-live-spec-tree.feature
```

## Out of scope

Editing specs or filing tickets from the tree (read-only, full stop);
removing the static PWA docs explorer beyond the schema migration needed to
keep it working; the BL-117 vision/top level (optional on the live
console, not required); per-epic ETA (BL-591) or epic reordering (BL-572) —
this ticket is navigation only, though it shares the epic surface with both.
