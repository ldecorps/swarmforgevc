# BL-886 — coder review-stamp-off pass — 2026-08-12

## Scope reviewed

The landed hotfix, ONE logical unit spanning two commits on `main` (both
already ancestors of this branch):

- `602c7d014c` (`handoffd_supervisor.bb`): `job-process-pattern` widened to
  cover the property-lane vitest cmdline shapes; new `job-scope-paths` /
  `job-in-scope?`; `orphaned-job-groups` now uses
  `process-table-lib/parent-orphaned?`.
- `1ecbe049fe` (`orphan_janitor_lib.bb` / `orphan_janitor_sweep_lib.bb` /
  `extension/test/helpers/propertyLaneFixtureRunner.js`): new
  `hung-vitest-cmdline?`, `project-scoped-path?`, `reapable-hung-vitest?`;
  `sweep-candidates!` gained a required project-root first arg; the fixture
  runner tracks generated files and removes them on exit/SIGINT/SIGTERM.

This is a REVIEW ticket per its own framing (same posture as
BL-811/BL-849/BL-879) - confirm or refute the landed diff, not a rewrite.
No production file under review was modified by this pass; git status
confirms only new test/step-handler files, the promoted feature, and the
hotfix-ledger entries.

## Review goal 1 — the three acceptance properties

- **(a)** a crash-orphaned property-lane group under any covered cmdline
  shape is reaped: proven both by the acceptance scenario
  (vitest-orphan-reaper-stamp-01, 3 Examples) and exhaustively by the new
  supervisor property runner (all 3 shapes × orphan=true × inScope=true).
- **(b)** the SUPERVISOR reaper never touches a live-parented run, however
  long it runs: proven by acceptance scenario -02 and by the exhaustive
  property runner's `orphan=false` rows. `orphaned-job-groups` has no
  duration/age parameter anywhere in its filter chain - orphanhood is
  structurally its only trigger, confirmed by code inspection and by a
  non-vacuity check (temporarily forcing the `parent-orphaned?` clause to
  `true` unconditionally): all 3 in-scope/alive combinations flipped to
  wrongly-reaped, restored before this commit.
- **(c)** neither scoping check widens beyond host root/registered
  worktrees: proven for the supervisor by acceptance scenario -03 + the
  exhaustive property runner's `inScope=false` rows, and for the janitor by
  acceptance scenarios -04/-05 + the new janitor property runner (300 runs
  × 2 properties, generator deliberately includes decoy paths that
  `str/includes?`-instead-of-`str/starts-with?` would wrongly admit -
  confirmed by hand: mutating `project-scoped-path?`'s `in-path?` to
  `str/includes?` produced 127/300 P1 failures, restored before this
  commit).

**Confirmed.** No defect in the reviewed diff.

## Review goal 2 — `parent-orphaned?` reuse (BL-849/BL-877)

Both subsystems call the SAME `process-table-lib/parent-orphaned?` -
`handoffd_supervisor.bb`'s `orphaned-job-groups` calls it directly;
`orphan_janitor_sweep_lib.bb`'s `sweep-candidates!` calls it via the
injected `:parent-orphaned?!` adapter, which `default-adapters` wires to
the same function. Neither subsystem re-derives orphan detection. Traced
by reading both call sites; no second implementation exists anywhere in
the diff.

**Confirmed.** No defect.

## Review goal 3 — NAMED REVIEW QUESTION (architect): `job-in-scope?` vs `project-scoped-path?`

Per the ticket, this is the architect's call to make, not the coder's.
Evidence for the architect's review:

- `job-in-scope?` (`handoffd_supervisor.bb`): `(or (some #(str/includes? cmd %) paths) (and cwd (some #(str/starts-with? cwd %) paths)))`
  - cmd leg uses `includes?` (vitest argv often embeds the checkout path
    mid-string, e.g. after `--config`), cwd leg uses `starts-with?`.
- `project-scoped-path?` (`orphan_janitor_lib.bb`): `(or (in-path? cmd) (in-path? cwd))`
  where `in-path?` uses `starts-with?` for BOTH cmd and cwd.

These are NOT byte-identical: the supervisor's cmd leg is deliberately
looser (`includes?`) than the janitor's (`starts-with?`). Both are
independently property-tested in this pass and both correctly reject the
same out-of-scope decoy paths in their own test suite (the `includes?`
asymmetry did not surface a false-positive in either generator, since
none of the tested cmdlines embed a decoy path mid-string) - but the
asymmetry itself is real and worth the architect's explicit ruling: same
subsystem-independence justification BL-849/BL-877 already accepted for
`parent-orphaned?` duplication candidates, or consolidation is due. Not
blocking this pass either way.

