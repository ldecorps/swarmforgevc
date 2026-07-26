# Reordering Epic Priority in the Mini App Console

Use the epic reorder screen when you want to change which epic the swarm
should work next, without hand-editing `priority:` in a backlog YAML file and
committing it yourself. It is part of the Telegram Mini App console and runs
on the existing bridge host.

## Open the Screen

Open the allowlisted SwarmForge console Mini App and choose **Reorder
epics**. The console links to `/epic-reorder` on the bridge server. The HTML
shell is publicly reachable like the other Mini App shells, but the list
feed and the move route require the console token.

The screen lists every `backlog/paused/` ticket of `type: epic`, ordered by
`priority:` ascending, one row per epic with its id, title, and current
priority. Each row has **Move up** and **Move down** controls. When there are
no paused epics, the screen shows an empty state and no rows.

## Move an Epic

Tap **Move up** or **Move down** on a row. Moving the first epic up, or the
last epic down, is a no-op — the screen states why nothing changed rather
than silently refreshing an unchanged list.

Everywhere else, a move changes the epic's position by exactly one:

- If the mover and its neighbor have different priority values, the move
  swaps the two values — only those two epics' backlog YAML files change.
- If several adjacent epics are tied on the same priority (as can happen
  today, since new epics default to the same low value), a plain swap has no
  solution, so the move instead rewrites priorities positionally: it may
  touch epics at or after the moved pair, but never an epic listed above the
  pair, and never writes a negative priority.

Either way, the write is committed the same way the paused-ticket pager's
Expedite control commits — through the shared commit-integrity helper, never
a bare `git commit` from the bridge server — so the change lands on `main`
durably, not just on disk.

## If a Move Fails

The screen always shows the server's stated reason for a failed or refused
move — for example, if the epic was promoted out of `backlog/paused/` by the
coordinator between the last refresh and your tap, or if the write landed on
disk but the commit itself failed. A bare HTTP status code is never shown on
its own.

## Scope

The screen only reorders `type: epic` tickets. Reordering an epic's own
child slices is a separate concern and is not part of this screen.
