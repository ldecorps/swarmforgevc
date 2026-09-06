# Pre-commit guard chain reports every violation in one refusal (BL-1252)

*How-to. Task-oriented: understand why a refused commit now lists more
than one guard, and how to clear it.*

Pre-commit-time aggregation, sibling to the commit-msg-time aggregation
[`check_merge_deletion.sh`](BL-1242-merge-deletion-guard.md) already uses
(BL-1242): `swarmforge/scripts/run_commit_guards.sh`, wired into
`swarmforge/git-hooks/pre-commit` in place of four sequential guard calls.

## What changed

The hook used to run four guards as four sequential commands under
`set -euo pipefail`:

```
check_commit_size.sh 50
check_ticket_deletion.sh
check_pipeline_code_on_main.sh
check_property_suite_drift.sh
```

All four end in their own `exit 1`, so the first one that refused aborted
the hook and the rest never ran. A commit that violated three guards at
once cost three separate commit attempts: fix the size, re-commit, learn
about the deletion, fix it, re-commit, learn about the pipeline paths.
Constitutional Article 4.4 forbids exactly that shape of a reviewing role —
"never bounce at the FIRST defect; finish the full checklist, send one
bounce with every defect" — and a pre-commit hook is a reviewing gate.

Now `run_commit_guards.sh` runs the guards under `set -uo pipefail` (no
`-e`), captures one exit status per guard, and reports every violation it
found in a single refusal. Each guard's own script still enforces its own
`set -euo pipefail`, so no guard's predicate, threshold, or exemption
changed — only the completeness of the report.

## The two tiers

The guards are not equally cheap. `check_property_suite_drift.sh` runs
`npm run test:properties`; every other guard only reads the git index (or,
for the two handler guards below, the step registry / a tree's module
graph) and exits. So the runner groups them:

- **Tier 1 (cheap):** `check_commit_size.sh`, `check_ticket_deletion.sh`,
  `check_pipeline_code_on_main.sh`, `check_feature_handler_registration.sh`
  (BL-1303 — a `main`-only guard proving a feature's handler is registered
  and reachable), `check_handler_module_graph.sh` (BL-1385 — a
  sibling `main`-only guard proving that same handler's require graph
  actually RESOLVES on the tree; registration is not loadability, and a
  hand-land bypasses the land replay's own tree guard entirely, so the
  load question has to be asked here too), and `check_bb_scripts_load.sh`
  (BL-1395 — every `.bb` script under `swarmforge/scripts/` that the
  commit changes is `bb -e '(load-file ...)'`-probed against the tree
  under test, naming file/line/symbol on a Babashka SCI analysis failure;
  `handoffd.bb` specifically is BOOTED against a fixture root and waited
  for one heartbeat, since SCI analyses each `defn` eagerly and only
  running the whole file in order proves a forward reference absent — see
  "A landed daemon script is booted before it is published" below), and
  `check_test_file_registration.sh` (BL-1424 — a staged addition directly
  under `swarmforge/scripts/test/` matching `suite_inventory_lib`'s
  `test-file?` with no row in the STAGED `suite-manifest.tsv` refuses,
  naming the file and quoting the row it needs; judges only the commit's
  own staged additions, never pre-existing drift, so a hotfix straight
  onto `main` — the one commit shape BL-1240's send-time gate can never
  see — meets it too) — all seven always run, and if any refuses, the
  commit is refused with every Tier-1 violation named. Tier 2 is never
  reached.
- **Tier 2 (expensive):** `check_property_suite_drift.sh` — reached only
  once every Tier-1 guard passes, so the property suite is never charged
  to a commit that is already refused for a cheap reason. It still runs
  on every commit that Tier 1 allows — deferring it never means skipping
  it.

Guard order inside Tier 1 is unchanged (each new guard appends), so a
commit with exactly one violation still sees the same message it did
before this change.

## If you hit this refusal

```text
pre-commit: COMMIT REFUSED. Guards reporting a violation: check_commit_size.sh check_ticket_deletion.sh
pre-commit: every guard in this tier ran, so the list above is complete - there is no second violation waiting for your next attempt (Article 4.4).
```

Fix every guard named on the `Guards reporting a violation:` line and
retry — there is no second violation still hidden behind the first.

