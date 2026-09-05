# Nine guarded fixture copy-lists, and a standing test-suite inventory (BL-973)

Nine fixtures build a disposable root by copying a named list of `.bb` files,
then shell out to a real `bb <entry-point>` subprocess. Babashka resolves
every `load-file` relative to the loading file, so a file missing from the
copied set is missing from the fixture, and the subprocess dies at load time —
before the scenario or test reaches the behavior it means to exercise.

This is the same failure mode [BL-944](BL-944-operator-runtime-fixture-closure-guard.md)
closed for one list (`operatorRuntimeBbFixtureFiles.js`, driving
`operator_runtime.bb`). BL-973 extends the same discipline — derive or
gate-check a copy-list against the real transitive `load-file` closure of the
entry point it drives, never hand-maintain it bare — to the other four lists,
because a hand-patch naming "today's missing files" reliably re-rots on the
next upstream `load-file` edge: it happened three times
(BL-911's `prompt_engine_lib.bb`, BL-967's `daemon_cycle_guard_lib.bb`,
BL-1029's `shell_quote_lib.bb`), each time reddening two acceptance features
and a shell test with a stack trace naming a file no scenario mentions.

## The entry point is per-fixture, not one shared script

Each fixture drives its own CLI, and the closures differ in size:
`pipeline_stage_cli.bb` and `done_with_current_task.bb` each pull
`pipeline_stage_lib.bb` on top of `handoff_lib.bb`'s set, while
`operator_runtime.bb` pulls twenty-four more. A guard pinned to one script
(e.g. `handoff_lib.bb`) would green a fixture that is missing its own CLI's
direct dependency. `specs/pipeline/steps/lib/bbFixtureClosureGate.js` pairs
each fixture with the entry point it actually drives:

| fixture | entry point | how its effective list is read |
|---|---|---|
| `specs/pipeline/steps/bl814LiveRoleHeldLoudDegradeSteps.js` | `pipeline_stage_cli.bb` | `BB_FIXTURE_CLOSURE` export |
| `specs/pipeline/steps/bl487BoardFreshnessWithoutCoordinatorSyncSteps.js` | `pipeline_stage_cli.bb` | `BB_FIXTURE_CLOSURE` export |
| `extension/test/readLiveRoleHeldTicketsCli.test.js` | `pipeline_stage_cli.bb` | `BB_FIXTURE_CLOSURE` export (vitest module) |
| `swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh` | `done_with_current_task.bb` | runs `bb_closure_copy.sh`'s `copy_bb_closure` and reads what lands |
| `swarmforge/scripts/test/lib/operator_runtime_sandbox.sh` | `operator_runtime.bb` | runs the sandbox's own copy function and reads what lands |
| `swarmforge/scripts/test/test_front_desk_supervisor_bl622_refusal.sh` | `front_desk_supervisor.bb` | runs `bb_closure_copy.sh`'s `copy_bb_closure` and reads what lands |
| `swarmforge/scripts/test/test_front_desk_supervisor_tick.sh` | `front_desk_supervisor.bb` | runs `bb_closure_copy.sh`'s `copy_bb_closure` and reads what lands |
| `swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh` | `front_desk_supervisor.bb` | runs `bb_closure_copy.sh`'s `copy_bb_closure` and reads what lands |
| `swarmforge/scripts/test/test_front_desk_supervisor_fleet_creds.sh` | `front_desk_supervisor.bb` | runs `bb_closure_copy.sh`'s `copy_bb_closure` and reads what lands |

The effective list is read **behaviorally** — what the fixture actually
copies or actually exports — never by grepping its source for a literal. A
source grep would pass against a stale comment, which is exactly the "kept in
sync" failure the constitution's engineering article already forbids
(BL-897).

The four `front_desk_supervisor.bb` fixtures were enrolled later than the
original five (BL-1279, 2026-08-30): the same rot this table exists to
prevent — a hand-listed copy-set missing two `load-file` edges,
`daemon_log_freshness_pulse_lib.bb` and `self_heal_telemetry_lib.bb` — had
reached these four fixtures unguarded, because BL-973 derived each guarded
list's *contents* but left *which* fixtures are guarded as this hand-written
table. That second-order gap (a sixth-or-later fixture rotting unnoticed
beside a green guard) is not itself closed — deriving fixture membership
automatically is recorded as a follow-up, not done here.

## Adding a new load-file dependency upstream

When a change adds a `load-file` anywhere in one of the five entry points'
transitive closures:

1. Do nothing to the five copy-lists by hand — `bbFixtureClosureGate.js`
   computes each one's closure from source via `computeClosure` (the same
   `operatorRuntimeBbClosure.js` helper BL-944 built).
