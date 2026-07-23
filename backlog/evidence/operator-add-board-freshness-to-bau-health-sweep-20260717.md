# Instruction: add pipeline-board freshness to the Operator's BAU health sweep

Human-requested 2026-07-17, directly following the live pipeline-board-frozen outage (see
`backlog/evidence/pipeline-board-frozen-live-outage-20260717.md`, diagnosed same session): the human
asked that "make sure the board stays up to date" be added to the swarm's periodic/BAU health checks so
this class of silent, hours-long freeze is caught automatically instead of only being noticed when the
human happens to look at Telegram.

## Where this lives today

`swarmforge/roles/operator.prompt`, the `SWARM_CHECK_TIMER` event handler (~L130-132):

```
- **SWARM_CHECK_TIMER** — one health+progress sweep: 8 panes live, daemon
  heartbeat fresh, git HEAD advancing or agents actively working, no stuck
  parcels, backlog counts. If all healthy, do nothing but (optionally) note it.
```

This is the Operator's existing periodic GREEN/health checklist (confirmed live in
`.swarmforge/operator/operator.log`'s recurring sweep entries — 8/8 windows, heartbeat freshness, HEAD
advancing, mem/orphans, inboxes, awaiting-answer). The instruction: extend this checklist with a pipeline
board freshness check.

## What the new check should verify

- Read `.swarmforge/operator/concierge-tick-state.json` → `pipelineBoard.lastChangeMs`.
- A frozen board is NOT simply "lastChangeMs is old" (a genuinely idle backlog with no changes is a
  legitimate steady state — the change-gate in `pipelineBoardSync.ts` is intentional). The real signal is
  a MISMATCH: `pipelineBoard.lastChangeMs` stale/unmoving while the underlying backlog (active/paused
  ids, or another same-file sync target like `approvalsRoster`) has visibly changed since. Concretely: if
  `backlog/active/` + `backlog/paused/` membership or content has changed since `lastChangeMs` but the
  board's `contentSignature` still doesn't reflect it after a reasonable number of ticks (a few minutes,
  not one), that is the same class of live outage just diagnosed.
- Cheap proxy usable without deep computation: compare `pipelineBoard.lastChangeMs` against the most
  recent backlog file mtime (or git commit touching backlog/) — if backlog activity is newer than the
  board's last change by more than a small number of minutes, flag it.

## Action on a caught freeze

Same posture as every other SWARM_CHECK_TIMER finding: NOTIFY (per
`[[coordinator-blocked-on-local-approval-menu]]`-style posture — the Operator does not itself patch
application code), pointing at the live outage evidence file so root-causing isn't repeated from scratch
each time. This is a detection addition, not a fix for the current outage (that fix is tracked separately
via the coordinator note already sent).

## Disposition

This is a standing BAU-checklist / prompt change, not a one-off defect fix — route through the specifier's
normal rule-proposal path for a prompt update to `swarmforge/roles/operator.prompt`, same posture as any
other operator-prompt correction (e.g. BL-482's clock-drift addition to this same file).
