# BL-1106 — documenter pass — 20260824

Commit reviewed: `cf2e859b97` (hardener forward). Merge into documenter
completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (pause + throttle resolve at master via
`resolve-identity-root`; completes BL-966's unfinished half) and prior
evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1106 entry; BL-966
  long-form note that pause/throttle layers are completed by BL-1106.
- `docs/how-to/BL-617-nightly-cooldown-window.md` — effective-depth same
  answer from every checkout while paused.
- `docs/index.md` — link BL-617 (was orphan) with BL-1106 blurb.
- `docs/diagrams/architecture.mmd` — BL-1106 comment.
- README — no extension command/setting/UI; no change.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit.

By documenter.
