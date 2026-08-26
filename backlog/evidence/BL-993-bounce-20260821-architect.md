# BL-993 architect bounce — 2026-08-21

## Reviewed commit

`05313ee87e` (cleaner's merge of coder BL-993 `869ed3454f`), merged into the
architect worktree at `f79f6fd5f` (+ `1a8e86ac5`, a same-pass fix described
below).

## Merge hygiene note (not a bounce item, fixed in-place before review)

Merging `05313ee87e` silently dropped
`specs/features/BL-1004-a-rework-is-claimed-only-by-a-seat-that-can-work-it-safely.feature`
(present, unmodified, in the architect's pre-merge tip; deleted on cleaner's
side relative to the merge-base, so git's 3-way merge took the delete with no
conflict — the same BL-571/954/958 silent-revert shape cleaner's own status
note says it had just fixed for this exact ticket's `.yaml`, but the fix
apparently missed the sibling `.feature` file in the same merge). Restored in
commit `1a8e86ac5` before this review started; verified no other file was
silently dropped by diffing the merge result against both parents
(`git ls-tree` comparison, zero unexplained drops either direction).

## D1 — invariant 2's "announced on the human channel" is checked only
   against a hand-copied oracle, never against the real `announce-for-event!`
   dispatch (class: `invariant-unencoded`, blamed: coder)

The ticket's invariant 2 is explicit:

> A restart is never silent. Every restart the watch performs is announced
> on the human channel and recorded...

Four sites claim to verify this, and all four check the SAME hardcoded
literal set against another copy of itself, never against the real
production announce path:

1. `operator_runtime_watch_lib.bb:130-137` (`announced-event?`) —
   `(boolean (#{:started :re-armed :gave-up} event))`, a pure predicate.
2. `operator_runtime_supervisor.bb:175-183` (`announce-for-event!`) — the
   REAL dispatch that decides what actually gets announced on the human
   channel. It is a **separate, independently hand-written** `case` over
   `:started`/`:re-armed`/`:gave-up` that happens to currently agree with
   (1) — it does **not** call `announced-event?`, so nothing keeps the two
   in sync.
3. `bl993OperatorRuntimeWatchSteps.js:29` (`ANNOUNCED_EVENTS`) — a THIRD
   hand-copy of the same three-keyword set, used by the acceptance steps for
   scenarios 01, 02, and 04 ("the restart is announced", "nothing is
   announced", "the repeated failure is escalated").
4. `bl993_operator_watch_property_runner.bb:166-170` — the invariant-2
   property check itself: `expected-announced` is a FOURTH inline copy of
   `#{:started :re-armed :gave-up}`, compared against `announced-event?`
   from (1). Two copies of the same literal, checked against each other.

None of the four ever exercises (2), the actual code path a real restart's
silence or announcement runs through. This is exactly the shape the
project's own guardrail names: "A constant mirrored by hand across a
language boundary no import can bridge... needs a test asserting both
literals agree — a 'kept in sync' comment is not a gate, and drift fails
silently (BL-897)." Here it is worse than the BL-897 precedent: the drift
risk isn't only across the JS/Babashka boundary (site 3 vs. 1/2), it's
*within* the same file's own two hand-written copies (1) and (2).

### Confirmed by deliberate break, not just static reading

Per this project's own non-vacuity discipline, I broke the real
`announce-for-event!` (removed the `:gave-up` announce call, `nil` in its
place — a supervisor that gives up and says nothing) and re-ran every layer
without restoring first:

- `operator_runtime_watch_lib_test_runner.bb` — **ALL PASS** (unaffected;
  it never touches `announce-for-event!`).
- `bl993_operator_watch_property_runner.bb` — **ALL PROPERTIES HOLD**, 120
  draws x2, full invariant-2 coverage across all 6 event categories
  including `:gave-up` (24 draws).
- `node specs/pipeline/cli.js specs/features/BL-993-*.feature` — **8/8
  pass**, including scenario 04 ("repeated-failure-is-bounded-and-escalated",
  the scenario whose whole point is the escalation announcement).

Every layer stayed green against a supervisor that silently swallows its own
give-up escalation — the one event this ticket's own human directive singles
out ("the repeated failure is escalated on the human channel"). Restored the
file immediately after (confirmed via `git diff` against the reviewed commit
— zero diff).

### Not a hypothetical drift

This is not a remote what-if: `operator_runtime_supervisor.bb`'s own
`announced-event?`/`announce-for-event!` split is new code introduced by
THIS ticket, so the two copies have not yet had a chance to drift, but
nothing here stops the next edit (a new escalation event, a removed one,
a copy-paste slip in either `case`) from doing so silently — same
`nil`-in-place shape as the break test above, and none of scenarios 01/02/04
nor the property runner would catch it.

### Remediation

The project already has the pattern this should have followed —
`operator_runtime_supervisor.bb`'s own header says `OPERATOR_WATCH_NOTIFY_CMD`
"mirrors `SWARM_ENSURE_RC_NOTIFY_CMD`'s pattern," and `test_swarm_ensure.sh`
already uses that sibling seam to verify real notify content (e.g. `RC-8`,
`swarmforge/scripts/test/test_swarm_ensure.sh:1346-1362`: fake notify script
captures its args to a file, test asserts on the file's content). Nothing
analogous was written for `OPERATOR_WATCH_NOTIFY_CMD` — it is unused by any
test in this parcel.

Add a test (shell, matching the `bl993_watch_survives_runtime_death.sh`
real-process convention already established for scenario 05, or a `bb`
`--check-once` driver) that:
1. Runs the real `operator_runtime_supervisor.bb` with
   `OPERATOR_WATCH_NOTIFY_CMD` pointed at a capture script, and
2. Drives it through each of the 6 reachable events
   (`:started`/`:crashed`/`:healthy-reset`/`:gave-up`/`:re-armed`/nil — the
   same set the property runner's own header already enumerates as
   reachable), asserting `announce!` fired exactly for the events in
   `announced-event?`, and did not fire for the others.

Strongly prefer collapsing the duplication rather than just adding a
cross-check: have `announce-for-event!` gate on `announced-event?` itself
(e.g. `(when (operator-runtime-watch-lib/announced-event? event) (case
event ...))`) so there is one source of truth for "which events are
announced" and the `case` only supplies message text — leaving the JS
`ANNOUNCED_EVENTS` and the property runner's inline oracle as the two
copies that then need the cross-check test above. Implementation choice is
the coder's; the gate is what's required.

## Everything else reviewed clean

- Two-layer/extension boundary, dependency-gate (BL-259), webview
  storage/secrets: N/A — confirmed via `git diff 9c7501147 HEAD --stat`
  that this parcel touches zero `extension/` files.
- Co-change (BL-255): ran
  `node extension/out/tools/co-change-report.js` against all changed
  `swarmforge/scripts/*.bb`/`*.sh` files. All flagged coupling is the
  expected cohesion of a single new feature's own files, or the
  already-required delegation into `swarm_ensure.bb`/`swarm_status.bb`
  from my prior bounce. No new suspicious coupling.
- Invariant 1 (deliberate stop never undone): holds, non-vacuously —
  `decide`'s stop-gate runs before `check-one-fn` is ever reached (so a
  stop provably never spawns, not just by convention), and the property
  runner drives real `skip-env`/`parked` combinations against the real
  `decide` (not a mock), asserting `spawn!` was never invoked and the
  entry was returned unchanged.
- Invariant 3 (watcher never watched): holds — separate `nohup`-launched
  process (`launch_operator_runtime_supervisor.sh`), stopped independently
  and FIRST in `stop_ancillary_services.sh`'s `stop_operator_runtime`
  (avoids the race where a not-yet-stopped watch would undo a deliberate
  stop of the runtime it watches). Verified with a real kill via
  `bl993_watch_survives_runtime_death.sh` (PASS, re-ran myself). Has a
  stated non-encodability reason for skipping a generative property test
  (process-architecture fact, not a pure decision) — legitimate under
  BL-654's clause.
- D1 cleaner-bounce refix (post-repair cmdline-visibility race,
  `healthy-after-repair?` bounded retry in `swarm_ensure.bb`): re-ran
  `test_swarm_ensure.sh` myself in full — **48/48 PASS**, including the new
  deterministic `05a-race` scenario. Confirms the fix is stable, not a
  lucky pass.
- `required_wiring` satisfied: `bl993OperatorRuntimeWatchSteps` registered
  in `specs/pipeline/steps/index.js:552`.
- BL-643 non-pipeline-agents registration for the new
  `launch_operator_runtime_supervisor.sh`: correctly added to
  `LAUNCH_SCRIPT_AGENT_NAMES` and the reference table, every column
  filled, log basename matches the launcher's own `$LOG` path. Ran
  `specs/features/BL-643-*.feature` myself: 16/17 pass, the one failure
  ("the Onboarder document covers only what shipped") is **pre-existing**
  and unrelated — confirmed via BL-1005's own ticket text, which reproduces
  the identical failure message against `main` and dates it to commit
  `aa1949aec` (unrelated to BL-993). Not charged to this parcel.
- Acceptance feature: ran `specs/features/BL-993-*.feature` myself, 8/8
  pass (independent of the deliberate-break check above, which was
  restored before this run).

## Verdict

Sent back to coder. Do not forward to hardender.
