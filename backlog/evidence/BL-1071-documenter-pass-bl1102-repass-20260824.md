# BL-1071 — documenter pass (BL-1102 spawn-failed re-pass) — 20260824

Commit reviewed: `986d6b3ca2` (hardener forward; batch tip with BL-1114).
Merge into documenter completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the BL-1102 interaction re-pass (spawn-failed → unavailable) and
hardener evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1071 re-pass entry
  (and BL-1114 entry for the co-batched tip).
- `docs/diagrams/architecture.mmd` — BL-1071×BL-1102 and BL-1114 comments.
- `docs/how-to/BL-611-babysitterd-runbook.md` — spawn-failed vs missing-plane
  note under control-plane auto-heal.

Tip also carries BL-1114 (exhausted recovery: terminal note + dispose to
`handoffs/failed/`); Spec/diagram updated for it in this same docs commit.
Handoff task remains the claimed parcel **BL-1071**.

No new how-to (classify, don't fill). No extension command/setting/UI.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`,
task `BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix`.

By documenter.
