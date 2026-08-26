# BL-1082-invariant-2-property-vacuous — documenter pass — 20260823

Commit reviewed: `fdeb74ef50` (hardener tip;
`merge_and_process hardender fdeb74ef50`). Task name on the parcel is the
invariant-2 non-vacuous re-entry; the tip carries the full named-model
pull/serve surface that still lacked human-facing docs.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (`backlog/hold/BL-1082-…yaml`), the acceptance feature,
and the operator CLI (`named-model.ts` / `modelServing.ts`). Doc surfaces:

- `docs/how-to/BL-1082-pull-and-serve-a-named-model.md` — **new** how-to:
  Linux/WSL2 v1 host, Ollama runtime, pull/serve/status recipe, store
  outside the worktree, idempotent serve reuse, loud unknown-id failure,
  boundary vs BL-1052/BL-1053.
- `docs/index.md` — linked the how-to under How-to guides.
- `docs/diagrams/architecture.mmd` — named-model compose tooling + local
  Ollama store/endpoint subgraph. `swarm-flow.mmd` unchanged (no pipeline
  topology change).
- `docs/reference/Specification.MD` — no Milestone-1 product surface for
  this operator tooling; left alone (no "Last Updated" bump).
- README — no extension command/setting change; left alone.
- Prior QA bounce history for this task on `main`/`origin/main`: none
  found that still applies to docs.

## Sibling ticket on the same tip

`BL-1077-a-documented-qwen-credential-name-is-honored` shares hardener tip
`fdeb74ef50` and has its own inbound handoff. Per BL-250 it gets its own
documenter pass and QA `git_handoff` — not folded into this one. Ticket text
says pack PREREQ docs were already correct (code was wrong); that pass is
expected to forward with no doc invent unless a stale contradictory page
is found.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit.

By documenter.
