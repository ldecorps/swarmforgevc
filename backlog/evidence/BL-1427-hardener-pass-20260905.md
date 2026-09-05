# BL-1427 — hardener pass, 2026-09-05

Ticket: BL-1427-the-load-guard-covers-every-script-and-runs-none
Commit reviewed: fa8244f670 (cleaner) / 1498b010b7 (architect, NONE pass)

## Result: NONE — no defect found; BL-113 mutation clean (3/3 killed)

This is a load-bearing fix to `check_bb_scripts_load.sh`, the cheap-tier
commit guard and land-replay tree guard that runs on every commit
including this hardening pass's own — reviewed with the same care given
to BL-1411 and BL-1428 earlier this session.

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `BB_LOAD_ANALYSE_TARGET=check_swarm_detached.bb bb bb_load_analyse_driver.bb </dev/null` | exit 0 (was ArityException) |
| `BB_LOAD_ANALYSE_TARGET=clear_identical_untracked_and_merge.bb bb bb_load_analyse_driver.bb </dev/null` | exit 0 (was ArityException) |
| `bash check_bb_scripts_load.sh --all` (real 293-file tree) | 1 failure — `post_qa_branch_sweep.bb` only (BL-1426's own out-of-scope defect, not yet landed in this worktree) |
| `npx vitest run --config vitest.properties.config.mjs test/bl1427...Invariants.property.test.js test/bl1395BbScriptsLoadGuard.property.test.js` | 3/3, 3/3 |
| `node specs/pipeline/cli.js specs/features/BL-1427-...feature` | 6/6 scenario runs |
| `bash test_bl1395_bb_scripts_load.sh` (regression) | 16/16 PASS |
| `bash test_run_commit_guards.sh` (regression) | 12/12 PASS |
| `test_model_steward_cli.sh`, `test_model_factory_cli.sh`, `test_bl1390_post_commit_push.sh`, `pack_staffing_gate_lib_test_runner.bb` (regression for the four collateral-fix files) | ALL PASS |
| `grep -n "</dev/null" check_bb_scripts_load.sh` | present on probe + boot step (required_wiring) |
| `bl1427LoadGuardCoversEveryScriptSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (one Scenario Outline, 3 examples)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1427-the-load-guard-covers-every-script-and-runs-none.feature
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4
positionals explicit, workdir removed after). Result: **3 mutants, 3
killed, 0 survived** (the `<entry>` example cells, single-letter case/char
flips) — clean. Manifest stamp committed alongside this evidence.

## Read `bb_load_analyse_driver.bb` directly for edge cases

Traced several boundary cases beyond what the prior three roles'
evidence explicitly walks through:

- **`entry-call?` matches ANY call headed by `-main`, not only the three
  literal argument shapes the ticket's survey found** (`(= head '-main)`
  checks only the head symbol, never the argument list) — this is
  correctly MORE robust than the ticket's literal framing: a
  hypothetical fourth shape like `(-main "foo" "bar")` would still be
  correctly skipped, not merely the three shapes the survey happened to
  find. Not a gap; a deliberately conservative predicate.
- **A nested `(-main)` call is NOT caught** — `entry-call?` only inspects
  whether a TOP-LEVEL form's head is `-main`/`apply`; a form like
  `(some-fn (-main))` would be evaluated whole, actually running `-main`
  as a side effect. Confirmed this shape does not exist in the current
  tree (the ticket's own survey found only the three top-level-call
  shapes; none nested) — a real but currently unreached edge, correctly
  out of this ticket's scope per its own "the three shapes stay legal;
  the guard learns to read them, none invented" framing. Worth noting for
  a future script author, not a defect to chase here.
- **`strip-shebang` handles CRLF correctly**: `indexOf("\n")` finds the LF
  even in a `\r\n` line ending, and `subs text (inc nl)` drops the `\r`
  along with everything up to and including the `\n` — traced by hand,
  not merely assumed.
- **`*file*` binding and CWD are consistent**: `analyse_one` does
  `cd "$SCRIPTS_DIR"` before invoking the driver with the bare relative
  filename as `BB_LOAD_ANALYSE_TARGET`, so a script that does
  `(fs/canonicalize *file*)` resolves correctly against the real scripts
  directory — matching how these scripts already behave when run
  directly (`bb <script>` invoked from within `swarmforge/scripts`).

No gap found in any of these. The property tests' real-subprocess
coverage (P1/P2/P3 all drive the real shell guard over real fixture
trees) already proves the mechanics this manual read confirms by
inspection.

## Design/CRAP/DRY

No production code changed by this pass. Babashka/shell have no
mutation/CRAP/DRY tooling wired (BL-472 deferred, cleaner already
confirmed `jscpd` finds 0 clones); gated by the unit/property/acceptance
suites above plus the clean BL-113 gherkin-mutation pass.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
