# Checking Pipeline Board Ticket Links

Tap a ticket **number** on the Telegram pipeline board (PARKED / AWAITING
APPROVAL / ROOT INTAKE / RECENTLY CLOSED, or the compact grid-ticket line
under the status grid) to open that ticket's backlog YAML on GitHub.

There is no separate `LINKS:` footer — Telegram cannot put tappable anchors
inside the monospace `<pre>` status grid, so list (and grid-only) ticket
numbers are HTML links placed after that `<pre>` block.

The board covers every ticket or intake item visible in the message:

- active tickets in the grid (linked just under the grid when they have a path);
- parked or awaiting-approval tickets;
- recently closed tickets;
- root-intake items.

When the message would exceed Telegram's length budget, the oldest ticket
anchors are dropped first (numbers stay visible as plain text).

## Open The Current Backlog File

Each linked number opens the backlog file in GitHub. The path reflects where
that file is now:

- active tickets link under `backlog/active/`;
- paused or parked tickets link under `backlog/paused/`;
- closed tickets link under `backlog/done/`;
- root-intake items link directly under `backlog/`.

If a stale duplicate exists during a promotion or close, the board prefers the
authoritative folder: `active` before `paused`, and `paused` before `done`.

## Refresh After A Move

The board re-posts when a shown ticket's link path changes, even if the visible
grid and list text did not otherwise change. If a link still points at an old
folder, wait for the next operator tick and check the newly posted board message
rather than following the stale pinned message.
