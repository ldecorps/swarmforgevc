# How to add or remove a seat of a bottleneck stage

You have been handed a named bottleneck — the optimizer's stage-dwell report
says one stage is where parcels queue. This page is the operator step for
acting on that: how to give the stage a second seat, which model tier to give
it, and how to take it away again.

It does **not** cover how work is then split between the seats. That is
[BL-1001's page](BL-1001-difficulty-aware-coder-seat-routing.md), and it has
shipped — read it once, then come back here for the mechanics.

Every command and `window` line below is exercised against a real pack parse by
`specs/features/BL-1320-operator-step-for-adding-a-seat-to-a-bottleneck-stage.feature`,
so if the parser's grammar moves and this page does not, the suite goes red
rather than the page going quietly wrong.

## Add a second seat

A seat is one `window` line in the pack conf (`swarmforge/packs/<pack>.conf`).
An extra seat of a stage is named `<stage>@<seat>`; the `@` separates the stage
from the seat id.

Start from the stage's existing line — the **bare** one, whose id is just the
stage name:

```
window coder claude coder --model claude-opus-5 --seat-tier hard
```

Add a second line beside it, with its own seat id, its own worktree, its own
model, and its own tier:

```
window coder@seat2 claude coder-seat2 --model claude-sonnet-5 --seat-tier easy
```

Field by field, in order:

| Field | Value above | What it is |
|---|---|---|
| 1 | `window` | the directive |
| 2 | `coder@seat2` | the seat id: `<stage>@<seat>`, exactly one `@`, both halves non-empty |
| 3 | `claude` | the backend |
| 4 | `coder-seat2` | the worktree this seat works in |
| 5+ | `--model …` `--seat-tier …` | this seat's own model and tier |

Then restart the swarm so the pack is re-read (`./swarm` kills and relaunches).

## The constraint a second seat cannot violate

**A stage that declares any `<stage>@<seat>` must also keep its bare
stage-named seat.** Parcels are addressed to the *stage*, and a stage-addressed
lookup resolves the seat whose id IS the stage name, so a stage with only
`@`-seats would resolve no row at all for its own parcels.

Delete the bare `window coder …` line while `window coder@seat2 …` is still
there and the launch refuses, by name:

```
Stage 'coder' declares additional seat 'coder@seat2' but no bare 'coder' seat
in <conf> - the stage-named seat must exist because parcels address the stage
```

That refusal is a guard, not a puzzle: put the bare line back.

## Remove the seat again

Delete the `window <stage>@<seat> …` line. Nothing else changes — the bare seat
stays exactly as it was, and the stage returns to one seat on the next launch.
Remove the extra seat's line, never the bare one.

## Drop a seat mid-shift, without restarting the swarm (BL-1720)

The steps above change the pack **conf**, which is only re-read on the next
`./swarm` (kill and relaunch). If you want a seat gone from the *running*
swarm right now — no restart — killing its tmux session is not enough by
itself: `babysitterd`'s repair sweep reads `.swarmforge/roles.tsv` (written
once at launch, never the pack conf) and resurrects a killed session within
minutes, and every worktree still carries its own launch-time copy of
`roles.tsv`, so other roles keep addressing parcels — including reverse-hop
copies — to the now-gone seat (2026-09-24: exactly this stranded three
`BL-1703` copies in a dropped `coder@2`'s inbox, and each wake for it landed
in another role's pane).

Use `swarmforge/scripts/retire_seat.sh <project-root> <seat>` instead of
killing the session by hand. One operation, in order:

1. Refuses (usage message, exit 1, no file touched) with the wrong argument
   count, or naming an unknown seat.
2. Rewrites the master `roles.tsv`, then `sessions.tsv`, then **every**
   worktree's own `roles.tsv` copy — including the retired seat's own — so
   no roster copy the swarm reads lists it any more.
3. Only then kills the seat's tmux session — after every roster copy has
   already lost the row, so the babysitter's repair sweep never observes
   "missing session, but the roster still lists it" mid-operation.
4. Prints every parcel still sitting in the retired seat's own mailbox
   (`inbox/new/` and `inbox/in_process/`) — it never moves or deletes them;
   deciding what happens to a stranded parcel is yours.

The seat's worktree, branch, and mailbox files are left in place — only its
roster rows and its live session go. **Not built yet:** the inverse
(re-adding a retired seat mid-shift, without a full relaunch) — until it
exists, bringing a seat back is the normal next-launch path above.

## Which model tier to add

The tier you add depends on WHAT the constraint is, not on how busy the stage
looks:

| The stage is bottlenecked by | Add a seat at | Why |
|---|---|---|
| volume of ordinary, low-cost tickets | `--seat-tier easy`, a cheaper/faster model | The hard seat stops being the queue for work that never needed it; easy work may still spill up to the hard seat when the easy one is busy. |
| capacity at a HIGH difficulty band — hard tickets waiting behind hard tickets | `--seat-tier hard`, a model of at least the same capability as the existing seat | Above-tier work never lands on a lower-tier seat, however idle that seat is: the ticket waits instead. A cheap second seat adds nothing to a hard-band queue. |
| mixed, and you are unsure | `--seat-tier hard` | It is the safe direction: a hard seat accepts `low`, `medium` and `high`, so it can never strand work. An easy seat accepts `low` only. |

To choose the actual model for the seat, ask the steward which models are
ranked for that role:

```
bb swarmforge/scripts/model_steward_cli.bb role-matrix coder
```

It prints one ranked line per model — `provider/model score evidence` — highest
first. Add `--include-uncertified` to see models that have not been certified
for the role yet; prefer a certified one for a seat you intend to leave running.

## After the change

Work splits between the seats by ticket difficulty, which is BL-1001's
mechanism, not this page's — read
[BL-1001-difficulty-aware-coder-seat-routing.md](BL-1001-difficulty-aware-coder-seat-routing.md)
for what lands where, and note its rule that on a stage with **any** declared
`--seat-tier`, an undeclared seat of that stage does not claim at all.