2. Run the BL-973 acceptance feature
   (`specs/features/BL-973-copy-lists-closure-derived-and-suite-completeness.feature`,
   scenario `02`): a fixture whose copy-list is now missing the new file
   fails that fixture's row, naming the file.
3. Fix the fixture that owns the gap:
   - a JS fixture (`bl814…`, `bl487…`, `readLiveRoleHeldTicketsCli.test.js`)
     adds the file to its own `BB_FIXTURE_CLOSURE.files` export.
   - the two shell fixtures add the file wherever `bb_closure_copy.sh` /
     `operator_runtime_sandbox.sh` compute their copy set (both are
     themselves closure-derived, not hand-listed, so this is usually already
     handled — see `swarmforge/scripts/test/lib/bb_closure_copy.sh`).
4. For the JS/bb-side agreement itself,
   `swarmforge/scripts/test/bb_load_closure_agreement_test_runner.bb` asserts
   the JS closure walker (`operatorRuntimeBbClosure.js`) and the bb closure
   walker (`bb_load_closure_lib.bb`, exposed via `bb_load_closure_cli.bb`)
   compute the identical closure for every one of the four entry points — the
   two independent implementations agreeing is itself the check (BL-897).

No fixture needs a hand-edited list of "today's missing files" — that pattern
is what re-rotted three times and is explicitly out of scope for future
patches to this area.

## The standing suite inventory (half 2)

Before BL-973, nothing ran `swarmforge/scripts/test/`'s shell tests as a
suite, which is why `test_lean_ledger_bb_wiring.sh` sat red and unnoticed for
days. `swarmforge/scripts/test/run_bb_suite.sh` is now the standing entry
point, driven by `swarmforge/scripts/test/suite-manifest.tsv` — the single
list both the runner and the inventory gate read, so they cannot disagree
about what the suite is.

Each manifest row is `file<TAB>lane<TAB>date<TAB>reason`:

- `standing` — run by `run_bb_suite.sh`; `date`/`reason` stay empty.
- `excluded` — not run; `date` (`YYYY-MM-DD`) and `reason` are both required.
  `slow`, `manual`, and `live-only` are legitimate reasons. **"It is
  failing" is not** — a red test belongs in the standing lane, reported red,
  not hidden in the exclusion lane.

`run_bb_suite.sh --dry-run`/`--list`/`--inventory` runs only
`suite_inventory_cli.bb` first and unconditionally: a test file present in
the tree but named in neither the manifest's standing lane nor its excluded
lane fails the inventory check by name, before any test is trusted to have
run at all.

### Adding a new test file under `swarmforge/scripts/test/`

Add one row to `suite-manifest.tsv` — `standing` in the common case, or
`excluded` with today's date and a `slow`/`manual`/`live-only` reason. The
inventory gate fails on an unlisted file, which is deliberate: it is the
"noticed within one run" outcome BL-973 exists to produce.

### Running the suite

