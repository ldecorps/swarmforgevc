# BL-1304 documenter pass — 20260901

Reviewed the hardener commit (4384b8a8c6) against BL-1304's acceptance
criteria and the ticket's premise.

## Checklist

- Read the ticket YAML (`backlog/paused/BL-1304-a-dry-run-spawns-nothing.yaml`)
  and feature file: `expedite.sh --dry-run` must not reach the real stage
  launcher, regardless of whether a worktree survives from an earlier run.
- Read the coder commit (f48fd29601, `expedite_cli.bb`) gating
  `drive-stages!`/`run-stage!` on `dry-run?` the same way every sibling
  side-effecting step already is.
- The existing operator-facing doc, `docs/how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md`,
  already documented `--dry-run` as "plan and print; touches nothing" —
  that claim was previously aspirational (the bug this ticket fixes). No
  new how-to is warranted (Divio "classify, never fill"): this is an
  amendment to existing task-oriented content, not new scope.
- Checked whether any registered diagram depicts the expedite dry-run path:
  none does (`architecture.mmd`/`swarm-flow.mmd`/`handoff-flow.mmd`/
  `front-desk-flow.mmd` grepped for `dry-run`/`drive-stages`/`run-stage`,
  zero hits) — no change-trigger fired.

## Doc changes made

- Added a paragraph to `docs/how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md`
  right after the `--dry-run` flag description, naming the BL-1304 fix and
  the exact prior failure mode (dry run executing for real when a worktree
  from an earlier run already existed).
- Bumped `docs/reference/Specification.MD`'s "Last Updated" line in the
  same commit, chained onto the existing entry per this file's established
  convention (one running paragraph, newest first).

## Findings

NONE.
