# Bubble Host thinking page on phone (BL-834)

*How-to. Task-oriented: open **Host** from the expanded Bubble pager and watch
the host agent's activity lines arrive live — the phone equivalent of staring at
a tmux pane while Cursor works.*

Remote HTML in the BL-829 ui-bundle family. The page **reads** the BL-833
activity feed; it never steers, interrupts, or mutates the host session.

## What you get

1. Expand Bubble → open **Host** (manifest page `host`, order 5 — after Health).
2. On open: catch-up from `GET /host-activity`, then live lines via SSE
   `hostActivityStream` on `/events`.
3. Scrollable session history; jump-to-newest when scrolled back.
4. Three honest states: **working** (lines arriving), **quiet** (no session —
   not a spinner), **unreachable** (feed unreadable — named reason).

## Constraints

| Rule | Detail |
| --- | --- |
| Watch-only | Opening/scrolling/closing never affects the host turn |
| Feed fidelity | Shows only lines the feed holds — no synthesis |
| State honesty | Quiet ≠ unreachable ≠ perpetual loading |
| Auth | Valid bridge token required |

## Where it lives

| Piece | Location |
| --- | --- |
| Pager entry | `letsTalkRoutes.ts` → `bubbleHostPage` |
| State/render helpers | `bubbleHostCore.ts` |
| HTML shell | `bubbleHostUiHtml.ts` |
| Feed source | BL-833 `hostActivityFeed.ts` |
| Catch-up | `/host-activity` |
| Live push | `/events` (`event: host-activity`) |
| Mini App shell | `/host` |

## Verify

```bash
cd extension && npm test -- bl834BubbleHostInvariants
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-834-bubble-host-thinking-page.feature
```

Manual once on device: expanded Bubble → Host → lines appear during an active
host turn; quiet state when idle; reconnect after leaving and returning.

Related: [Host-agent activity feed](BL-833-host-agent-activity-feed.md),
[Bubble remote page pager](BL-829-bubble-remote-page-pager.md).
