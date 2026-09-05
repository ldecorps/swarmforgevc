# BL-1427 — architect pass, 2026-09-05

Ticket: BL-1427-the-load-guard-covers-every-script-and-runs-none
Role: architect
Commit reviewed: fa8244f670 (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1427LoadGuardCoversEveryScriptSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is a new Babashka analysis driver
  (`bb_load_analyse_driver.bb`), edits to the pre-existing shell guard
  (`check_bb_scripts_load.sh`), four scripts adopting the now-real
  self-loading contract the driver exposed, a property test, and a step
  handler — no webview, no VS Code API, no secrets, no browser storage.
- **Co-change report**: only the guard's own pre-existing sibling family
  (BL-1395's own tests/docs) — nothing new or suspicious.

## Invariants Review (BL-633/654) — traced by hand and re-run live

1. **Coverage.** `check_bb_scripts_load.sh` now materializes the changed-
   file list into a bash array via `mapfile` (never a `while read <
   <(process substitution)` pipe a script's own stdin read can drain), and
   explicitly compares `listed` against `analysed`, refusing on any gap —
   confirmed by reading the diff and by running the real `--all` guard
   against the live 293-script tree myself: the loop reached every file
   this time (no "loop coverage" gap message), correctly refusing on the
   ONE genuinely broken file it now reaches
   (`post_qa_branch_sweep.bb`, BL-1426's own still-open defect) rather
   than silently stopping short. `</dev/null` is on both the per-script
   probe invocation and the `boot_handoffd` boot step.
2. **No entry-point execution.** Read `bb_load_analyse_driver.bb` by hand:
   `analyse-without-running-main` reads every top-level form with a
   pushback reader and evals all but the entry-call shape
   (`entry-call?` matches bare `-main`, `(-main *command-line-args*)`, and
   `(apply -main ...)` by head symbol, independent of arity) — a reader
   error anywhere still propagates uncaught to babashka's own error
   banner, preserving `analyse_one`'s existing discrimination contract.
   Verified live: `BB_LOAD_ANALYSE_TARGET=check_swarm_detached.bb` and
   `=clear_identical_untracked_and_merge.bb` (the two previously-blocked,
   fixed-arity healthy CLIs the ticket names) both now exit 0 through the
   real driver — confirmed myself, not inferred from the coder's evidence.
3. **Recall not lowered.** Ran the pre-existing regression suite
   `test_bl1395_bb_scripts_load.sh` myself: all 16 scenarios pass
   unchanged, including forward-reference/undefined-symbol/reader-error
   refusals and the handoffd boot-guard contract — confirms the driver's
   eager-defn-analysis path (never skipped, only the entry call is) still
   catches everything BL-1395 scenario 01 originally pinned.

## The `*command-line-args*`-leak defect the driver's own header documents — verified, not just read

The driver's header explains a real defect found and fixed during
authoring: a positional arg would have leaked into an analysed script's
own top-level `*command-line-args*` reads (`post_commit_push.bb`'s
`(def lib-path (first *command-line-args*))` outside any `-main`). The fix
threads the target path through an env var (`BB_LOAD_ANALYSE_TARGET`)
instead — confirmed by reading the driver: no positional arg is ever
passed to the analysed process.

## Collateral fixes — real robustness, not workarounds for the guard

- **`post_commit_push.bb`**: `lib-path` now falls back to the sibling
  file's own real path when `*command-line-args*` is empty (a standalone
  analysis, or any future bare invocation) — the real-invocation path
  (BL-1198's explicit-passing contract) is unchanged (`or (first args)
  ...`). Confirmed by reading the diff: the fallback branch only ever
  fires when the first branch is nil.
- **`model_factory_lib.bb`/`model_steward_evaluate_lib.bb`/
  `pack_staffing_gate_lib.bb`**: each previously relied on an undocumented-
  except-in-a-comment caller contract ("callers must also load
  model_steward_lib.bb first"). Each now self-loads that dependency
  directly (idempotent re-load, confirmed harmless). This closes a real,
  previously-invisible fragility (a caller that forgot the comment's
  contract would have failed at runtime) — not merely satisfying the
  guard. Independently re-ran `model_factory_test_runner.bb`,
  `pack_staffing_gate_lib_test_runner.bb`,
  `bl556_evaluate_ingest_test_runner.bb`, and
  `bl682_mistral_vibe_routing_test_runner.bb` (all consumers of these
  libs): all pass, no regression from the double-load.

## Independently re-verified the substance

- `bb_load_analyse_driver.bb` run directly against both previously-
  blocked scripts → both exit 0 (confirmed above).
- `check_bb_scripts_load.sh --all` against the live tree → correctly
  refuses naming `post_qa_branch_sweep.bb` (BL-1426's own known, still-
  open defect, sibling-ticketed, out of this ticket's scope per its own
  description) with NO "loop coverage" gap — the loop reached every file.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1427LoadGuardCoversEveryScriptInvariants.property.test.js` →
  3/3 pass, directly encoding all three declared invariants (P1 coverage,
  P2 no-entry-execution, P3 recall-not-lowered).
- `bash test_bl1395_bb_scripts_load.sh` → 16/16 pass, unchanged.
- `tempDirTrapGuard.test.js`/`socketFixtureShortRootGuard.test.js` (the
  two other standing-red guards fixed earlier today) → both stay green
  against this parcel's new fixture-tree step handler.

## Acceptance wiring — driven end-to-end myself

Feature declares 4 scenarios / 6 scenario runs. Independently drove
`bl1427LoadGuardCoversEveryScriptSteps.js::registerSteps` against all 6 —
each shells out to the REAL `check_bb_scripts_load.sh --all` over a real
fixture tree under mkdtemp (never a reimplementation) — all passed,
including scenario 03's three entry-call shape examples confirming the
marker file is never written (the entry point genuinely never runs).
`registerSteps` export present per the ticket's `required_wiring` anchor
(BL-1371); `grep -n '</dev/null' check_bb_scripts_load.sh` confirmed
present at both the probe and boot call sites (the other anchor).

No leftover fixture temp dirs after my own manual runs (cleaned up any I
created outside the normal afterEach lifecycle).

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. This is a load-bearing fix to
the pipeline's own commit-time and land-time safety machinery, verified
directly against the real guard rather than taken on faith. Forwarding to
hardener.
