# BL-1385 — CLEANER PASS (QA-directed governed rework review), 2026-09-04

Coordinator note: "BL-1385 QA bounce merged 13:25, no review pass since -
please run." QA's bounce (`backlog/evidence/BL-1385-bounce-20260904.md`)
found that cleaner, architect, and hardener never ran a governed pass
against coder's concurrency-fix rework (`839873ab82` and the bundled
existsOnTree fix in `d72e13b93b`, both already on `main` via QA's own
tip-pure land) — this is that pass, against the full delta since my last
actual BL-1385 review (`aa44d9cc83`).

## One cleanup made

`check_handler_module_graph.sh`'s two candidate-resolution sites
(`out/`→`src/` and the generic in-tree check) each checked every candidate
TWICE: once in a `for` loop looking for a hit, again via
`.map(existsOnTree)` looking for an inconclusive verdict. `existsOnTree` is
a real `fs.statSync`, so this cost an extra syscall per candidate and (very
marginally) widened the exact resource-pressure window the fix exists to
guard against. The generic block also inlined the same four-candidate array
literal twice, where the `out/`→`src/` block had already factored it into a
`cands` variable — an inconsistency between the two sites the original fix
introduced.

Consolidated into one `firstOnTree(cands)` helper that checks each
candidate exactly once and returns `{found, inconclusive}`; both call sites
now use it. Re-verified byte-for-byte behavior preservation:
- `check_handler_module_graph.sh` against `HEAD`: exit 0 (unchanged).
- Fixture shapes `good`, `missing-ext-out`, `missing-lib-sibling`,
  `missing-relative`: all four produce identical output to before the
  change (same markers, same handler/module names).
- Nine concurrent invocations (three batches of three): all exit 0,
  confirming the ownership-based reaping fix is untouched by this
  refactor.

## What else was checked (the governed review QA asked for)

- `bl1385_handler_module_graph_mutation_sweep.sh` (hardener's hand-authored
  sweep): re-ran — 8/8 non-skipped mutants killed, matching QA's own
  finding. The one skipped anchor ("out/->src/ candidate list emptied")
  was ALREADY stale before this pass (it searches for the pre-`cands`-
  variable inline-array shape); my consolidation into `firstOnTree` makes
  it more stale, not less. Flagging for hardener's own re-anchoring pass —
  not fixing the mutation-sweep script myself, that tool is hardener's
  domain (Article 4.1).
- `required_wiring` — re-confirmed all three anchors still present and
  live: `land_step_lib.bb` (tree-guard list), `run_commit_guards.sh`
  (`run_guard` call), `bl1385HandlerModuleGraphGuardSteps.js::registerSteps`
  — none of this pass's changes touch wiring.
- TypeScript compiles clean; the acceptance handler still discovers via
  BL-1371's registry.
- `mutation-site-count.js` on the JS step handler: 165 sites (`over` 100,
  unchanged from prior passes — this pass did not touch the JS handler,
  only the shell guard). Same reviewed-and-declined reasoning as every
  prior pass in this area.
- `jscpd` over `check_handler_module_graph.sh`: 0 clones both before and
  after my consolidation.

## Disposition

Forwarding to architect, continuing QA's specified remaining chain
(cleaner → architect → hardener → documenter → QA) so hardener can also
re-run its own governed pass (re-stamp the mutation manifest, re-anchor
the stale mutant 6, given this commit changes the exact code shape it
targets).

By cleaner.
