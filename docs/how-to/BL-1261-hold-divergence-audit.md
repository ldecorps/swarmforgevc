# Hold divergence audit (BL-1261)

*How-to. Task-oriented: detect when a ticket's YAML is in `backlog/hold/` but
its parcel is still being built in a role worktree — the expedite park defect.*

## What was happening

The expeditor parks every OTHER `active/` ticket into `hold/` at initiation
(only the expedited ticket stays in `active/`). Article 3.1 forbids
auto-promotion out of `hold/` — only a human may move a ticket out.

The defect: the park moves the ticket's YAML into `hold/` but not its parcel.
Five tickets were being built and gated right now while their backlog record
said nobody may touch them. The YAML and the parcel had diverged.

Verified live 2026-08-29: five tickets in `hold/` had active parcels in role
worktrees, with no signal and no available action. The only way to detect it
was by hand: `ls backlog/hold/` and compare against each role's
`.swarmforge/handoffs/inbox/`.

## What it guarantees now

`promote_and_route_next.sh` (the same site BL-1228's pool audit runs) now
runs a hold divergence audit before promotion. The audit:

1. Discovers every parcel in every role's mailbox (including batch roles'
   `batch_*` subdirectories, one level deep)
2. For each parcel, finds the corresponding ticket YAML
3. Reports tickets where the YAML is in `hold/` but the parcel exists in a
   role's mailbox

The audit **reports only**. It never moves, promotes, or deletes a ticket in
any pool, or removes a parcel from any mailbox. A divergence is surfaced to
the coordinator and the human; resolution is a human decision (Article 3.1).

The audit fails closed: a mailbox or backlog directory it cannot read is
reported as unresolved, never silently omitted from the report.

## Where it lives

| Piece | Location |
| --- | --- |
| Audit lib (pure) | `swarmforge/scripts/hold_divergence_audit_lib.bb` |
| Audit CLI | `swarmforge/scripts/hold_divergence_audit_cli.bb` |
| Call site | `swarmforge/scripts/promote_and_route_next.sh` (after BL-1228 pool audit) |
| Property tests | `extension/test/bl1261HoldDivergenceAudit.property.test.js` |
| Acceptance | `specs/features/BL-1261-hold-divergence-audit.feature` |
| Acceptance steps | `specs/pipeline/steps/bl1261HoldDivergenceAuditSteps.js` |

## Verify

```bash
# Run the audit by hand (backlog root is a required positional argument —
# an empty arg list is treated as a help request and exits 0 without auditing)
bb swarmforge/scripts/hold_divergence_audit_cli.bb .

# Run property tests (own lane — the default vitest config excludes *.property.test.js)
cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1261HoldDivergenceAudit.property.test.js

# Run acceptance
node specs/pipeline/cli.js specs/features/BL-1261-hold-divergence-audit.feature
```

## When it fires

The audit runs from `promote_and_route_next.sh`, which the coordinator calls
when promoting a paused ticket to `active/`. This means:

- A divergence that appears while nothing is being promoted goes unreported
  until the next promotion
- The expedite case (when this defect was discovered) is covered: the
  expeditor calls `promote_and_route_next.sh` at teardown, which runs the
  audit

The alternative (a periodic sweep via handoffd/babysitterd) was considered
and rejected: costs more, and the audit is cheap enough to run at the one
moment the coordinator is already touching the backlog.

## Out of scope here

- Moving tickets out of `hold/`. Article 3.1 gives that call to a human. A
  tool that quietly promoted out of hold would be a second way around the
  gate rather than a check on it.
- Detecting other forms of divergence (e.g., YAML in `paused/` but parcel in
  progress). This audit is scoped to the `hold/` case discovered live.

## Related

- [BL-567: Expedite one ticket with the swarm stopped](BL-567-expedite-one-ticket-with-the-swarm-stopped.md)
- [BL-1228: Pool audit at promotion](BL-1228-pool-audit-at-promotion.md) (sibling audit, same call site)
