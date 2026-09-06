# BL-940 — coder spec-gap finding, 2026-09-06

**Status: parcel held, uncommitted. Not forwarded. Needs specifier
adjudication before I proceed.**

## The ticket's own premise

BL-940's `description:` says: "`asOf` from BL-670's derivation is the
input for the elapsed time; do not re-derive it" — i.e. BL-670 already
delivers a per-ticket `asOf` (and, per its own title, a health dot) that
the board can read, and BL-940's job is only to render an elapsed-time
mark from it plus a below-grid legend line with two deep-links. `notes:`
states "All three [BL-585, BL-670, BL-940] touch
`extension/src/concierge/pipelineBoard.ts`, so they run in sequence."

## What I actually found in the live tree

- `git log -- extension/src/concierge/pipelineBoard.ts` shows **no
  BL-670-tagged commit at all**.
- `grep -rl "healthDot\|TicketStageEntry" extension/src/` returns
  **exactly one file**: `extension/src/swarm/swarmState.ts` — where
  BL-670 actually landed. `TicketStageEntry` (`{stage, status, asOf,
  healthDot}`), `TicketHealthDot`, and the bb-mirrored status constants
  are defined and normalised there (`normaliseTicketStageEntry`,
  `stageOfSeat`), but **nothing outside that one file reads
  `asOf` or `healthDot`** — not `pipelineBoard.ts`, not
  `conciergeTick.ts`, not any other renderer under `extension/src/`.
- `pipelineBoard.ts`'s only BL-670 import is `stageOfSeat` (the bare
  role/seat-string normaliser) — it never sees `asOf` or `healthDot`.
- `computePipelineBoard`'s actual first argument, `roleHeldTickets`, is
  typed `Record<string, string[]>` (role → ticket ids) both in
  `pipelineBoard.ts` and in `conciergeTick.ts`'s own
  `readRoleHeldTickets` adapter type — a shape that **cannot carry**
  `asOf`/`healthDot` even if the caller wanted to pass them. The real
  adapter implementation (outside this file, wired at extension
  activation) would also need widening.

## Why this is not "BL-940's own job to just wire the read"

The ticket's own scope (`mutation_cost: medium`, `qa_e2e_procedure`
already assuming BL-585 and BL-670 render the matrix/health dot, and
`description:`'s "do not re-derive it") is written on the premise that
the `asOf` plumbing already reaches the board and only the ELAPSED-TIME
RENDERING is missing. What I found instead is that the plumbing itself —
threading `TicketStageEntry` (or at minimum its `asOf`/`healthDot`
fields) from the stage-map reader, through `conciergeTick.ts`'s adapter
contract, into `computePipelineBoard`'s row-building — does not exist
anywhere. Building that is a materially different, larger slice than
"render a value beside the existing mark using an already-available
field," and touches a caller contract (`readRoleHeldTickets`'s own type)
this ticket's own text never names as in scope.

I also could not find any live rendering of BL-670's health dot itself,
anywhere in the tree — the ticket's own framing ("BL-670 = semantics +
health dots only") reads as though the dot already appears on the board
today; it does not appear to yet, on the evidence above.

## What I have NOT done

- Not implemented the legend line, the elapsed-time mark, or the
  plumbing to reach `asOf`.
- Not touched `pipelineBoard.ts`, `conciergeTick.ts`, or `swarmState.ts`.
- Not assumed a design for the missing plumbing — that decision (thread
  the full `TicketStageEntry` through, or just `asOf`; where the health
  dot itself should actually render, if it does not yet anywhere) is a
  scope call, not an implementation detail I should guess at.

## Asking the specifier to adjudicate

1. Confirm/re-verify against the live tree (independently of my own
   read) whether `asOf`/health-dot plumbing genuinely does not yet reach
   the board anywhere.
2. If confirmed: is the missing plumbing folded into BL-940 (widening
   its own scope/mutation_cost), split into its own ticket BL-940
   depends on, or is BL-670 itself considered incomplete and reopened?
3. Either way, BL-940's own `description:`/`qa_e2e_procedure:` premise
   ("BL-670 already gives you `asOf`", "BL-585/BL-670 already render the
   matrix/health dot") needs amending to match whichever of the above is
   chosen, so a later reader is not misled the same way.

Holding the parcel until I hear back.
