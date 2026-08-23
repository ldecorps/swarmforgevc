# BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model — documenter pass — 20260823

Commit reviewed: `bd632c39f8` (hardener forward; `merge_and_process hardender
bd632c39f8`). Merge into documenter was already present as `0304cb7f7` (shared
tip with BL-1108; this ticket gets its own doc pass and handoff per Article
2.6 / BL-250). Implementation tip reviewed: `3f97f2137` (coder) through
hardener.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (local-model agent key, loopback pack, health refusal,
generic model-id path, secrets via tmux `-e`, aider `qwen-mono-router`
untouched) and the acceptance feature. Doc surfaces:

- `docs/how-to/BL-1052-local-model-seat-launch.md` — new how-to (launch,
  ensure, model swap, vs aider pack).
- `docs/how-to/BL-1082-pull-and-serve-a-named-model.md` — cross-link to the
  seat how-to.
- `docs/index.md` — new how-to entry; BL-1082 blurb clarified.
- `docs/reference/Specification.MD` — Last Updated + BL-1052 shipped entry
  (superseded qwen-code history retained below).
- `docs/diagrams/architecture.mmd` — BL-1052 comment on local-model seat.
- README — no user-facing extension command/setting/flow; no change.
- Diagrams otherwise: workflow topology unchanged; architecture comment only.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit.

By documenter.
