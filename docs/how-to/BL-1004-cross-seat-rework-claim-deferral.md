# BL-1004: Cross-seat rework claim deferral

BL-983 gave a multi-seat stage one addressable mailbox queue and let
whichever seat polls first claim from it — correct for fresh work, but a
hazard for a **rework**. Seats of the same stage do not share a worktree
(`coder` on `swarm/coder` in `.worktrees/coder`, `coder@sonnet2` on
`primary/coder-sonnet2` in `.worktrees/coder-sonnet2`), so a bounce addressed
to the stage could land on a seat holding none of the parcel's history.
Measured live on BL-994: a bounce addressed to `coder` was claimed by seat
`coder`, which wrote its fix on a tree that did not contain the build seat
`coder@sonnet2` had produced. The forward's own lineage was sound and the
delivered work was correct, but nothing had guaranteed that — two hazards
(a silent-drop merge, a blind-green verification) were live for the whole
window.

BL-1004 closes the gap at the claim: a seat about to claim a `git_handoff`
whose task a **sibling** seat has already worked defers it, leaving it in
the stage queue for that seat, until a bounded deadline passes.

## The decision, in one place

`seat_affinity_lib.bb`'s `rework-claim-decision` is the single pure
decision, called from `ready_for_next_task.bb`'s claim path — inside the
mailbox layer, so seat identity never escapes it (BL-983's own invariant,
preserved). For each stage-queue candidate:

| Condition | Outcome |
|---|---|
| Not a `git_handoff`, or the task carries no seat history at all | `:claim` — not a rework, claim normally |
| The claiming seat itself worked this task | `:claim` — self-affinity wins over sibling-affinity |
| A sibling seat worked this task, and it's within the deadline | `:defer` — leave it in the queue for that seat |
| A sibling seat worked this task, but the deadline has passed (or the parcel's age can't be read at all) | `:claim-cross-seat` — claim anyway, and say so out loud |

"Worked" means present in that seat's `completed/` or `in_process/`
mailbox — no new state, just the durable record BL-983 already left behind.
Age is read from the parcel's `enqueued_at` header (falling back to
`created_at`), never file mtime, matching every other staleness check in
this pipeline.

## The deadline is bounded, deliberately

A deferred parcel does not wait forever. `cross_seat_claim_deadline_ms`
(`swarmforge.conf`, default 1,800,000 — thirty minutes, in
`seat-affinity-lib/default-cross-seat-claim-deadline-ms`) bounds the wait:
long enough for a busy sibling seat to finish its turn and poll, short
enough that a seat which never returns cannot strand a rework for a whole
shift. An absent, malformed, zero, or negative value all degrade to the
default — a zero/negative deadline would disable deferral outright and
reinstate the BL-994 hazard.

Past the deadline, or when the parcel's age can't be parsed at all, any
seat may claim it. The claim is not silent: `ready_for_next.sh` prints a
`CROSS_SEAT_CLAIM` line naming the task and telling the seat it did not
build this parcel, so the seat knows to merge the parcel commit **first**
(per the constitution's "Forwarded Commits Carry Their Lineage") before
working it.

## Single-seat stages are untouched

The deferral path needs a seat that worked the task and a sibling that did
not. A single-seat stage has no sibling — the sibling task set is always
empty, so every decision is `:claim` and the seat's own mailboxes are never
even consulted. This is structural, not a special case: the seven
single-seat stages behave exactly as they did before this ticket.

## The stall sweeps know about the wait

A parcel sitting in a stage queue mid-deferral looks, from the outside,
exactly like a stuck parcel — and the deferral window (30 minutes) is twice
the flow watchdog's default warn threshold (15 minutes), so without an
exemption every deferred rework would trip a false stuck-parcel alarm partway
through its own designed wait.

`flow_watchdog_lib.bb` and `chase_sweep_lib.bb` both consult
`seat_affinity_lib.bb`'s `deferral-hold?` — the *same* decision library the
claim path itself uses, never a second copy — alongside the existing
ambulance hold. A parcel inside its deferral window is held like an
ambulance hold (no alarm); the moment the window expires or no seat affinity
exists, alarms resume normally. The check applies to `:new`-mailbox parcels
only — an `in_process` parcel is already claimed, so it is past deferral and
a stall there is real.

## Seat identity stays inside the mailbox layer

BL-983's invariant is unchanged: no downstream role, board, or metric ever
learns which seat did the work. The diagnostic lines
(`seat_affinity_lib.bb`'s `deferral-line` / `cross-seat-claim-line`) name the
task and the fact of a cross-seat claim, never a seat id — verified
generatively by the property runner sweeping adversarial seat ids through
both render functions.

## Verify

```bash
bb swarmforge/scripts/test/seat_affinity_lib_test_runner.bb
bb swarmforge/scripts/test/bl1004_seat_affinity_property_runner.bb
bb swarmforge/scripts/test/flow_watchdog_test_runner.bb
bash swarmforge/scripts/test/test_chase_sweep.sh
node specs/pipeline/cli.js specs/features/BL-1004-a-rework-is-claimed-only-by-a-seat-that-can-work-it-safely.feature
```

## What this does not do

- It does not change the pipeline order, a forward's addressing (parcels
  stay STAGE-addressed), or the one-queue-per-stage layout — the decision
  lives entirely at the claim.
- It does not implement BL-1001's difficulty-aware routing (which seat gets
  *fresh* work first); this only decides who may claim a rework of a parcel
  that already exists. The two are orthogonal and land independently.
- It does not wire the batch claim path (`ready_for_next_batch.bb`) — no
  multi-seat batch stage exists yet to protect.

See also: [SwarmForge VS Code Extension — Specification](../reference/Specification.MD)
for the BL-1004 changelog entry, and the constitution's "Forwarded Commits
Carry Their Lineage" rule this deadline's cross-seat claim line points back
to.
