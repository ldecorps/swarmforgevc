# BL-1111 — documenter pass — 20260824

Commit reviewed: `6aa1d262be` (hardener forward). Merge into documenter
completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (transport reconnect vs BL-621 alert) and hardener
evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1111 entry.
- `docs/diagrams/architecture.mmd` — BL-1111 comment.

README / new how-to — none (classify, don't fill; BL-621 sustained alert
and operator-facing conf are unchanged; this is reconnect recovery inside
the existing front-desk bot). No new extension command/setting/UI.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`,
task `BL-1111-reply-relay-terminated-sustained-outage`.

By documenter.
