# Claim-time reasoning effort follows the claimed ticket's difficulty (BL-1316)

## The gap

BL-1001 picks WHICH seat may claim a ticket by `mutation_cost` against the
seat's declared `--seat-tier`. BL-236's Suggest tier sets a static per-ROLE
effort at swarm start. Neither retunes HOW HARD a seat thinks once it has a
specific ticket in hand — on a Composer/Haiku-everywhere pack, every ticket
burns the same reasoning budget regardless of difficulty.

## What changed

At claim time (a freshly dequeued parcel) and at reclaim time (an
in-process parcel resumed after a restart), the seat's reasoning effort is
retuned from the claimed ticket's `mutation_cost`:

1. Pure decision — `seat_difficulty_lib.bb`:
   - `effort-for-mutation-cost` maps a ticket's `mutation_cost` directly to
     an effort token (`low`/`medium`/`high`, same scale on both sides —
     crank for high, shrink for low).
   - `claim-effort-decision` reads only `backend`, the claimed ticket's
     `mutation_cost`, and the pack/window's declared `--effort` default —
     never seat name, idle time, or any other schema field. `mutation_cost`
     present → its mapped effort; absent → the pack/window default, so a
     prior claim's effort never rides unchanged into the next one. A
     backend outside `effort-lever-backends` (currently `#{"claude"}`)
     always decides `:apply? false` — no unsupported flag is ever invented
     for Cursor/Copilot-style backends without a lever.
2. IO edge — `handoff_lib.bb`'s `apply-claim-effort!` applies the decision
   by rewriting the seat's launch-time settings file
   (`.swarmforge/launch/<role>.claude-settings.json`, the same file
   `write_claude_settings_file` wrote at launch) in place, setting
   `effortLevel`. It never throws and never blocks a claim: a backend with
   no lever, a missing settings file, or unreadable/unwritable JSON all
   leave the claim to succeed with nothing written.
3. Wiring — `ready_for_next_task.bb`'s `apply-effort-for-task!` calls the
   above at both `-main` call sites that already exist for a fresh claim
   and a resumed in-process parcel, reading the ticket's `mutation_cost`
   from its active-backlog YAML.

## Operator note

No new configuration. A pack window's existing `--effort` value is now also
the *default* a seat restores to whenever it claims a ticket with no
`mutation_cost` field — declare it there, not anywhere else. Nothing infers
effort from seat name or model string; only `mutation_cost` and the
window's own `--effort`/`--model` are read.

Only Claude-backed seats have a lever today (`effort-lever-backends`).
Cursor effort-bearing model ids and a Copilot equivalent are explicitly
deferred to a later ticket, not invented here.

Orthogonal to BL-1001 (which seat may claim) and BL-236 (the static per-role
Suggest dial, still the source of the pack/window default this ticket reads
and restores to).

Acceptance:
`specs/features/BL-1316-claim-time-effort-follows-ticket-difficulty.feature`

Related: [Difficulty-aware coder seat routing](BL-1001-difficulty-aware-coder-seat-routing.md).
