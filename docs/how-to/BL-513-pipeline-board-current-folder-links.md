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

## Why A Ticket You Expect Has No Link

The board is capped section by section, and each cap says what it dropped
rather than hiding it:

- the grid drops its tail columns past the width budget and prints
  `+N more active` (those tickets are still linked below the grid);
- PARKED lists at most 3 plain parked tickets, then `+N more parked`;
- PARKED lists at most 3 collapsed epic trackers, then `+N more epics`;
- tickets awaiting approval are never capped.

A ticket behind one of those `+N more` lines is not on the message at all,
so it has no number to tap — unlike the length-budget case above, where the
number is still there and only its anchor is gone. Open `backlog/paused/`
on GitHub directly, or use the console's epic list, to reach it.

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
