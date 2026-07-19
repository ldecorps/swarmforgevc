# Checking Pipeline Board Ticket Links

Use the Telegram pipeline board's `LINKS:` section when you need to open the
backlog YAML for a ticket shown on the board. The link list covers every ticket
or intake item visible in the board message:

- active tickets in the grid;
- parked or awaiting-approval tickets;
- recently closed tickets;
- root-intake items.

The links are ordered most-recent-first by ticket number, with the highest
numbered ticket first. Intake items without a ticket number appear after
numbered tickets.

## Open The Current Backlog File

Tap a ticket in `LINKS:` to open the backlog file in GitHub. The path reflects
where that file is now:

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
