# BL-1385 — hardener pass, 2026-09-04

Merged architect commit `201eca6bdd` (clean pass, no bounce —
`backlog/evidence/BL-1385-architect-20260904.md`). Independently re-ran
every gate rather than trusting the evidence trail.

## Checks re-run, all independently

- `bash swarmforge/scripts/check_handler_module_graph.sh` (no args, this
  worktree) — exit 0, clean.
- `bash swarmforge/scripts/check_handler_module_graph.sh a93aa4a18f .` —
  exit 1, `HANDLER_LOAD_BLOCK`, names `bl1296BubbleSeatSteps.js` and the
  missing `bubbleSeat` module — the real 2026-09-04 incident commit,
  reproduced and independently confirmed caught.
- `run_acceptance.sh` on the BL-1385 feature — 9/9 PASS (pre-hardening;
  12/12 after the three scenarios added below).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `required_wiring`: both consumer anchors confirmed present by grep —
  `run_commit_guards.sh:73` (`run_guard check_handler_module_graph.sh`) and
  `land_step_lib.bb:993` (`check_handler_module_graph.sh` in the
  replayed-tree-guards list).

## BL-149 cooldown gate (all changed production files)

- `swarmforge/scripts/check_handler_module_graph.sh` — DECISION: run
  (brand-new file, no prior commit; file_age_days computed as a large
  fallback value, which is not a cooldown window).
- `swarmforge/scripts/run_commit_guards.sh` — DECISION: run (file_age_days
  4.28, past the 3-day cooldown).
- `swarmforge/scripts/land_step_lib.bb`,
  `swarmforge/scripts/post_hotfix_merge_origin.bb`,
  `swarmforge/scripts/post_hotfix_merge_origin_lib.bb`,
  `swarmforge/scripts/swarm_heal.bb`,
  `swarmforge/scripts/master_main_reconcile_lib.bb` — all DECISION:
  skip-cooldown (still inside the 3-day window). None of these were
  touched by my own hardening edits (only the BL-1385 feature/steps/CLI
  fixture were); no mutation sweep run against them this pass.

## Hand-authored mutation sweep (no Babashka/shell mutation tool wired —
BL-638/BL-567 fallback), `check_handler_module_graph.sh` (DECISION: run)

Wrote `swarmforge/scripts/test/bl1385_handler_module_graph_mutation_sweep.sh`,
9 mutants against `run_acceptance.sh` on the BL-1385 feature as the oracle.
First pass: **6 killed, 3 SURVIVED** — real gaps, not equivalent:

1. "no-steps-dir case flipped from pass to refusal" — no scenario exercised
   a tree with no `specs/pipeline/steps` directory at all (the documented
   "nothing to discover is not a failure" branch).
2. "TREE-rooted check dropped" (`const real = abs.startsWith(TREE) ? abs :
   null`) — no scenario exercised a handler requiring something outside the
   materialised tree's path prefix. Confirmed a REAL discriminating case
   (not equivalent): a foreign, nonexistent absolute path (e.g. a
   mis-computed `../../../../` traversal past the tree root) is correctly
   stubbed/passed today (treated as an unrelated dependency reference), but
   with this check dropped it gets wrongly flagged `missing` — a false
   positive that would refuse a tree over content that was never meant to
   be tree content in the first place.
3. "process.exit-during-load guard removed" — no scenario exercised a
   handler calling `process.exit()` at load, the exact hazard the code's
   own comment names ("a handler that calls process.exit at load would
   otherwise end the whole sweep and silently pass every handler after
   it").

Closed all three by adding real coverage rather than accepting them:
- Scenario 07: a tree with no step registry directory at all passes.
- Scenario 08: a handler calling `process.exit` before a bad handler does
  not hide that bad handler (mm-prefixed exit-caller sorts before the
  existing zz-prefixed bad handler; guard must still reach and refuse it).
- Scenario 09: a handler requiring a nonexistent foreign absolute path
  outside any tree passes (not tree content, must not be flagged missing).

All three added at both the CLI fixture (`bl1385HandlerModuleGraphCli.sh`,
three new shapes: `no-steps-dir`, `handler-calls-exit`,
`escapes-tree-scope`) and the step handler
(`bl1385HandlerModuleGraphGuardSteps.js`, three new Given steps, reusing
existing Then steps). Re-ran the sweep: **9/9 killed, 0 survived, 0
equivalent**. Re-ran acceptance: 12/12 PASS.

## BL-113 Gherkin mutation (both pre-existing Scenario Outlines)

Ran `run_gherkin_mutation.sh` soft over the BL-1385 feature (my three new
scenarios are plain Scenarios, not Outlines, so they add no new mutants to
this gate but their coverage is what let the hand-authored sweep above go
clean). 9/9 mutants killed (3 + 6), 0 survived, 0 errors. Manifest stamped.

## CRAP / DRY

Both `npm run crap` and `npm run dry` are scoped to `extension/src/**`.
This parcel (mine and the coder/architect's) touches no file under
`extension/src` — CRAP/DRY N/A.

## Result

Three real test gaps found and closed via a hand-authored mutation sweep
(the only mutation coverage available for this shell-script guard). No
orphaned test/mutation processes left behind (confirmed via `pgrep`).
Forwarding to documenter.

By hardender.
