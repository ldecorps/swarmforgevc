# Promotion admits a draft the ticket itself converts (BL-1340)

## The deadlock BL-626 left open

[BL-626](BL-626-promotion-gate-rejects-unmaterialized-feature-draft.md) refuses
promotion of a ticket whose `acceptance:` names a `.feature.draft` — correct
for a **parked** draft, since nothing in that ticket's own parcel will ever
materialise it. But `specifier.prompt` also mints tickets chartered to build
the very draft they point at (rename it, land its step handler, repoint
`acceptance:`, all in one parcel) — the only safe shape, since committing a
live `.feature` ahead of its handler throws the runner for every other parcel
(BL-233). BL-626's gate could not tell the two shapes apart, so a
**self-converting** draft ticket deadlocked: it cannot promote until its
draft is converted, and nothing converts the draft until the ticket promotes.
No role could clear it. 12 live tickets stranded this way, including two
`high`-severity expedited defects (BL-1309, BL-1306).

## What changed

Draft-ness policing moved from promotion time to the documenter→QA edge,
where an unexecuted contract actually becomes real:

1. **`promotion_gates_lib.bb`'s `acceptance-executable-refusal`** now admits
   a draft pointer when the ticket's own `required_wiring:` names a
   `specs/pipeline/steps` registration (`pins-draft-conversion?`) — the
   ticket saying that THIS parcel lands the handler that makes the draft
   executable. A draft with no such pin still refuses, and the refusal now
   names the distinction: *"acceptance names draft ... as parked with no
   conversion pinned, so not executable"*, not just "not executable".
2. **`promote_and_route_next.sh`'s auto-select** no longer pre-partitions
   paused candidates into buildable/other before calling
   `promotion_gates_cli.bb select`. That partition ran ahead of the one
   chokepoint that decides Article 3.2.4 expedite ordering, so a
   draft-pointer ticket silently lost its expedited place to any
   non-expedited buildable ticket. The whole eligible set now goes to
   `select` in one call; buildability can no longer outrank expedite order.
3. **`acceptance_contract_gate_lib.bb`** (the documenter→QA pre-handoff gate)
   now refuses a parcel whose ticket `acceptance:` still names a
   `.feature.draft` at the cited commit — checked *before* the existing
   `wait-bound-hit?` check, so the finding text tells the human to convert
   their draft rather than reading as a transient infrastructure timeout.
   This is the backstop that makes relaxing promotion safe: a draft that
   reaches QA unconverted is refused by name, closing the exact silence
   BL-441 and BL-626 exist to prevent.

`acceptance_pointer_gate_lib.bb` (the earlier, existence-only pre-QA hop)
still does no draft-ness policing itself — its header now says where that
policing moved to, instead of leaving it unowned.

## Pinning a self-converting draft

A ticket whose parcel converts its own `.feature.draft` needs a
`required_wiring:` entry naming the `specs/pipeline/steps` file the handler
will register in:

```yaml
required_wiring:
  - "specs/pipeline/steps/myTicketSteps.js::registerMyTicketSteps"
```

This is the same field the pre-QA gate already reads to prove production
wiring (`swarmforge/backlog-schema.md`); BL-1340 gives it a second reader —
`promotion_gates_lib.bb`'s `pins-draft-conversion?` — at promotion time. An
unrelated `required_wiring` entry (not naming `specs/pipeline/steps`) does not
count as a pin; an empty `required_wiring:` block does not count either.

## Operator note

```bash
# List every dangling/draft acceptance pointer, read-only:
bb swarmforge/scripts/promotion_gates_cli.bb audit-acceptance <project-root>

# Check one paused ticket against the chokepoint directly:
bb swarmforge/scripts/promotion_gates_cli.bb evaluate <root> <ticket.yaml> false <depth>
```

A ticket still refused after adding the pin means the entry doesn't parse as
naming `specs/pipeline/steps` — check indentation and the block boundary.

Acceptance:
`specs/features/BL-626-promotion-gate-rejects-unmaterialized-feature-draft.feature`
(BL-1340 lands its four new scenarios into BL-626's feature file per the
BL-1251 pattern and retires BL-626's own example row asserting every draft is
refused — see `retires:` on the BL-1340 ticket).

Diagram: `docs/diagrams/swarm-flow.mmd`.

See also: [BL-626](BL-626-promotion-gate-rejects-unmaterialized-feature-draft.md),
[BL-1027](BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.md).