An unexpected non-refusal exit (a crash, a missing script) is called out
separately and still refuses the commit:

```text
pre-commit: these guards did not refuse cleanly - they failed unexpectedly (a crash, a missing script, or any non-refusal exit): check_pipeline_code_on_main.sh (exit 127)
pre-commit: an unexpected failure still refuses the commit; it is never collected as a pass.
```

## A landed daemon script is booted before it is published (BL-1395)

Babashka's SCI analyses a `defn`'s body eagerly, but only when the FILE is
loaded — a symbol reference that does not exist (a typo'd built-in, a
forward reference to a `defn` written further down the file) fails at
load, not at grep time. Three times in eight days a `.bb` script with such
a defect reached `main` unseen: BL-1381 (`shift_schedule_applier_lib.bb`,
crashed every consumer for eight days), and twice on 2026-09-04 for
`handoffd.bb`'s `cron-heartbeat-state` (a call to a `read-json` function
that does not exist) — caught once by the hardener, then **reintroduced by
QA's own hand-splice at land**, whose verification was three greps for
`required_wiring` labels rather than an actual load. The live daemon
crash-looped from 18:20Z with no wakes, chases, sweeps, reconcile, or
nudges running.

Nothing on the commit path or the land path loaded a changed `.bb` file
before this ticket — and `handoffd.bb` ended with a bare `(-main)`, so
even a willing `load-file` probe would have STARTED the daemon instead of
analysing it.

- **The probe**: `check_bb_scripts_load.sh` runs `bb_load_analyse_driver.bb`
  (BL-1427, below) against a checkout of the tree under test (never the
  checker's own worktree — a script that loads there but not on the tree
  still refuses) for every `.bb` file the commit or the land's replayed
  tree changes. A failure names the file, line, and symbol.
- **`handoffd.bb` is BOOTED, not just loaded**: the guard starts it against
  a `mkdtemp` fixture root and waits for one heartbeat line, bounded,
  because SCI analysing each `defn` in isolation cannot prove a forward
  reference absent — only running the file start-to-finish can, which is
  exactly the shape of defect that hid for eight days and slipped back in
  at land.
- **The guarded `(-main)`**: `handoffd.bb` now ends with
  `(when (= *file* (System/getProperty "babashka.file")) (-main))` — the
  same idiom `apply_shift_schedule.bb`, `babysitter_waive.bb`, and
  `bob_starting_cast_cli.bb` already used. `load-file`d for analysis, it
  now analyses silently and exits 0 without starting the daemon; run
  directly as a script, it still boots normally.
- **Wired into both publish paths**: `run_commit_guards.sh` (so a
  hand-splice on `main` meets it, same as the crash that motivated this
  ticket) and `land_step_lib.bb`'s tree-guard list (so a land replay meets
  it too) — a hand-built land that skips the replay still hits the
  commit-time copy.
- Fixture roots are per-invocation, reaped by dead owner pid or age bound
  — never a blind prefix sweep (BL-1385/BL-1390's guardrail, carried
  forward here too).

## The probe covers every listed script and runs none of them (BL-1427)

Traced 2026-09-05 with `bash -x check_bb_scripts_load.sh --all`: the guard's
own coverage claim was false in two independent ways.

