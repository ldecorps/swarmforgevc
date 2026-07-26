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
priority. Each row has **Move up**, **Move down**, and **Make top**
controls. When there are no paused epics, the screen shows an empty state
and no rows.

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

## Make an Epic Top Priority

Tap **Make top** on a row to jump that epic straight to the front of the
whole live backlog in one step, instead of tapping **Move up** repeatedly.
"Live" here means every `backlog/paused/` and `backlog/hold/` item, epics
and topics together — not just the epics shown on this screen — so **Make
top** always produces a genuine, unique top, never a tie with a topic the
screen isn't displaying.

**Make top** is never disabled for being "already first" the way **Move
up** is — the epic list's own position doesn't tell you whether the epic is
already the live top, so the button is always tappable and the server
answers with a no-op reason when nothing needed to change.

A few things shape what actually happens when you tap it:

- Epics and topics the mover **doesn't** depend on, ranked worse than it,
  keep their relative order — the tie-run shifts to make room, it doesn't
  shuffle unrelated items past each other.
- If the epic **depends on** another live item that already ranks better
  than it, the move is bounded rather than refused: the epic lands
  immediately after that dependency instead of ahead of it, and the shown
  reason names which dependency did the bounding.
- If the dependency graph itself is broken — a cycle back to the epic
  itself, or a `depends_on` id that doesn't resolve to any backlog item — the
  move is refused outright, and the reason names the offending id(s). Nothing
  is written or committed in that case.
- A dependency that is already `active` or `done` never bounds or blocks the
  move; only a live (paused/hold) dependency can.
- Re-tapping **Make top** on an epic that's already at the best position it
  is allowed to reach is a no-op with a stated reason — same as a boundary
  **Move up**/**Move down**, nothing is written or committed.

Like a move, a successful **Make top** commits through the same
commit-integrity helper as every other write on this screen, and a refusal
or no-op always shows its reason rather than a bare status code.

## If a Move Fails

The screen always shows the server's stated reason for a failed or refused
move — for example, if the epic was promoted out of `backlog/paused/` by the
coordinator between the last refresh and your tap, or if the write landed on
disk but the commit itself failed. A bare HTTP status code is never shown on
its own.

## Scope

The screen only reorders `type: epic` tickets. Reordering an epic's own
child slices is a separate concern and is not part of this screen.
