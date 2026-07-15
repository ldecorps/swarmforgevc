# Intake: extension shows a resolved specifier decision as if still live/pending

Filed by the coordinator (2026-07-15T12:47 BST) — the human screenshotted the
SwarmForge extension's Specifier tile showing an interactive multi-choice
prompt: "Disk-space low alert ... It also surfaced a /tmp leak ... How should
I split this into tickets?" with options (1. Two tickets [Recommended], 2. One
combined ticket, 3. Alert only defer cleanup, 4. Type something), option 1
highlighted, plus "RECENT RUNS: run-20260715-1128, run-20260715-0955" and a
"5. Chat about this" option. The human's own read: "that is not reflected in
the specifier[']s [state]" — i.e. it looks live/actionable but isn't. This is
a RAW ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## Verified against the actual live state

- The specifier's real tmux pane (`swarmforge-specifier`) right now shows a
  bare, empty, cleared prompt — `/clear` was genuinely submitted (confirmed
  via escape-code inspection: rendered as committed history `38;5;231m` on
  `48;5;237m`, not a dim ghost suggestion), no live spinner, no role-loop
  output underneath. Both `-S` (scrollback) and no-`-S` (true visible frame)
  captures show the same thing, ruling out the "stale scrollback below a
  live session" near-miss.
- The specifier's mailbox is fully drained: `inbox/new/` and
  `inbox/in_process/` both empty.
- The decision the tile is asking about is ALREADY RESOLVED and has been for
  some time: `backlog/paused/BL-412-disk-space-early-warning-alert.yaml`
  (the Telegram alert) and `backlog/paused/BL-413-stale-sandbox-sweep.yaml`
  (the /tmp sandbox cleanup) both exist as fully-written, complete specs —
  exactly matching the tile's "Option 1: Two tickets" split (Ticket A = the
  alert, Ticket B = the companion cleanup). The specifier has since drained
  four MORE rounds of intake past this point (BL-414/415, BL-416/417/418,
  BL-419, BL-420).

So the tile is displaying a moment from well before the current live state —
not a live blocking question the human still needs to answer. A human who
trusts the tile and picks an option now would be answering a question nobody
is listening for.

## Suspected shape

Whatever renders this decision tile/run-view in the extension host appears to
not refresh against the pane's current actual state, or is showing a cached
"recent run" transcript (see the "RECENT RUNS" list in the screenshot) in a
way indistinguishable from a live, actionable prompt. A human cannot tell,
from the tile alone, whether a shown question is still live or long since
resolved — which is exactly the ambiguity the human hit here.

## Scope note

This is a product bug in the SwarmForge VC extension's tile/run-history
rendering, not a swarm-process (meta) issue — the coordinator is not the
target of the fix and does not apply it to itself.
