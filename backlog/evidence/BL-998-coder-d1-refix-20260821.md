# BL-998 — coder, D1 re-fix after the cleaner bounce

- **Bounce**: `backlog/evidence/BL-998-cleaner-bounce-20260821.md` (cleaner, `90aee07f8`).
- **Spec correction merged first**: `62370af74` (specifier), which upholds D1 in
  full, corrects the `constraints:` block, and — answering the cleaner's open
  question directly rather than deferring it — rules that the derived guard
  **must** follow `process/exec` of siblings.
- Merged before working, per the amend-in-flight rule (`note`
  `20260821T124552Z_000359`: "BL-998 spec corrected 62370af74. Merge main,
  re-read ticket.").

## D1 — fixed at the derivation, not at the call sites

D1 is a two-part defect and only fixing both closes it. The unsafe call sites
were a symptom; the cause is that the guard read "what a test executes" exactly
one hop deep, so it classified `done_with_current_task.bb` as a leaf for the
same reason the ticket's own constraints did.

**Cause — step 1 of the guard now closes over sibling process invocations.**
Self-rooting is transitive. Nothing inside `done_with_current_task.bb` resolves
a root, and it escapes the fixture anyway: `run-ready!` is
`(process/exec (str (fs/path script-dir "ready_for_next_task.sh")) "--idle-boundary")`
with `script-dir` = `(fs/parent *file*)` — the directory of the file **on
disk**, not cwd — and that wrapper opens with `cd "$(dirname "$0")"`. The guard
now builds an edge list (one `grep -l` narrows ~300 scripts to the few dozen
that start a process at all, then one pipeline each) and iterates it to a
fixpoint. Only real process invocations are edges: `load-file` of a sibling lib
uses the identical `(fs/path script-dir …)` shape but runs **in-process**, where
the root still comes from cwd, so counting it would make nearly every helper
self-rooting and flag correct tests.

The closure derives exactly four additions and no others:

| newly self-rooting | via |
|---|---|
| `done_with_current_task.bb` | `process/exec` → `ready_for_next_task.sh` |
| `done_with_current_batch.bb` | `process/exec` → `ready_for_next_batch.sh` |
| `kill_pipeline_swarm.sh` | → `sweep_all_inbox.sh` |
| `kill_all_swarm.sh` | → `kill_pipeline_swarm.sh` |

The first two are precisely the pair found by hand — the coder's earlier
Finding 2 (batch) and the cleaner's D1 (task). The derivation reproduces both
without being told either. No test executes the `kill_*` pair from a real-dir
binding, so they add no offenders.

**Symptom — every offending call site now dispatches through its fixture copy.**

## A seventh offender, found by the guard rather than by hand

Re-running the widened guard flagged a file that appears in neither the
ticket's list of five nor the bounce: **`test_sidecar_tolerant_completion.sh`**,
on BOTH `$DONE_TASK` and `$DONE_BATCH`, across five fixture roots. It was
passing, and passing for the reason the ticket describes: its assertions grep
`^COMPLETED:` out of the first captured line, so the escaped-to real helper's
output lands in the same capture unchecked. This is invariant 2 doing its job —
a guard that named today's known offenders would have shipped this one intact.

## Files changed

| File | Change |
|---|---|
| `test_shell_fixture_dispatch_isolation.sh` | step 1b: fixpoint closure over sibling process invocations |
| `bl998_guard_membership_property_runner.bb` | invariant 2 property: `:direct` / `:transitive` / `:leaf` axis, generator reach asserted over all 12 combinations |
| `test_idle_clear_respawn.sh` | `DONE_TASK` → each fixture worktree's own copy (onrole + offrole; offrole had no `install_scripts` at all) |
| `test_handoff_state_dir_worktree_root.sh` | `DONE_TASK` → the coder fixture's copy |
| `test_sidecar_tolerant_completion.sh` | `install_scripts` in `mk_root`; `DONE_TASK`/`DONE_BATCH` → each root's own copy |

### One item of the cleaner's remediation declined, with reason

The cleaner also asked for `READY_TASK` in `test_handoff_state_dir_worktree_root.sh`
to be converted "for symmetry/safety". **Not done**, and the amended spec is why:
its corrected constraint keeps "Do NOT convert a TRUE leaf", and new qa step 7
asks QA to confirm those calls were *not* converted unnecessarily.
`ready_for_next_task.bb` is a true leaf — 0 `process/exec`, its
`(fs/parent *file*)` uses are `load-file` only — and my edge scan finds it has no
sibling-invocation edge at all, so the guard **derives** its leaf-ness rather
than being told it. The safety the symmetry request was buying is exactly what
step 1b now buys automatically: add a tail call to that helper tomorrow and the
guard closes over it on the next run and flags the line. Converting it would be
churn against a protection that is already mechanical. The call site is
commented in place with this reasoning.

## Verification

| Check | Result |
|---|---|
| `test_shell_fixture_dispatch_isolation.sh` | PASS (12s — the `grep -l` pre-filter keeps the closure roughly cost-neutral) |
| `bl998_guard_membership_property_runner.bb` | ALL PASS, 96 runs, generator reach asserted for all 12 (kind × anchor × executed) combinations |
| `test_idle_clear_respawn.sh` | 4/4 — including scenario 01, which the bounce recorded as crashing before printing a line; the cleaner's Finding 3 respawn failure is resolved with it |
| `test_handoff_state_dir_worktree_root.sh` | 7/7 |
| `test_sidecar_tolerant_completion.sh` | 5/5 |
| `test_compliance_battery_cli.sh` | 8/8 |
| `test_dispatch_lib_receive_mode.sh` | 5/5 |
| `test_reference_freshness_guard.sh` | 4/4 |
| `test_ready_for_next_no_promotion.sh` / `test_ready_for_next_rotate_home.sh` / `test_backlog_depth_conf.sh` | 4/4, 9/9, 10/10 (unchanged, re-run as controls) |
| `specs/features/BL-998-…feature` | 5/5 |

### Extension unit suite — passing, but the lane exits 1, and not on my account

`npm test`: **457/457 files, 8070/8070 tests passed**, recorded in
`.test-durations.jsonl` as `"result":"pass"` (the previous five recorded runs
are `"fail"`). The process still exits 1, from the *other* half of
`recordTestDuration.js`: `computeFinalExitCode(testExitCode, guardExitCode)`,
where `guardExitCode` is the BL-378 per-file duration budget guard. It reports
623.5s against a 10s suite budget and 13 files over the 7s per-file budget.

Reported rather than waved through, and equally not claimed as green. It is not
this parcel's: the 13 offenders are `bl968StepRegistryMaterializedTreeGuard`,
`blTopicStore`, `briefingDigestLineCli`, `config`, `drainAnswerFilesCli`,
`epicMakeTopBridge`, `epicReorderBridge`, `recordBounceCli`,
`renderBriefingBurndownCli`, `renderBriefingDiagramsCli`, `swarmLauncher`,
`telegramFrontDeskBotCli`, `topicMakeTopBridge` — every one a TypeScript test
file, and this parcel changes no TypeScript at all (5 shell/bb files under
`swarmforge/scripts/test/` plus this evidence file). Two aggravating conditions
worth stating so nobody reads the number as a regression: the operator recorded
this box at load 37-44 on 4 cores, and I ran the BL-998 property lane (~33s)
concurrently with the tail of this suite, which will have inflated whichever
files were in flight. Neither explains 623s against a 10s budget — that is a
standing condition, and out of scope here under BL-506.

### Invariant 1, measured rather than asserted (amended qa step 6)

`shasum` of **every file** under `.swarmforge/handoffs/` in all 8 worktrees
(project root + 7 role worktrees), before and after running the six affected
suites back to back: **7629 files byte-identical**. The single delta in the raw
snapshot was
`.worktrees/QA/.swarmforge/handoffs/inbox/new/…_from_documenter_to_QA_for_QA.handoff.chase.json`,
whose content is `{"chaseCount":5,"lastChasedAtMs":…}` — the live chaser
daemon's own monotonic telemetry for a QA parcel, in a worktree no test in this
set touches. A control snapshot around a test-free interval was identical, and
no test in the suite writes a `.chase.json` anywhere.

This is the check the amendment asked for specifically because a green run is
not evidence here. My own in-process parcel
(`00_20260821T122952Z_000295_from_cleaner_to_coder_for_coder.handoff`) was
present and unmodified throughout — before the fix, `test_sidecar_tolerant_completion.sh`
would have run the real `done_with_current_task.bb` against it.

### Whole-suite sweep, independent of the guard (amended qa step 6)

The guard decides on a variable bound to a real-dir path and then executed, so
I swept the shell suite separately for a real-dir reference to any
receive/completion helper **in any form**, including ones with no variable
binding at all. Seventeen hits, all accounted for:

- Fourteen bind `ready_for_next_task.bb` / `ready_for_next_batch.bb` — both TRUE
  leaves, checked rather than assumed: zero self-rooting matches and no sibling
  process invocation in either. Their only `process/sh`/`sh/sh` calls are `git`
  (`ready_for_next_task.bb` passes `-C <root>` explicitly; `ready_for_next_batch.bb:77`
  runs `git rev-parse` in cwd, which IS the fixture). Legal, and left alone.
- Two bind the `ready_for_next.bb` dispatcher without executing it
  (`test_backlog_depth_conf.sh`, which the ticket excludes by name, and
  `test_ready_for_next_no_promotion.sh`, which greps its own dispatcher for a
  symbol while dispatching through the fixture copy). Both correct.
- One references a completion helper: `test_lean_ledger_bb_wiring.sh:96` `cp`s
  `done_with_current_task.bb` into its own fixture scripts dir **and stubs a
  `ready_for_next_task.sh` next to it** — that test already understood the
  tail-call mechanism, and its comment at :81 says so. Not an execution from the
  real tree, and independent corroboration of the mechanism.

So after this parcel **no shell test executes a `done_with_current_*` helper
from the real scripts dir**, by inspection and not only by the guard agreeing.

### Non-vacuity (qa step 8), proven two ways

1. **Closure removed** (`if false && is_self_rooting "$sib"`): the property fails
   on exactly the `:transitive` cases —
   `{:helper "done_with_current_batch.bb", :helper-kind :transitive, :anchor :real-dir, :executed? true, :expect-flagged true}`
   — and the guard goes green against the fixed tree, i.e. blind again. Restored.
2. **Throwaway offender**, created and swept by prefix: a test executing
   `$SCRIPT_DIR/../done_with_current_task.bb` is flagged AND named
   (`test_bl998_throwaway_offender.sh:$H -> done_with_current_task.bb`). With it
   removed, the two safe shapes left standing — a fixture-installed dispatch and
   a direct `ready_for_next_task.bb` leaf call from the real scripts dir — both
   pass. Confirms qa steps 5 and 7 together.

## Notes for the next stage

- No size escape hatch taken: the amendment permitted shipping one-hop detection
  and raising a sibling ticket for deeper transitivity. Full transitive closure
  fit in this slice, so it is here.
- **For the cleaner — `install_scripts` is now duplicated five times**
  (`test_ready_for_next_no_promotion.sh`, `test_ready_for_next_rotate_home.sh`,
  `test_idle_clear_respawn.sh`, `test_handoff_state_dir_worktree_root.sh`,
  `test_sidecar_tolerant_completion.sh`), three of them added by this ticket and
  one of those by me. The bodies are identical - the ticket's own "How" says the
  pattern was ported verbatim - and `swarmforge/scripts/test/lib/` already exists
  as a home for shared test helpers (`tmp_cleanup.sh`, sourced by the sidecar
  test). Deliberately NOT extracted here: it is refactoring rather than behavior,
  it does not block the slice, and two of the five copies are outside anything
  this parcel touches, so hoisting them would widen a bounce re-fix diff across
  files QA is not comparing. Flagged for the stage that owns DRY.
- Untracked and NOT mine, surfaced rather than swept:
  `swarmforge/scripts/test/fixtures/daemon_log_freshness.fixture.conf`, present
  at session start (timestamped 09:25), left untouched and uncommitted.
- The transitive shape gained no acceptance scenario: the specifier's amendment
  states "No scenarios added, so no new step handlers are needed". It is covered
  instead by the property runner's `:transitive` axis, with generator reach
  asserted so the coverage cannot silently lapse.
