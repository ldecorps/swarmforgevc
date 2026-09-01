# BL-1316 documenter pass — 20260901

Reviewed the hardener commit (76ea644cdc) against BL-1316's acceptance
criteria and the ticket's `required_wiring` anchors.

## Checklist

- Read the ticket YAML (`backlog/active/BL-1316-claim-time-effort-follows-ticket-difficulty.yaml`)
  and the feature file to confirm scope: claim-time reasoning-effort retune
  from a ticket's `mutation_cost`, on backends with an effort lever only.
- Read the coder commit (cbf9042674) implementing
  `seat_difficulty_lib.bb::effort-for-mutation-cost`/`claim-effort-decision`,
  `handoff_lib.bb::apply-claim-effort!`, and the `ready_for_next_task.bb`
  wiring at both the fresh-claim and reclaim call sites.
- No user-visible command or setting is introduced — this is internal
  claim-time seat behavior, matching BL-1001/BL-236's existing doc pattern
  (a how-to under `docs/how-to/`, not a tutorial or an explanation doc).
- Checked whether any registered diagram (`docs/diagrams/architecture.mmd`,
  `swarm-flow.mmd`, `handoff-flow.mmd`, `front-desk-flow.mmd`) depicts the
  claim-time effort mechanism or the claim state machine this ticket
  touches: it does not add a new claim state, gate, or pipeline topology
  change — no diagram change-trigger fired.

## Doc changes made

- New how-to: `docs/how-to/BL-1316-claim-time-effort-follows-ticket-difficulty.md`,
  modeled on the existing `BL-1001-difficulty-aware-coder-seat-routing.md`
  doc, describing the pure decision, the IO edge, and the two wiring call
  sites, plus the operator-facing note that only `claude`-backed seats have
  a lever today.
- Linked the new how-to from `docs/index.md` next to the other BL-1001-family
  entries (BL-1001, BL-1185, BL-1167).
- Added a paragraph to `docs/reference/Specification.MD`'s existing Effort
  dial section describing the claim-time retune, and bumped the file's
  "Last Updated" line in the same commit as the content change.

## Findings

NONE. Doc scope was clear from the ticket and the commit; no gate defect
found in documenter's domain for this pass.
