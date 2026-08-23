# BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix — documenter pass — 20260823

Commit reviewed: `5c4ee23fc5` (hardener's forward, `merge_and_process hardender
5c4ee23fc5`).

## What changed

This is a swarm review/stamp-off of an already-landed operator hotfix
(`f6b6aef25`, babysitterd's WSL blackout fix), plus real hardening the coder
made on top of it per the ticket's seven review goals: removed the
`BABYSITTER_FAKE_ENSURE_RESULT`/`BABYSITTER_ENSURE_COUNT_FILE` force-result
anti-pattern; bounded `./swarm ensure` in wall-clock time (new
`BABYSITTER_ENSURE_TIMEOUT_MS`, default 5 min, via a `run-bounded!` mirroring
`expedite_cli.bb`'s); the control-plane REPAIR line grew a third outcome
(`repaired|failed|unfinished`, was two); an observer that throws now reports
`UNAVAILABLE [control-plane]` rather than silently producing no finding at
all (the same silent-blackout shape one layer up). All operator-facing.

## Doc surfaces checked

- `docs/how-to/BL-611-babysitterd-runbook.md` — the daemon's own runbook.
  This was already stale **before** this ticket: the hotfix landed
  `run-control-plane-ensure!` (babysitterd auto-recovering the control plane
  via `./swarm ensure`) with no mention anywhere in this runbook, and the
  runbook's own claim — "the daemon does not fix anything, with one bounded
  exception" (BL-1017's session repair) — was already wrong the moment that
  hotfix landed. This ticket's hardening (timeout bound, third REPAIR
  outcome, removed force-result seam, new UNAVAILABLE severity) made the gap
  worse to leave undocumented. Fixed:
  - "one bounded exception" -> "two bounded exceptions", naming both.
  - New section `## Control-plane auto-heal, bounded in time (BL-958/BL-1071)`
    (placed beside the structurally similar BL-1017 section), covering the
    finding severities (CRIT/UNAVAILABLE), the attempt/cooldown bound, the
    new wall-clock bound and its env seam, the three-outcome REPAIR line,
    and the force-result seam's removal.
- `docs/how-to/BL-958-control-plane-loss-recovery.md` — the human-facing
  manual-recovery runbook for the same underlying mechanism
  (`./swarm ensure`), whose "Who owns the response" section names
  `babysitterd` as owner but had no detail on how that owner's automatic
  recovery is bounded. Added one cross-reference sentence pointing to the
  new babysitterd-runbook section rather than duplicating the mechanics —
  this doc is task-oriented (a human running `ensure` by hand), the new
  section is reference/task detail on the daemon's own automatic path.
- Grepped `docs/` and `README.md` for the two removed env vars
  (`BABYSITTER_FAKE_ENSURE_RESULT`, `BABYSITTER_ENSURE_COUNT_FILE`): no
  other reference existed before this pass (the only hit now is this
  pass's own "removed" note).
- `docs/diagrams/*.mmd` — grepped for `babysitter`, `control-plane`,
  `ensure`: `architecture.mmd` has a `%%`-comment note recording BL-958
  context (three consumers of `control_plane_lib`) but does not depict
  babysitterd or its internal repair control flow as a diagram node — that
  level of detail is out of this diagram's scope (extension
  host/webview/substrate/`.swarmforge` state), same as BL-1017's repair
  mechanism, which also isn't diagrammed. `swarm-flow.mmd` has no hits at
  all. No diagram change needed.

## Forward

Forwarding the received commit unchanged to QA, priority 00.

By documenter.
