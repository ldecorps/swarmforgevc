# BL-1318 documenter pass — 2026-09-01

Merged hardener 038dab08e4 into documenter worktree.

## Doc deliverables

- New how-to: `docs/how-to/BL-1318-pack-staffing-gate.md` — what the gate
  checks, refusal shape, the `PACK_STAFFING_SKIP_GATE=1` escape hatch, the
  identity-resolution table, and the ticket's own "not this slice" scope.
- `docs/reference/Specification.MD` — new dated entry (BL-1318) prepended to
  the running chain, describing the single call site
  (`pack_staffing_gate` in `swarmforge/scripts/swarmforge.sh`), the pure
  decision fn (`seat-staffing-decision`), the three required checks, and the
  operator escape hatch. "Last Updated" bumped in the same commit as the
  content change.
- Cross-links added (ticket's in-parcel deliverable: "a how-to cross-linked
  from the BL-547 and BL-1127 pages"):
  - `docs/how-to/BL-547-model-steward-overview.md` — `## Related` list gains
    the BL-1318 how-to.
  - `docs/how-to/BL-1127-local-coder-steward-evidence-bar.md` — new section
    naming BL-1318's `PACK_STAFFING_SKIP_GATE=1` as the shape precedent's
    reuse.
- `docs/index.md` — new line for the BL-1318 how-to, placed next to the
  BL-547 model-steward line; index stays exhaustive/orphan-free.

## Diagrams

Reviewed the four registered diagrams' change-triggers
(`architecture.mmd`, `swarm-flow.mmd`, `handoff-flow.mmd`,
`front-desk-flow.mmd`). BL-1318 adds a launch-time staffing check inside an
existing call path (`parse_config`'s per-window loop in
`swarmforge.sh`) — it changes neither the extension-host/webview boundary,
the tmux substrate relationship, `.swarmforge/` state layout, pipeline
topology/backlog flow, the handoff file lifecycle, nor front-desk routing.
No diagram's trigger fired; none updated.

## Retired behaviour

None. This ticket only adds a refusal path; nothing user-visible was
removed. `docs/deprecated/` untouched.

## Scope check

No production code, tests, or requirements changed — factual doc content
only, matching what the hardener/architect/cleaner passes actually shipped
(verified against their evidence files and `swarmforge.sh`/
`pack_staffing_gate_lib.bb` directly, not assumed from the ticket
description alone).

## Verdict

NONE — no defects found, nothing to bounce. Forwarding to QA.
