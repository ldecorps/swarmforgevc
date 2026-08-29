# The specifier seat block is now generating false chase traffic

## What is happening

Three notes sit in `.swarmforge/handoffs/specifier/inbox/new/`. **All three are
answered.** None can be dequeued, because `ready_for_next.sh` exits 2 on
BL-1237's reference-freshness guard before dispatch ever runs.

| note | message | answered by |
|---|---|---|
| `…014516Z_003040` | BL-1237 route refused: dispatch-trail says DISPATCHED | `42ab384bc` + note to coordinator |
| `…015219Z_003046` | 4 unstamped hotfixes need review tickets | `e00132d4a` (BL-1259, BL-1260) |
| `…015733Z_000969` | BL-1238 yaml still in backlog/hold/ | `3e0304972` (BL-1261) + notes |

The chaser cannot tell "answered but undequeuable" from "ignored", so it keeps
re-firing. Chase counts are climbing: `003040` at 1, `000969` at 2. Each chase
wakes the seat, which finds no new work and can do nothing about the queue.

This is the block feeding itself: a guard that stops a seat receiving also
stops it clearing its own queue, which manufactures the evidence that the seat
is stalled.

## Correction to BL-1237's own description

The ticket says of this occurrence: *"There is no direction in which this
refusal is satisfiable and no bypass."* That is now measurably wrong, and the
implementer should know it.

    $ git rev-list --left-right --count main...origin/main
    41	47

The guard picks its comparison ref by whole-repo ahead-count
(`freshest-main-ref` in `ready_for_next.bb`), so `origin/main` wins while
origin is ahead. Sync local `main` with `origin/main` and the count flips,
the ref becomes `main`, the worktree matches it by definition, and the guard
passes.

So the refusal IS satisfiable — by exactly one action, which the refused role
is not permitted to take. That is a sharper statement of the defect than
"unsatisfiable", not a softer one: **the guard's remedy is real but belongs to
a different role.** Its own message still says "Merge main", which is not the
action that works.

## Who can clear it

All 47 commits `main` lacks are ordinary pipeline traffic authored by `t` — QA
merge-ups, documenter and hardener merges (`b6cb7a951`, `1d5874a4d`,
`a46b957d0`, …). Landing on `main` is QA's duty (Article 1.8, BL-247). The
specifier works on `main` for spec and prompt files only and explicitly not
for integration merges (`PIPELINE.md`), so this is not mine to do.

## Separate exposure, for the human

Local `main` is 41 commits AHEAD of `origin/main` and unpushed. Those include
the restored BL-1223 ticket **and the human approval that had already been
destroyed once** (`ecc82a685`), plus the BL-1259/BL-1260/BL-1261 specs. A
standing directive says do not push. That is the human's call and this file
does not argue with it — but on this repo a reset has destroyed unpushed local
commits repeatedly, and 41 commits of unpushed work is the exposure that
directive currently carries.
