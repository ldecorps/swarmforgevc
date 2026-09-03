# BL-1344 — documenter pass, 2026-09-03

Merged hardener commit `a4d512f838` — clean merge, no conflict.

## Doc review

- Diff scoped to new `swarmforge/scripts/babysitter_waive_lib.bb` (pure
  read/decide), `swarmforge/scripts/babysitter_waive.bb` (the new
  `--record`/`--list`/`--withdraw` CLI), and `swarmforge/scripts/babysitter_check.bb`
  (consumer wiring). This is a genuine new swarm-internal capability with a
  CLI a human/coordinator runs by hand — real documentation debt, not a
  review-only stamp-off like today's earlier BL-1333/1342/1346 tickets.
- `docs/how-to/BL-611-babysitterd-runbook.md` is the primary living
  reference for `babysitter_check.bb` and already documents the Article
  4.2 detector and its `nudge-dedup.json` cooldown in detail — exactly the
  mechanism this ticket adds an exit from. Added a new "Waiving an
  investigated, permanent-history finding (BL-1344)" section (CLI usage,
  the tracked YAML store, the three bounds each with their failure-mode
  rationale, and the scope note that only the coordinator nudge is
  silenced, not the operator escalation), plus the new store path in the
  existing state-location table. Committed with an untagged subject
  (task-scope gate, BL-1192 — basename names BL-611, not BL-1344).
- `docs/index.md`: no new entry needed — the BL-611 how-to is already
  linked and this is an addition to it, not a new file.
- Diagram check: `architecture.mmd`'s change-trigger is the extension
  host/webview boundary, the tmux substrate relationship, or the
  `.swarmforge/` state layout. The new store lives under `backlog/`, not
  `.swarmforge/`, and no diagram enumerates individual babysitter state
  files. No diagram edit required.
- No RETIRED/deprecated behaviour involved — Article 3.6 not implicated.

## Action taken

Added a dated entry to `docs/reference/Specification.MD` (commit
`10ecd5a546`) covering: why the existing cooldown never actually clears
this class of finding, the tracked-YAML store and its hotfix-ledger
precedent, the CLI as the sole write path (sweep never writes), the
apply-before-cooldown wiring and the `WAIVED`/`WAIVE-STORE-UNUSABLE`
reporting, the one-key-one-waive scoping, the fail-to-nudge-not-silence
posture on an unreadable store, and the explicit scope note that operator
escalation is untouched. `**Last Updated**` bumped in the same commit.

## Verdict

No documenter-domain defect found; one real documentation gap closed (the
BL-611 runbook, above — a new operator-facing mechanism with no prior
coverage). Forwarding to QA.
