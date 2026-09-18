# Epic backfill apply (BL-677)

Slice 2 of the done-epic backfill (see
[BL-676 report how-to](BL-676-epic-backfill-proposal-report.md)). Where
BL-676 only reads and reports, this writes: it takes BL-676's report once
a human has amended and approved it, and writes each approved `epic:`
into the matching `backlog/done/` ticket YAML.

## Run it

```bash
bb swarmforge/scripts/epic_backfill_apply.bb [project-root] [mapping-path]
```

`mapping-path` defaults to BL-676's own report path
(`backlog/evidence/BL-676-epic-backfill-proposals-report.md`).

## Refusals — checked in this order, no write on any of them

1. **not-approved** — the mapping file has no `human_approval: approved`
   line. The report BL-676 emits is inert until a human stamps it.
2. **stale-mapping** — a ticket id in the mapping has no file under
   `backlog/done/`: the mapping is stale against the tree, regenerate
   BL-676's report.
3. **unknown-epic** — any proposed value that is neither a live roster
   epic id nor the documented `pre-epic-era` sentinel
   (`swarmforge/backlog-schema.md`): a typo fails the whole run loud,
   before any write, rather than scattering a novel string.

## What a successful run does

- Writes each row's proposed `epic:` into its ticket YAML, in batches,
  each batch committed through `commit_integrity_cli.bb` — never one
  commit per ticket, never a hand-typed commit on the shared checkout.
- **Never overwrites** a target ticket that already carries a non-empty
  `epic:` — skipped and counted as `skipped-already-tagged`.
- Skips and counts rows with an empty proposal cell
  (`skipped-empty-proposal`) — a `needs-judgment` row the human has not
  filled in yet does not block the rest of the run.
- Prints a summary: applied / skipped-already-tagged /
  skipped-empty-proposal / batch commit count.
- **Idempotent**: re-running after a successful apply with the same
  mapping finds nothing left to write and commits nothing.

## e2e verification

On the real repo with a human-approved report: run the apply, check the
printed summary reconciles against the report's rows, `git log` shows
only batched commit-integrity commits, spot-check several rewritten
`backlog/done/` tickets, then re-run and confirm a clean no-op.

Acceptance: `specs/features/BL-677-epic-backfill-apply.feature`.
