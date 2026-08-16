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
priority. Each row has **Move up**, **Move down**, **Make top**, and
**Topics** controls. When there are no paused epics, the screen shows an
empty state and no rows.

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

## Open an Epic's Topics

Tap **Topics** on an epic row to drill into that epic's own live topics —
every `backlog/paused/`, `backlog/hold/`, **and `backlog/active/`** item
carrying that epic (a `done/` child never appears), listed in the same
priority-ascending, id-ascending order as everywhere else on this screen. The
pane header stays put across the drill-down, same as the tile view. A topic
that depends on another live topic shows a small dependency marker next to
its id, so a bound or refused move is never a surprise before you tap
anything. A topic sourced from `backlog/active/` carries an **in flight**
badge next to its id — it is still an ordinary row you can reorder and tap
**Make top** on, the badge is informational only. An epic with no
reorderable topics shows its own empty state ("No reorderable topics under
this epic.") instead of a blank list.

Tap **&larr; Back** to return to the epic tiles.

Membership is resolved by the epic's `epic:` slug, not by the tile's own
ticket id — a topic declares which epic it belongs to with the slug, and two
epic tickets can (today) declare the same slug. If that happens, both
tiles' **Topics** drill-downs list the same child set, deterministically,
until the duplicate-slug ticket data itself is corrected; the screen does
not invent a tie-break. An epic tracker never appears as a topic or a
**Make top** peer in its own (or any) drill-down.

## Make a Topic Top Priority Within Its Epic

From an epic's drill-down, each topic row has its own **Make top** control —
including a row badged **in flight**. Tapping it is the same primitive as
the epic-level **Make top**, one level down: the topic is made the strict
top of *that epic's own live topics* — never the whole backlog, and never
another epic's topics.

The same rules apply, narrowed to that one epic's topic list:

- Other epics' topics, and the target topic's own epic siblings it doesn't
  depend on, keep their relative order. An in-flight sibling is an ordering
  peer like any other: making a parked topic top moves it ahead of an
  in-flight sibling ranked worse than it, the same as it would a parked one.
- A live dependency is resolved globally, not just within the epic — a
  topic in a different epic entirely can still bound or refuse the move, the
  same way an in-epic dependency would. "Live" for this purpose stays
  `backlog/paused/` and `backlog/hold/` only — a dependency that is itself
  `active` or `done` never bounds or blocks the move, even though the topic
  it names is shown, in-flight-badged, in this same drill-down.
- A broken dependency graph (a cycle, or a `depends_on` id that resolves to
  nothing) refuses the move outright, naming the offending id(s); nothing is
  written or committed.
- Re-tapping **Make top** on a topic already in the best position it's
  allowed to reach is a no-op with a stated reason.
- Applying it to a topic that doesn't actually belong to the epic you're
  viewing is refused as not-found, without writing anything — this can only
  happen if the screen's own data is stale, since the drill-down only ever
  shows a topic under its own epic.
- Tapping **Make top** on an in-flight topic is accepted like any other row:
  its `priority:` is rewritten (in its `backlog/active/` file) the same way
  a parked topic's is, but only its recorded queue order changes — the swarm
  pipeline never re-reads a promoted ticket's `priority:`, so the tap does
  not promote, demote, or otherwise touch the in-flight work itself. Making
  a parked topic top can likewise rewrite an in-flight sibling's file by
  displacement, for the same reason.

Like the epic-level move and **Make top**, a successful topic **Make top**
commits through the shared commit-integrity helper, and every refusal or
no-op shows its stated reason.

## If a Move Fails

The screen always shows the server's stated reason for a failed or refused
move — for example, if the epic was promoted out of `backlog/paused/` by the
coordinator between the last refresh and your tap, or if the write landed on
disk but the commit itself failed. A bare HTTP status code is never shown on
its own.

## Scope

The epic tiles only reorder `type: epic` tickets. Reordering one epic's own
topics is a narrower, separate action — scoped to a single epic's drill-down
(**Make top** within an epic), not a general topic reorder screen.

## Why This Screen Is Now Enough On Its Own

A move or **Make top** on this screen only ever rewrites `priority:` on the
epic tracker(s) and topics involved — it never bulk-rewrites every child
ticket under an epic. Since BL-900, that's sufficient: promotion ranking
reads a candidate's containing epic's own priority ahead of the candidate's
own `priority:`, so reordering the epic here changes real promotion order
without touching a single child ticket. See [Why Promotion Ranks by Epic
Priority Before Ticket
Priority](../explanation/BL-900-epic-priority-promotion-ranking.md) for the
ranking mechanics and its exceptions (expedited defects, queue-jump,
ambulance mode).
