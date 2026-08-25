# BL-1110 — documenter pass — 20260824

Commit reviewed: `76a13fef2e` (hardener forward). Merge into documenter
completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (sweep-marker suppress vs threshold bump) and hardener
evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1110 entry.
- `docs/diagrams/architecture.mmd` — BL-1110 comment.
- `docs/how-to/BL-675-daemon-log-freshness-watchdog.md` — in-flight
  sweep suppress section (`suppress-in-sweep`).

No new how-to (classify, don't fill — extends the existing freshness
watchdog runbook). No extension command/setting/UI.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`,
task `BL-1110-handoffd-heartbeat-stale-past-budget-recurrence`.

By documenter.
