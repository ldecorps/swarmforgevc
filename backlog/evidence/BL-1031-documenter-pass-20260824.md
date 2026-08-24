# BL-1031 — documenter pass — 20260824

Commit reviewed: `65f851e7d9` (hardener forward). Merge into documenter
completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (spawn-reachable chokepoint + wait-bound fail-CLOSED)
and hardener evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1031 entry.
- `docs/diagrams/architecture.mmd` — BL-1031 comment.
- `docs/how-to/BL-967-handoffd-cycle-stall-diagnosis.md` — spawn-reachable
  subtree + acceptance-contract wait-bound note.

No new how-to (classify, don't fill). No extension command/setting/UI.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`,
task `BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree`.

By documenter.
