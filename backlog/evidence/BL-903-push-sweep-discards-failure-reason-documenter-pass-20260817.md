# BL-903 push-sweep-discards-failure-reason — documenter pass — 20260817

Commit reviewed: `67919fbf78` (hardener's forward, `merge_and_process
hardender 67919fbf78`, bundling BL-901/BL-903/BL-815 as three separate
tasks). This pass covers BL-903 only, per its own `git_handoff`
(task `BL-903-push-sweep-discards-failure-reason`); BL-901 and BL-815 are
documented in their own separate passes and evidence files. Already an
ancestor of this branch (merged during the BL-901 pass); no new merge
needed.

## What changed

`push_sweep_lib.bb`'s `push-failed` log line previously recorded only an
attempt count (`"attempts=" (:attempts next-push)`), discarding the `:error`
value git's push adapter already returns on failure. The push-failed log
line now carries the trimmed, single-line error text alongside the attempt
count, and the operator alarm (`send-push-alarm!`, previously handed only
the attempt count) receives the same reason so a "push has failed N times"
alert can say why. No retry-state-machine change: `:exhausted?`, the
backoff, and the QA-ancestry/divergence gates are all explicitly unchanged
(the ticket rules this out as its own defect, not this one's scope).

## Doc surfaces checked

- `docs/reference/Specification.MD` — grepped for `push-sweep`, `push-failed`,
  `push-alarm`/`send-push-alarm`, `:error`: no entry documents the
  `push-failed` log line's fields or the push alarm's email body content.
  Nothing there to correct or extend.
- `docs/how-to/` alarm-related runbooks (`BL-144-daemon-death-alarm.md`,
  `BL-349-stuck-role-escalation-email.md`, and others) — none is about the
  push-sweep alarm specifically; no catalog doc of alarm email bodies exists
  to update.
- `docs/diagrams/architecture.mmd` / `swarm-flow.mmd` mention `push-sweep`
  only as an existing component/edge already depicted; this parcel enriches
  a log line and an alarm body, it adds no new component, boundary, or
  pipeline-topology element.
- No new human-facing command, setting, or flow was introduced. The operator
  reads richer information at the same two existing surfaces (the daemon log
  and the existing push-failure alarm email) — the shape of "where you look"
  is unchanged, only the content already promised (the log line, the alarm)
  is more complete.

## Verdict

NONE. No human-facing documentation requires a change for this parcel.

## Forward

`git_handoff` to `QA`, priority `00`, task
`BL-903-push-sweep-discards-failure-reason`.

By documenter.
