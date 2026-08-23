# Checking Pipeline Board Ticket Links

Tap a ticket **number** on the Telegram pipeline board (PARKED / AWAITING
APPROVAL / ROOT INTAKE / RECENTLY CLOSED / HELD, or the compact grid-ticket
line under the status grid) to open that ticket's backlog YAML on GitHub.

There is no separate `LINKS:` footer — Telegram cannot put tappable anchors
inside the monospace `<pre>` status grid, so list (and grid-only) ticket
numbers are HTML links placed after that `<pre>` block.

The board covers every ticket or intake item visible in the message:

- active tickets in the grid (linked just under the grid when they have a path);
- parked or awaiting-approval tickets;
- recently closed tickets;
- root-intake items;
- **held tickets** (`backlog/hold/`) — their own `HELD:` section, never a
  role column and never the not-started column, since no role holds them
  (BL-1045). Each entry shows how long it has been held, longest-held first,
  derived from the git commit that added the file at its `hold/` path —
  never file mtime, which a clone/checkout/worktree operation can silently
  reset. An unresolvable date reads as "age unknown" rather than as a
  guessed "just now". The section is capped at
  `PIPELINE_BOARD_HELD_MAX` (8) and states `+N more held` rather than
  silently dropping the newest-held tail; an empty `hold/` renders no
  section at all, byte-identical to a board built before BL-1045.

When the message would exceed Telegram's length budget, the oldest ticket
anchors are dropped first (numbers stay visible as plain text).

## Why A Ticket You Expect Has No Link

The board is capped section by section, and each cap says what it dropped
rather than hiding it:

- the grid drops its tail rows past the row budget and prints
  `+N more active` (those tickets are still linked below the grid);
- PARKED lists at most 3 plain parked tickets, then `+N more parked`;
- PARKED lists at most 3 collapsed epic trackers, then `+N more epics`;
- HELD lists at most 8 tickets (`PIPELINE_BOARD_HELD_MAX`), ordered
  longest-held first so the cap can only ever drop the newest, then
  `+N more held`;
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
- held tickets link under `backlog/hold/`;
- closed tickets link under `backlog/done/`;
- root-intake items link directly under `backlog/`.

If a stale duplicate exists during a promotion or close, the board prefers the
authoritative folder: `active` before `paused`, and `paused` before `done`.

## Refresh After A Move

The board re-posts when a shown ticket's link path changes, even if the visible
grid and list text did not otherwise change. If a link still points at an old
folder, wait for the next operator tick and check the newly posted board message
rather than following the stale pinned message.