## Review goal 4 — NAMED REVIEW QUESTION (architect): janitor's 2h live-parented stale-reap

Also the architect's call per the ticket. Evidence: the janitor's
`reapable-hung-vitest?` DOES reap a live-parented process once
`SWARMFORGE_ORPHAN_JANITOR_VITEST_STALE_HOURS` (default 2.0h) elapses -
proven by acceptance scenario -04's third row and property-tested
(P2, "expect-reaped = parent-orphaned OR stale"). This is a genuine,
intentional difference from the supervisor's own reaper (which never
reaps a live-parented group at all, per goal 1(b) above) - both behaviors
are correct as landed for their own subsystem; whether the 2h threshold,
the fast-path split, or the live-parented leg's existence at all is the
right call given BL-871's forthcoming pool cap is the open question this
ticket asks the architect to weigh in on.

## Review goal 5 — `sweep-candidates!`'s new required first arg

`grep -rn "sweep-candidates!" swarmforge/scripts/` shows exactly one
definition and one call site, both inside `orphan_janitor_sweep_lib.bb`
itself (a `defn-`, private to that namespace) - `sweep!` is the only
caller and already passes `project-root` as the first arg. No other call
site exists to have missed the signature change.

**Confirmed.** No defect.

## Review goal 6 — the two new test files are exercised by a runnable, findable gate

Both pre-existing (unmodified by this pass, independently re-verified
green below): `orphan_janitor_lib_test_runner.bb` and
`test_handoffd_supervisor_job_reaper.sh`. Per the specifier's finding
(no glob-style standing runner under `swarmforge/scripts/test/`), this
pass names the standing invocation explicitly rather than leaving it
implicit:

```
bb swarmforge/scripts/test/orphan_janitor_lib_test_runner.bb
bash swarmforge/scripts/test/test_handoffd_supervisor_job_reaper.sh
```

Both invoked directly in this pass's own verification (below) and named
again in the QA E2E procedure already written into the ticket. This
evidence file plus the ticket's own procedure IS the "documented
per-parcel path" the review goal asks for.

## Review goal 7 — fixture-runner install-once guard

