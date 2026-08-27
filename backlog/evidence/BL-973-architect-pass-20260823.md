# BL-973 — architect pass

Received from cleaner as `merge_and_process cleaner be97fafe69` (cleaner
forwarded coder's fix commit `e556eca1b` unchanged — the merge commit carries
no cleanup diff of its own; `git log --oneline e556eca1b..be97fafe69` shows
only unrelated merge-up ancestry, no cleaner-authored content commit).

## Required hard gate — dependency-rule checker (BL-259)

This parcel's changed files straddle `extension/` and repo-root paths, so
ran the full-repo scan (`node out/tools/dependency-gate.js`, no args, per
[[bl259-dependency-gate-and-npx-namespace-trap]]). Reports the same 3
pre-existing `acyclic` violations among `telegram-front-desk-bot.ts` /
`telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts` already
documented in `backlog/evidence/BL-1061-architect-followup-note-20260822.md`
as baseline debt ticketed BL-759 — confirmed none of those three files are in
this parcel's changed-file set (`git diff --name-only 094ed768e...e556eca1b`).
Not this parcel's to fix.

## Co-change coupling (BL-255)

Ran against all 19 changed files. The five fixture files (`bl814...Steps.js`,
`bl487...Steps.js`, `readLiveRoleHeldTicketsCli.test.js`, plus
`bl973CopyListsClosureDerivedSteps.js`/`index.js`) show mutual "SUSPECTED
COUPLING" — exactly the coupling the ticket exists to formalize: they are the
"five lists" family the parcel unifies behind one shared closure-gate library.
Expected, by design, not accidental drift.

## Invariants Review (BL-633/654) — both declared, both encoded, non-vacuous

Swept every site for each invariant rather than trusting the coder's summary:

**Invariant 1** (derive-or-gate against the entry point's real closure) — all
five sites checked individually against their diffs:
- `bl814LiveRoleHeldLoudDegradeSteps.js`, `bl487BoardFreshnessWithout...Steps.js`,
  `extension/test/readLiveRoleHeldTicketsCli.test.js`: all three now compute
  `REQUIRED_SCRIPT_FILES` via `computeClosure(REAL_SCRIPTS_DIR,
  'pipeline_stage_cli.bb')` and export `BB_FIXTURE_CLOSURE` for the gate to
  read — genuinely derived, not hand-list-plus-comment.
- `test_lean_ledger_bb_wiring.sh`: hand `cp` list replaced by
  `copy_bb_closure "$SCRIPT_DIR/.." "$fixture_scripts" done_with_current_task.bb`.
  Confirmed no other hardcoded `cp "$SCRIPT_DIR...` list remains in the file.
- `lib/operator_runtime_sandbox.sh`: 45-name hand list replaced by 9 declared
  entry points (`operator_runtime.bb` + 8 named siblings, each with a reason
  in the comment) fed through the same `copy_bb_closure`; correctly applies
  the BL-801 `${arr[@]+"${arr[@]}"}` empty-array idiom for bash 3.2.
- Confirmed `specs/pipeline/steps/lib/operatorRuntimeBbClosure.js` (BL-944's
  `computeClosure`) is untouched by this parcel (`git diff --stat` empty),
  matching the ticket's constraint not to restructure it.

**Invariant 2** (no test sits unrun) — `suite-manifest.tsv` accounts for 360
tracked files (356 standing + 4 excluded, verified by `awk` count, matches
evidence); the 4 exclusions are all dated 2026-08-23 with a live-tmux/
kill_all_swarm.sh reason, none a masked failure.

Both invariants have dedicated bb property runners, re-run myself rather than
trusting the coder's numbers:

```
bl973_closure_guard_property_runner.bb:
  120 runs, coverage {:deep-chain 120, :diamond 111, :multi-root 95,
  :unreachable-present 120, :edge-added 120} — ALL PROPERTIES HOLD
bl973_suite_inventory_property_runner.bb:
  200 runs, coverage {:all-good 21, :unlisted 59, :orphan-row 44,
  :bad-lane 95, :undated 80, :unreasoned 104, :duplicate 33} —
  ALL PROPERTIES HOLD
```

Numbers match the coder's evidence exactly.

## Property Testing pass (undeclared coverage)

No further property test warranted. Both declared invariants already carry
dedicated, break-then-fix-verified property runners exceeding the usual bar;
`bbFixtureClosureGate.js`'s `effectiveList`/`missingFromList` and
`suite_inventory_lib.bb`'s `check` are exercised under generation by those
same runners (independent second reachability implementation for the closure
side, per BL-897). No touched pure module is left undercovered.

## Verification run myself (not just re-reading the coder's evidence)

Rebuilt `extension/out` first (stale-build precedent,
[[architect-merge-before-reading-ticket]]-adjacent caution).

| check | result |
|---|---|
| `bb_load_closure_agreement_test_runner.bb` | ok — 4 entry points agree |
| `suite_inventory_lib_test_runner.bb` | ok |
| `test_lean_ledger_bb_wiring.sh` | ALL PASS (6/6, A1-3 + B1-3) |
| `bl973_closure_guard_property_runner.bb` | ALL PROPERTIES HOLD (120 runs) |
| `bl973_suite_inventory_property_runner.bb` | ALL PROPERTIES HOLD (200 runs) |
| `readLiveRoleHeldTicketsCli.test.js` (vitest, targeted) | 8/8 pass |
| BL-973 acceptance feature | 13/13 in this worktree's stray-free clean sibling worktree (see below) |
| BL-487 acceptance feature | 2/2 |
| BL-814 acceptance feature | 6/6 |

### A worktree-local false red, not a parcel defect

Running BL-973's own new scenario 03 directly in this worktree scored 12/13:
`FAIL: not in the manifest: test_swarm_handoff_mono_router_auto_rotate.sh`.
That file is an untracked stray sitting in `swarmforge/scripts/test/` in
*this* worktree only (confirmed already known and ticketed BL-724, predates
this parcel, not created by the coder or cleaner — `git diff --name-only`
confirms it is absent from their commits). To separate worktree hygiene from
parcel correctness, added a detached `git worktree add` at this parcel's
merge commit (no stray file there) and re-ran: 13/13 clean. Removed that
verification worktree afterward (own scratch artifact). This is the new
suite-completeness gate correctly doing its job against ambient worktree
debt, not a defect in the parcel — nothing to bounce, nothing to sweep (not
mine to touch per "never delete what you did not create").

## Architecture rules

Two-layer/webview/host-I/O/browser-storage/secrets boundaries: not applicable
in the usual sense — this parcel's `extension/` touch is a single test file
(`readLiveRoleHeldTicketsCli.test.js`), not extension-host or webview
production code. The new decision logic
(`specs/pipeline/steps/lib/bbFixtureClosureGate.js`,
`bb_load_closure_lib.bb`, `suite_inventory_lib.bb`) is pure, with I/O
(subprocess shell-outs, fs reads) confined to thin CLI/gate wrappers —
correct dependency direction, matches the CLI-thin-wrapper precedent. No
SwarmForge source was modified or forked further; the parcel only reads
behavior of existing `.bb` scripts via subprocess, never parses them for
literals (explicitly the point, per BL-897).

## Correctness read

One observation, not bounce-worthy: the two new step-handler cleanup sites in
`bl973CopyListsClosureDerivedSteps.js` (`the closure check fails naming the
new dependency` and `the inventory check fails naming that test file`) call
`fs.rmSync` on their scratch dir *after* the scenario's own assertion rather
than in a `finally` — if the assertion itself throws (the guard being tested
is broken), the scratch dir under `os.tmpdir()` leaks. This is the letter of
the shared Test Speed And Isolation rule ("removed in a finally... a throw
otherwise leaks it forever"), and the same file gets this right elsewhere
(`bbFixtureClosureGate.js`'s `shellCopyList`, explicitly commented BL-971).
But sampling three unrelated pre-existing step files with `mkdtempSync`
(`bl817FixtureTmuxServersReapedSteps.js`, `bl646DaemonAlarmFixtureLeakSteps.js`,
`bl943FixtureCleanupVerdictSteps.js`) shows zero use of `finally` either —
this is the ambient, unenforced convention across the ~200 existing
`mkdtempSync` call sites in `specs/pipeline/steps/`, not new debt this parcel
introduced. It differs from BL-971's motivating incident (a leaked fixture
landing *inside* a suite's own discovery glob, causing a false red): a random
`os.tmpdir()` scratch dir here is invisible to every discovery mechanism in
this repo, so the failure mode is limited to a harmless stray directory on a
run that is already red for a real reason. Bouncing this one parcel alone for
matching ~200 untouched siblings' existing shape would be disproportionate
and inconsistent; noted here for visibility rather than gated on.

## Verdict

COMPLIANT. No architecture violation, no invariant violation, no correctness
defect. Forwarded to hardener.
