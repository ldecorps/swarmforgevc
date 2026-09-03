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
