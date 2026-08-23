# BL-1108-cursor-seat-readiness-hotfix — documenter pass — 20260823

Commit reviewed: `bd632c39f8` (hardener forward; `merge_and_process hardender
bd632c39f8`). Merge into documenter completed as `0304cb7f7`.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the stamp-off ticket (hotfix `f02f6ae5b4`: agent-aware babysitter,
`agent:<role>` half-launch heal, `rc:` OFF for non-Claude, Cursor prompt-file
wake). Doc surfaces:

- `docs/how-to/BL-611-babysitterd-runbook.md` — check 1 now names
  `agent_process_marker_lib.bb` and per-token needles; check 2 scoped to Claude
  `/rc`.
- `docs/how-to/BL-514-remote-control-health-and-ensure-wiring.md` — Cursor /
  non-Claude seats report `rc:` **OFF**; example output; `:off` no longer
  documented as HEALTHY.
- `docs/how-to/BL-1079-cursor-identity-steward-certify-and-residuals.md` —
  hotfix callouts retitled as stamped BL-1108; related table links babysitter /
  BL-848 / BL-1108.
- `docs/reference/Specification.MD` — Last Updated + BL-1108 shipped entry.
- `docs/diagrams/architecture.mmd` — BL-1108 comment on shared marker lib.
- `docs/index.md` — babysitterd and BL-514 blurbs mention markers / OFF.
- README — no user-facing extension command/setting/flow; no change.
- No new mode-directory how-to minted (classify, don't fill — stamp-off
  updates existing ops runbooks rather than inventing a parallel recipe).

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit. BL-1052 rides the same hardener tip but gets
its own documenter pass and handoff (Article 2.6 / BL-250).

By documenter.