1. **A drained loop.** The probe's `bb -e '(load-file ...)'` process
   inherited the loop's own stdin. `harness_env_scrub_names.bb` (sorted
   107th of 286 that day) ends with `(apply -main *command-line-args*)`,
   and its `-main` does `(slurp *in*)` — that one script's analysis
   swallowed the REST of the file list from the loop's stdin, so `--all`
   analysed 107 scripts and silently reported the other 178 as clean.
   `post_qa_branch_sweep.bb` (BL-1426's unreadable wrapper, sorted 186th)
   was never even reached. The pass line's "N changed script(s) analysed"
   counted what was LISTED, not what actually ran.
2. **Executed entry calls.** The probe load-filed each script as-is, so its
   trailing top-level entry call ran with an empty `*command-line-args*`.
   A script whose `-main` has a fixed, non-empty arity (`check_swarm_detached.bb`,
   `clear_identical_untracked_and_merge.bb`) threw `ArityException` at
   analysis time and refused every commit that touched it, even though both
   load and run correctly when actually invoked with arguments. A script
   ending in a bare `(-main)` would have RUN for real from inside the
   guard — `post_qa_branch_sweep.bb` would have fetched `origin` and swept
   the live worktrees from a guard probe, had it parsed at all.

Two fixes, invariant-scoped rather than loosened:

- **The probe reads no stdin** (`</dev/null` on the `bb` invocation and on
  `handoffd.bb`'s boot step) — a script that slurps stdin can no longer
  drain the loop that feeds every later script to the probe.
- **`bb_load_analyse_driver.bb`** reads and evaluates every top-level form
  of the target file IN ORDER, exactly like a normal load, except it never
  EVALUATES a call whose head is `-main` (bare, with
  `*command-line-args*`, or through `apply`) — that form is still READ (a
  reader error in it still refuses), just never run. Every `def`/`defn` is
  still evaluated eagerly, so SCI's own eager analysis of a `defn`'s body
  (a missing symbol, a bad forward reference — the exact BL-1395 class of
  defect) still fails exactly as before; only the trailing entry call is
  skipped. The three legal entry-call shapes are unchanged — no script's
  own convention had to change, only what the guard does with it.
- **The listed count and the analysed count are now compared**: a gap
  between what the guard's own loop listed and what the probe actually
  reached is itself a refusal, naming the scripts never analysed — the
  guard can no longer silently under-report its own coverage the way the
  drained loop did.

On main after this ticket, `check_bb_scripts_load.sh --all`'s analysed
count equals every `.bb` file under `swarmforge/scripts` minus one
(`handoffd.bb`, which is booted, not analysed) — before this ticket the
same run reported 107.

## Where it lives

| Piece | Location |
| --- | --- |
| Aggregating runner | `swarmforge/scripts/run_commit_guards.sh` |
| Wired into | `swarmforge/git-hooks/pre-commit` (`exec`'d as the hook's whole body) |
| Acceptance steps | `bl1252CommitGuardCompleteInventorySteps` (`specs/pipeline/steps/index.js`) |
| Acceptance feature | `specs/features/BL-1252-commit-guard-chain-reports-every-violation.feature` |

## Related

- BL-1242 (`check_merge_deletion.sh` / commit-msg hook) — the sibling
  aggregation this runner's shape is modelled on: `set -uo pipefail`
  across the chain, one status per call, one combined refusal.
- Article 4.4 (complete review inventory, one bounce per pass) — the
  constitutional rule this mechanical gate now also follows.
- BL-1385 (`check_handler_module_graph.sh`) — the sibling Tier-1 guard
  proving a handler's require graph resolves; BL-1395 asks the same
  "does this actually load" question of every `.bb` script, not just
  handler modules.
- BL-1381 — the earlier, eight-day-silent instance of the same class of
  defect (`shift_schedule_applier_lib.bb`) that established the need for
  this guard.
- BL-1427 — the drained-loop and executed-entry-call fixes to this same
  guard's probe (above); BL-1426 — the unreadable wrapper
  (`post_qa_branch_sweep.bb`) the drained loop let reach `main` unseen.
- BL-1424 (`check_test_file_registration.sh`) — the commit-time sibling of
  BL-1240's send-time `unregistered_test_gate_lib.bb`, closing the one
  path (a hotfix committed straight onto `main`) BL-1240 can never see;
  deliberately NOT added to `land_step_lib.bb`'s tree-guard list (that
  would judge the whole tree, not the commit's own additions).

## Verify

```bash
bash swarmforge/scripts/test/test_run_commit_guards.sh
npx vitest run --config vitest.properties.config.mjs test/bl1252CommitGuardAggregationInvariants.property.test.js
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1252-commit-guard-chain-reports-every-violation.feature
bash swarmforge/scripts/test/test_bl1395_bb_scripts_load.sh
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1395-a-landed-daemon-script-is-booted-before-it-is-published.feature
npx vitest run --config vitest.properties.config.mjs test/bl1427LoadGuardCoversEveryScriptInvariants.property.test.js
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1427-the-load-guard-covers-every-script-and-runs-none.feature
bash swarmforge/scripts/test/test_check_test_file_registration.sh
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1424-a-commit-that-adds-a-test-file-registers-it.feature
```
