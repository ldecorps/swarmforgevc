# BL-1385 — architect governed pass (QA-directed), 2026-09-04

QA bounced BL-1385 (`backlog/evidence/BL-1385-bounce-20260904.md`) because
coder's concurrency-fix rework (`839873ab82`, plus the earlier `existsOnTree`
fix `d72e13b93b`) skipped cleaner, architect, and hardener entirely en
route to documenter. This is the architect leg of QA's specified remaining
chain (cleaner -> architect -> hardener -> documenter -> QA), against
cleaner's own governed pass (`10f38c7fa9`, which additionally consolidated
duplicate candidate-checking into a `firstOnTree` helper).

## Design review — the concurrency/design changes I hadn't reviewed before

- `existsOnTree` (three-way: true / false-ENOENT / null-inconclusive) —
  correctly distinguishes "confirmed absent" from "could not tell",
  matching the pattern this session's own BL-1375/BL-1387 reviews already
  established (absence of evidence is not evidence of absence). A
  resource hiccup (EMFILE/ENFILE) now degrades to `INCONCLUSIVE` (exit 2,
  never refuses), not a phantom `HANDLER_LOAD_BLOCK`.
- Cleaner's `firstOnTree(cands)` consolidation is a correct, behavior-
  preserving refactor: one syscall per candidate instead of two (a real
  `fs.statSync`, so halving the syscall count also narrows the exact
  resource-pressure window this fix exists to close). Read both call
  sites (`out/`->`src/` and the generic in-tree check) — both route
  through it identically now, closing the inconsistency the original fix
  introduced (one site had a `cands` variable, the other an inline
  literal).
- `reap_dead_roots`'s ownership model: a `.owner-pid` file written
  immediately after `mkdtemp`, `kill -0` liveness check (never touches a
  live owner's root regardless of age), age-bound fallback only for a
  root whose owner file was never written (the mkdtemp-to-first-write
  race). Structurally sound — a live run's tree can never be reaped out
  from under it.
- The `SENTINEL` post-hoc sanity check (does `specs/pipeline/steps/index.js`
  — known extracted at readdir time — still read as present at the end of
  the run?) is a good piece of defense in depth: if the sentinel vanished
  mid-run, any accumulated "failures" are downgraded to `INCONCLUSIVE`
  rather than reported as `HANDLER_LOAD_BLOCK`, directly targeting the
  exact failure mode QA/cleaner both reproduced (a concurrent reaper
  destroying a live run's materialised tree mid-check).

## Independently re-verified, not trusted from evidence

- `bl1385_handler_module_graph_mutation_sweep.sh` — 8/8 non-skipped
  mutants killed, matching both QA's and cleaner's own re-runs. The one
  skipped anchor is already correctly flagged as hardener's re-anchoring
  work, not silently accepted as clean.
- `run_acceptance.sh` on the BL-1385 feature — 13/13, including scenario
  13 ("two invocations running at once each reach their own verdict").
- Four genuinely concurrent invocations of the unmodified guard against
  this worktree: all four exit 0, no `HANDLER_LOAD_BLOCK`/`INCONCLUSIVE`
  in any output — the race cleaner/QA reproduced does not recur.
- `check_handler_module_graph.sh` (no args) — exit 0.
- `check_feature_handler_registration.sh` — exit 0, unaffected.
- Dependency gate on `bl1385HandlerModuleGraphGuardSteps.js` — PASSED.
- `required_wiring` — all three anchors re-confirmed live (unchanged by
  this pass): `land_step_lib.bb`'s tree-guard list, `run_commit_guards.sh`'s
  `run_guard` call, the step handler's `registerSteps`.

## Verdict

COMPLIANT. Continuing QA's specified chain: forwarding to hardener so it
can re-stamp the mutation manifest and re-anchor the one stale mutant
(already flagged by cleaner, not fixed here — that tool is hardener's
domain per Article 4.1).
