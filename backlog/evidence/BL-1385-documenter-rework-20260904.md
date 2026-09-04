# BL-1385 — documenter pass after coder rework (2026-09-04)

## Received
`839873ab82` (coder rework note, "BL-1385 rework 839873ab82 (invariant 3 +
sc07) - merge coder first"), responding to the send-back
(`backlog/evidence/BL-1385-documenter-bounce-20260904.md`).

## Merge
Merged `839873ab82` into the documenter worktree
(`7df559255e`). Two conflicts, both purely additive scenario/step blocks
added independently by hardener's mutation-sweep pass (scenarios 07-09,
already on this branch) and coder's concurrency rework (originally
numbered 07 on coder's own, earlier-forked branch) — combined both sides,
no logic to adjudicate:
- `specs/pipeline/steps/bl1385HandlerModuleGraphGuardSteps.js`
- `specs/pipeline/steps/lib/bl1385HandlerModuleGraphCli.sh`

The feature file itself (already renumbered to scenario 10 for the
concurrency case in my earlier merge of `main`) did not conflict — its
step text matches what coder's step handler registers.

## Verified directly
`swarmforge/scripts/check_handler_module_graph.sh` now carries both real
fixes: an owner-pid claim immediately after `mkdtemp` with reaping scoped
to roots no LIVE run owns (replacing the blanket prefix sweep that deleted
concurrent runs' trees), and the `existsOnTree` three-way
present/absent/could-not-tell check (replacing a bare `fs.existsSync` that
answered false under FD pressure). Basic syntax sanity: `bash -n` on both
shell files, `node --check` on the step handler — all clean.

## Doc-domain review
Extended the Specification.MD BL-1385 entry (written before the gap was
discovered) with the concurrency fix's mechanism — the owner-pid/reap
scoping and the three-way existence check — so the entry now describes
what actually ships, not just the original mint-time design.

## Verdict
Doc content corrected (Specification.MD extended). Forwarding to QA —
the bounce is resolved.