`run_bb_suite.sh` (all standing tests), `run_bb_suite.sh <pattern>` (standing
tests whose filename contains `<pattern>`), `run_bb_suite.sh --list` (print
the standing set, run nothing). **Run it from a detached host shell with
`env -u TMUX`, never from an agent pane** — some tests in this tree drive a
real tmux server, and a full sweep from inside an agent pane killed all eight
live swarm sessions on 2026-08-22
([[darkcount-loop-wipes-tmux-sessions]]-class incident, now also recorded in
the manifest's `excluded` rows for the specific live-tmux tests).

## Acceptance

`specs/features/BL-973-copy-lists-closure-derived-and-suite-completeness.feature` —
scenario `01` (the lean-ledger fixture runs green), `02`/`03` (each guarded
list's closure check, and that it fires on a new upstream edge), `04`/`05`
(the suite inventory catches and reports an unlisted test file).

## Related — the commit-guard property fixture (BL-1398)

The same rot recurred outside this page's nine `.bb`-closure fixtures:
`extension/test/bl632CommitTimeGuardInvariants.property.test.js` built its
fixture repository by copying the real commit guards from a hand-written
`EXEC_FIXTURE_FILES` list (five `check_*.sh` scripts, the runner, its
libs, two hooks). When `check_handler_module_graph.sh` (BL-1385) joined
`run_commit_guards.sh`'s Tier-1 chain, the fixture's hand list did not
grow with it — the copied runner in the fixture could not find the new
guard, the chain failed inside the fixture, and the property test went
red on `main` even though no guard was actually broken. Fixed the same
way as this page's table: the fixture now parses `run_guard <script> ...`
lines out of `run_commit_guards.sh` (and `swarmforge/git-hooks/
pre-merge-commit`) at test time and copies whatever that read names,
following each guard's own `source`/`.` lines one level for its libs — a
guard the runner names but the tree lacks throws loud, naming it, rather
than silently running a narrower chain than production. See
[BL-1252's guard-chain page](BL-1252-commit-guard-chain-reports-every-violation.md)
for what the guard chain itself does.

**The acceptance-side twin (BL-1401).** BL-1398 fixed only the property
fixture; the acceptance handler for the same feature —
`specs/pipeline/steps/bl632CommitTimeGuardSteps.js`'s `mkFixtureRepo` —
carried its own separate hand-written twelve-entry copy list, and went
red the same way when `check_handler_module_graph.sh` joined the runner
(4 pass / 7 fail, reproduced 2026-09-04). Rather than write a second
parser of `run_guard` lines, the handler now calls the SAME
`deriveCommitGuardFixtureSet()` helper BL-1398 shipped in
`extension/test/helpers/commitGuardFixtureSet.js` — one parser, two
callers, so a guard added to the runner is reflected in both the property
test and the acceptance fixture without editing either.

## Related — the freshness-watchdog fixtures (BL-1399/BL-1420)

The same rot hit `daemon_log_freshness_check.sh`'s callers once BL-784's
own registry guard (`daemon_log_freshness_registry_guard.sh`) started
refusing a conf missing a row for either a `FRESHNESS_REQUIRED`-named
daemon or any live `*_supervisor.bb` script on disk — a fixture written
before BL-784 that pointed only `FRESHNESS_CONF` at a one-row conf, never
setting `FRESHNESS_REQUIRED`, was refused by the guard's own first arm
before the checker ran a single measurement. BL-1399 (2026-09-04) fixed
the first instance,
`extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js`;
BL-1420 (2026-09-05) fixed the three call sites BL-1399's scope did not
cover — `specs/pipeline/steps/bl1011FreshnessAlarmNamesSwarmAndReasonSteps.js`
(0/8 on `main`), `specs/pipeline/steps/bl1012FreshnessSelfInflictedIncidentsSteps.js`
(0/9), and `swarmforge/scripts/test/bl1011_freshness_attribution_property_runner.bb`
(whose `:continue true` swallowed the refusal into an empty announce, so
its four properties held vacuously over zero real violations).

BL-1420 extracted BL-1399's derivation into one shared JS helper,
`extension/test/helpers/freshnessFixture.js` — `supervisorNames(scriptsDir)`
(the same `*_supervisor.bb` glob the guard walks, injectable so a test can
point it at a scratch directory instead of the live tree) and
`writeGuardSatisfyingRows(...)` (one conf row plus a fresh heartbeat per
name the glob finds, plus the `FRESHNESS_REQUIRED` registry) — so the two
JS step handlers share one derivation rather than each hand-mirroring the
guard's glob a second time. The bb property runner derives from the same
glob independently in Clojure (`supervisor-names`/
`write-guard-satisfying-rows!` via `fs/glob`) — the ticket's own direction
was to derive from the same glob in Clojure, not to share code across the
two languages. That runner's `run-checker!` also stopped swallowing the
checker's exit status: a non-zero exit now fails the run naming the
checker's stderr, and evaluates none of its properties or coverage
counters over that run, instead of folding a refusal into an empty,
vacuously-passing observation. The guard, the checker, and every live conf
file are untouched by either ticket. Acceptance:
`specs/features/BL-1420-the-freshness-fixtures-pass-the-registry-guard.feature`.
See [BL-784](BL-784-supervisor-freshness-heartbeats-and-registry-guard.md)
for the guard itself.

## Related — shell-test orphans (BL-724)

`suite-manifest.tsv` also feeds a **shell-test discovery** sweep
(`shell_test_discovery_cli.bb`) that fails loud on untracked or unaccounted
`test_*.sh` files under `swarmforge/scripts/test/`. See
[Shell-test discovery](BL-724-orphan-red-shell-test-untracked-and-undiscovered.md).

A `git_handoff` send now also carries its own PARCEL-scoped registration
check, so an unregistered file is caught at the moment its own ticket adds
it rather than accumulating unseen until the next full suite run. See
[Unregistered-test send-time gate](BL-1240-unregistered-test-send-time-gate.md).
