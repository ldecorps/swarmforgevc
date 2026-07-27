# Requirement gap — epic drill-down re-prioritization must include parked BL, not only active ones

**From:** operator (human), 2026-07-27, via Cursor session  
**Surface:** Mini App console → **Reorder epics** → **Topics** drill-down (BL-572 / BL-674)  
**Severity:** medium (operator cannot reorder child BL they consider parked under an epic)

## What the human saw

On the epic reorder screen, after tapping **Topics** on an epic tile, the
drill-down shows:

> **No live topics in this epic.**

The human expected to see — and re-prioritize — backlog items under that
epic that are **parked** (pipeline-board sense: child BL waiting in
`backlog/paused/`, not currently promoted to `active/`).

## What the human is asking for

The within-epic re-prioritization option (drill-down list + per-topic
**Make top**, BL-673/BL-674) must **not** be limited to tickets that are
already **active** / in-flight. It must also cover tickets that are
**parked** under the same epic so the operator can reorder the epic's
queue before anything is promoted.

In short: **active ∪ parked** child BL under the epic should be visible
and reorderable from this screen — not an active-only subset.

## What shipped today (for the specifier to reconcile)

BL-672/673/674 intentionally defined a **live** domination set as
`backlog/paused/` + `backlog/hold/` only — **`active/` is excluded**
(see BL-672 `approval_context` #3 and `readLiveBacklogItems` in
`bridgeServer.ts`). The drill-down empty state copy says **"No live
topics in this epic."** (`epicReorderUiHtml.ts`).

So the implementation already *claims* paused/hold topics; the human
still sees an empty drill-down while parked children exist. That could be:

1. **A bug** — parked children exist but are filtered out (e.g. missing
   or mismatched `epic:` field on child YAML, wrong epic id match, only
   `type: epic` rows counted, hold/ vs paused/ edge case, etc.).
2. **A spec gap** — the human also wants **`active/`** child BL in the
   same within-epic reorder surface (contradicts BL-672 #3 unless
   amended).
3. **A vocabulary gap** — "live" in the UI reads as "active/in progress"
   to the operator; parked paused tickets should appear but do not, and
   the label misleads.

The specifier should determine which case this is on a real epic the
human was viewing, and whether the fix is read-model only, domination-set
expansion, or both.

## Related tickets / docs

- BL-572 — epic tile reorder (paused epics only on the top screen)
- BL-672 — epic-level make-top (live = paused + hold)
- BL-673 — topic-level make-top within an epic (peer set = that epic's
  live topics)
- BL-674 — drill-down UI wiring the above
- `docs/how-to/BL-572-console-epic-priority-reorder.md` — documents
  "live topics" as paused/ + hold/

## Suggested disposition (non-binding)

- If **bug**: fix the read model so every paused/hold child with
  `epic: <epicId>` appears in the drill-down; add regression coverage
  for an epic whose only children are parked (not active).
- If **spec expansion**: amend BL-673/674 (and possibly BL-672) so
  within-epic reorder includes `active/` children too, with explicit
  rules for rewriting priority on in-flight tickets (worktree staleness,
  promotion gates) — do **not** silently widen the domination set without
  human sign-off on those trade-offs.
- Regardless: consider renaming the empty state from "No **live** topics"
  to language the operator understands ("No reorderable topics" / "No
  parked or active topics under this epic") once the real peer set is
  settled.

## Evidence to attach when speccing

- Screenshot from 2026-07-27: epic drill-down empty state ("No live
  topics in this epic.") on the Reorder epics screen.
- Identify the epic id tapped and list its child BL from
  `backlog/paused/`, `backlog/hold/`, and `backlog/active/` with
  `epic:` fields — compare to what `GET /epic-reorder-state` returns
  under `topics`.