Verified via acceptance scenario -07 (literal "twice", matching the
Gherkin text exactly) and property-tested more aggressively (1-15 calls,
deliberately past Node's default `maxListeners` of 10, so a broken guard
would both leave `listenerCount > 1` AND emit a real
`MaxListenersExceededWarning` - the literal-"twice" acceptance scenario
alone can never reach that warning). Non-vacuity confirmed by hand: with
`installAbnormalExitHandlersOnce`'s `if (abnormalExitHandlersInstalled)
return;` guard removed, both the acceptance scenario and the property test
failed (listener counts equal to the call count instead of 1), restored
before this commit.

**Confirmed.** No defect.

## Invariants (BL-654) — property tests added

Three new files (first authorship rests with the coder per BL-654; all
three declared invariants are executable, none needed a stated-reason
exemption):

- `swarmforge/scripts/test/bl886_vitest_orphan_reaper_supervisor_property_runner.js`
  (invariant 1, and the supervisor half of invariant 2) - EXHAUSTIVE (not
  sampled, same posture as BL-879's P0: the space is small and fully
  enumerable), 12 real spawned-process combinations (3 covered cmdline
  shapes × {orphan, alive} × {in-scope, out-of-scope}) driven through the
  REAL `bb handoffd_supervisor.bb --check-once` CLI - `handoffd_supervisor.bb`
  self-executes `(-main)` on load and has no adapter seam, so this could not
  be a JSON-bridge property test the way the janitor's can; Babashka has no
  raw `fork()` of its own to reparent a process to PPID 1, so this runs as
  a Node script reusing the same `specs/pipeline/steps/lib/bl886SupervisorFixture.js`
  helper the acceptance step handlers use.
- `swarmforge/scripts/test/bl886_vitest_orphan_reaper_janitor_property_runner.bb`
  (janitor half of invariant 2) - 300 generated runs × 2 properties against
  the REAL `orphan-janitor-sweep-lib/sweep!` wiring, generator drawn from a
  4-shape cmdline pool (the 3 acceptance-pinned shapes plus one extra) ×
  both in-scope and decoy-laced out-of-scope cwd pools.
- `extension/test/bl886VitestOrphanReaperFixtureRunnerInvariant.property.test.js`
  (invariant 3) - `fast-check`, 20 runs, call count drawn from 1-15,
  spawning a fresh isolated Node child per run (never asserts against the
  Vitest worker's own listener state).

Every property's non-vacuity was proven by hand at authoring time (see
each property's own comment header for the exact mutation and what it
caught) and restored before this commit; a discovered testing-harness
zombie-process subtlety (a `detached:true` Node child that dies while its
own parent is blocked in a synchronous `checkOnce()` call briefly reads as
"still alive" via both `kill(pid,0)` and `ProcessHandle.isAlive()`) is
fixed at the harness level (`pidAlive` now also checks `ps STAT` for `Z`) -
this only ever mattered for the deliberately-broken non-vacuity probes
themselves, never the real reviewed code path (a correctly-scoped
live-parented process is never killed in the first place, so its parent
never needs to reap a zombie).

## Acceptance — draft promoted to live

`specs/features/BL-886-swarm-stamp-vitest-orphan-reaper-hotfix.feature.draft`
→ `.feature` (unchanged content - the draft's own step text needed no
edits). New step handlers:
`specs/pipeline/steps/bl886VitestOrphanReaperHotfixSteps.js` (registered
in `specs/pipeline/steps/index.js`), backed by:

- `swarmforge/scripts/test/bl886_vitest_orphan_reaper_acceptance_runner.bb`
  (janitor scenarios 04/05, JSON-bridge, same pattern as
  bl849/bl879's own acceptance runners).
- `specs/pipeline/steps/lib/bl886SupervisorFixture.js` (supervisor
  scenarios 01-03, real spawned-process helper - shared with the
  supervisor property runner above).
- Fixture-runner scenarios 06/07 drive `propertyLaneFixtureRunner.js`
  directly in real isolated child processes, no bb bridge needed.

All 7 scenarios (11 examples total) pass:

```
# tests 11
# pass 11
# fail 0
```

## Hotfix ledger (BL-848 posture)

Neither provenance commit carried a `Hotfix-Certification:` trailer (both
predate this ticket's own mint), so `backlog/hotfix-ledger.yaml` had no
entry for either at pass start. Registered and linked in this parcel:

```
bb swarmforge/scripts/hotfix_ledger_update.bb . --new 602c7d014c "..." 2026-08-12
bb swarmforge/scripts/hotfix_ledger_update.bb . --new 1ecbe049fe "..." 2026-08-12
bb swarmforge/scripts/hotfix_ledger_update.bb . --link 602c7d014c BL-886
bb swarmforge/scripts/hotfix_ledger_update.bb . --link 1ecbe049fe BL-886
```

Both entries now exist with `stamp_ticket: BL-886`; `state` is left as the
sweep-refreshed `pending` (the automated `hotfix-certification-sweep!` in
`operator_runtime.bb` owns advancing it to `stamp-open`/`awaiting-human` -
not hand-set here per the ledger's own "never written by hand except
`--new`/`--link`/`--decide`" contract).

## Independent re-verification (ran directly)

- `orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED (pre-existing,
  unmodified).
- `test_handoffd_supervisor_job_reaper.sh` — ALL PASS, all 4 checks
  (pre-existing, unmodified).
- `bl886_vitest_orphan_reaper_janitor_property_runner.bb` — ALL PROPERTIES
  HOLD (300×2).
- `bl886_vitest_orphan_reaper_supervisor_property_runner.js` — ALL
  PROPERTIES HOLD (12/12 exhaustive).
- `bl886VitestOrphanReaperFixtureRunnerInvariant.property.test.js` via
  `npx vitest run --config vitest.properties.config.mjs` — 1/1 pass.
- `specs/features/BL-886-...feature` via `run_acceptance.sh` — 11/11
  scenarios pass.

## Degraded gate (recorded per the ticket's own note)

The `.bb` diff under review has no mutation/CRAP/DRY wired for this layer
(engineering.prompt, Startup Tools). The gate for this parcel is the unit/
property runners under `swarmforge/scripts/test/` plus the promoted
acceptance scenarios, all green above, plus the extension property lane
(`npm run test:properties`) for invariant 3 - never implying mutation ran
for the `.bb` half.

## Verdict

Landed hotfix confirmed correct against all three declared invariants and
review goals 1, 2, 5, 6, 7. Goals 3 and 4 are named review questions this
ticket explicitly routes to the architect - evidence gathered above, no
ruling made here. No functional defect found in the reviewed diff. No
follow-up ticket opened by this pass (goals 3/4 travel with the parcel to
the architect, not a new ticket).

By coder.
