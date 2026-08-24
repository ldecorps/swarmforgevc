# BL-1102 — documenter pass — 20260824

Commit reviewed: `c83b36d101` (hardener forward). Merge into documenter
completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (`sh!` spawn-failure return vs throw) and hardener
evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1102 entry.
- `docs/diagrams/architecture.mmd` — BL-1102 comment.
- `docs/how-to/BL-967-handoffd-cycle-stall-diagnosis.md` — spawn vs bound
  vs exit distinction; `stopped`-looking death after PATH loss.
- `docs/index.md` — index blurb mentions BL-1102.

No new how-to of its own (classify, don't fill — extends the existing
stall-diagnosis runbook). No extension command/setting/UI.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`,
task `BL-1102-bounded-sh-throws-on-spawn-failure`.

By documenter.
