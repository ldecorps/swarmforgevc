# BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix — documenter pass — 20260823 (rebuild)

Commit reviewed: `eed70e498c` (hardener's forward, `merge_and_process hardender
eed70e498c`; merged into this worktree as `befafc71e`).

## Context

The first BL-1071 landing (`fa2b43401`, this ticket's earlier documenter
pass) was reverted whole by QA (`238ceb2ec`, reverting merge `9f85ce0b93`
into `swarmforge-QA`) along with the rest of that implementation — not a
doc-specific defect. The ticket was rebuilt coder → cleaner → architect →
hardener since, adding a fix beyond the original: scenario 06's three step
handlers (specifier's mid-flight goal-4 amendment) and the
`control-plane-error` destructuring gap `assemble-findings` was silently
dropping. This pass redoes the doc work against that rebuilt state; the
`BABYSITTER_ENSURE_TIMEOUT_MS` bound, the removed `BABYSITTER_FAKE_ENSURE_RESULT`
seam, and the three-outcome REPAIR line are unchanged from the first pass's
description and confirmed still accurate by re-reading the current code.

## What changed

Swarm review/stamp-off of an already-landed operator hotfix (`f6b6aef25`,
babysitterd's WSL blackout fix), plus real hardening added on top per the
ticket's seven review goals: removed the `BABYSITTER_FAKE_ENSURE_RESULT` /
`BABYSITTER_ENSURE_COUNT_FILE` force-result anti-pattern; bounded
`./swarm ensure` in wall-clock time (`BABYSITTER_ENSURE_TIMEOUT_MS`, default
5 min, via a `run-bounded!` mirroring `expedite_cli.bb`'s); the
control-plane REPAIR line grew a third outcome (`repaired|failed|unfinished`,
was two); an observer that throws now reports `UNAVAILABLE [control-plane]`
with the observation's own error text, rather than silently producing no
finding at all. All operator-facing.

## Doc surfaces checked

- `docs/how-to/BL-611-babysitterd-runbook.md` — the daemon's own runbook.
  Still stale going into this pass (the earlier fix was reverted along with
  its doc pass): "the daemon does not fix anything, with one bounded
  exception" (BL-1017's session repair) was wrong the moment the hotfix
  landed. Fixed:
  - "one bounded exception" → "two bounded exceptions", naming both.
  - New section `## Control-plane auto-heal, bounded in time (BL-958/BL-1071)`
    (placed beside the structurally similar BL-1017 section), covering the
    three finding severities (CRIT-queued/CRIT-escalate/UNAVAILABLE), the
    attempt/cooldown bound shared with BL-1017's `session-repairs.json`, the
    per-role-repair suppression while a plane ensure is queued, the
    wall-clock bound and its env seam, the three-outcome REPAIR line, and
    the force-result seam's removal.
- `docs/how-to/BL-958-control-plane-loss-recovery.md` — the human-facing
  manual-recovery runbook for the same underlying mechanism
  (`./swarm ensure`). Added one cross-reference sentence, under "Who owns
  the response", pointing to the new babysitterd-runbook section rather than
  duplicating the mechanics — this doc stays task-oriented (a human running
  `ensure` by hand), the new section is reference detail on the daemon's own
  automatic path.
- `docs/index.md` — the BL-611 runbook's index line already enumerates its
  major sections; added the control-plane auto-heal mention alongside the
  existing bounded-vanished-session-repair one so the index stays accurate,
  not just non-orphaned.
- Grepped `docs/` and `README.md` for the two removed env vars
  (`BABYSITTER_FAKE_ENSURE_RESULT`, `BABYSITTER_ENSURE_COUNT_FILE`): no
  other reference exists (the only hit is this pass's own "removed" note).
- `docs/diagrams/*.mmd` — grepped for `babysitter`, `control-plane`,
  `ensure`: `architecture.mmd` carries a `%%`-comment noting BL-958 context
  (the single `control-plane` status row, the incident file, `swarm_ensure.bb`
  deciding recovery) but does not depict babysitterd's internal repair
  control flow as a diagram node — same level of detail exclusion as
  BL-1017's per-role repair, which also isn't diagrammed. No diagram change
  needed. `operator-command-surface.mmd`'s one hit (`/ensure` in the command
  list) is unrelated to babysitterd's own auto-heal.

## Forward

Forwarding the received commit unchanged to QA, priority 00.

By documenter.
