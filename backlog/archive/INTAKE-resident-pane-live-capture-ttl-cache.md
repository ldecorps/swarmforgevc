# Raw intake — resident-pane live capture wedges the bridge under Mini App poll bursts; TTL cache draft already in the master worktree

Status: **new intake, not minted.** Capture only (human via Cursor
2026-08-11 ~17:30 CEST). Keep the uncommitted master-worktree draft;
do **not** discard it. Specifier: mint a defect ticket and treat the
draft as the intended landing, not a greenfield rewrite.

## Why this is in front of you

Coordinator note (Telegram, same day): stray uncommitted
`extension/src/bridge/*` diff (resident-pane polling cache) on the master
worktree has **no ticket**, is blocking `build_freshness_cli.bb sync`, and
must be identified/ticketed or discarded by a human. Human chose **keep +
ticket**.

## Goal

1. Mint a **medium** defect ticket (next free id — expected **BL-881**) in
   `backlog/paused/` with `human_approval: pending` until the feature draft
   is reviewed.
2. Disposition: **land the already-written draft** through the normal
   coder→…→QA chain (stamp/review of a pre-written fix). Re-implement from
   scratch only if review finds the draft wrong.
3. Unblock build-freshness: once the ticket exists, the human (or an
   authorized commit of the three-file draft onto a tracked branch) can
   clear the dirty master tree. Specifier does **not** sweep or commit the
   bridge files themselves beyond what minting the ticket requires.

## The defect

The Mini App Live / Resident Spy UI polls the bridge `/resident-pane`
endpoint on a short interval. Each live capture is a **synchronous** tmux
+ filesystem walk that can take multiple seconds under host load. Node
serves the bridge on a single event-loop thread, so a burst of overlapping
polls wedges the whole bridge (HTML shells time out too).

## Draft already in the master worktree (keep)

Uncommitted as of intake time (`git status` on master):

| File | Change |
|------|--------|
| `extension/src/bridge/residentPaneLive.ts` | 5s TTL cache around `captureMonoRouterLiveScreen`; `clearResidentPaneLiveCache()` test hook; uncached walk renamed to `captureMonoRouterLiveScreenUncached` |
| `extension/src/bridge/residentSpyUiHtml.ts` | `setInterval(refresh, …)` 1500 → 4000 ms so the UI does not poll faster than a live capture can finish |
| `extension/test/residentPaneLive.test.js` | `withFreshPaneCache` clears the TTL cache around capture assertions |

## Locked human decisions

1. **Keep** the draft; do not `git checkout --` / discard it.
2. Ticket it so build-freshness has an identified owner rather than a
   nameless dirty tree.
3. Prefer stamp-and-land of this draft over a parallel rewrite.

## Out of scope

- Bubble Live Screen shell / remote pages (BL-775 and siblings) beyond
  sharing the same capture source.
- Interactive pane input (BL-569).
- Broader bridge concurrency / worker-thread redesign — TTL cache only.

## Suggested invariants (for the minted ticket)

1. Overlapping `/resident-pane` captures for the same `targetPath` within
   the TTL share one walk — they must not each start a fresh synchronous
   capture.
2. After the TTL expires (or `clearResidentPaneLiveCache`), the next
   capture performs a fresh walk.
3. The Mini App poll interval is not shorter than the capture TTL in a way
   that routinely queues overlapping sync work on the bridge event loop.
