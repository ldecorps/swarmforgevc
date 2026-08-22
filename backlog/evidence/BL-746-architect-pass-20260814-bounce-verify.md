# BL-746 — architect pass (bounce D1 verification), 2026-08-14

## Scope

Received from cleaner as `merge_and_process cleaner 1a6125bde1`: coder's
fix for my own D1 bounce (`backlog/evidence/BL-746-architect-bounce-
20260814.md` — fixture root leaked, no cleanup path), plus cleaner's
follow-on DRY pass extracting the repeated `runStopSwarm(ctx) +
cleanupFixtureRoot(fixture(ctx))` pair into a shared `assertOnResult`
helper. This is the re-review of that fix, fresh, per Article 4.4 (a prior
bounce is not waved through on the fixer's word alone).

Merge lineage note: `1a6125bde1`'s branch also carries BL-890 and BL-892
work (`2e997dca3` merge), both of which cleaner routed directly to
hardender with a recorded `routing_skipped: ...skipped=architect` reason
in its own sent handoffs (000120, 000121) — those tickets never reached my
inbox and are out of scope for this pass; only BL-746's own two commits
(`5a6b91607` coder fix, `1a6125bde1` cleaner dedupe) are reviewed here.

## D1 verification — fixture leak, measured fixed

- `node swarmforge/scripts/test/bl746_stop_swarm_fixture_cleanup_test.js`
  — PASS (new unit test: asserts export exists, removes root, idempotent
  on a second call).
- Leak count before/after, independently re-measured (my own bounce
  measured `128 -> 137` pre-fix; this pass re-ran the full battery
  post-fix):
  ```
  before: 137
  ... cleanup unit test + property runner (9 fixtures) ...
  after:  137
  ... full acceptance suite (5 scenarios, each chaining multiple Then/And
      steps through the cleaner's new assertOnResult, exercising repeat
      cleanup calls on an already-removed root) ...
  after:  137
  ```
  No growth through either the property runner or the JS acceptance path.
  `cleanupFixtureRoot` (`fs.rmSync(fixture.root, {recursive: true, force:
  true})`) matches `bl886SupervisorFixture.js`'s own shape exactly, as my
  original bounce's remediation pointer asked for.

## Cleaner's dedupe — read as a diff, not taken on trust

`git show 1a6125bde1` for `bl746StopSwarmRealRefuseGatesSteps.js`: pure
extraction. Every one of the 6 terminal `Then` steps previously repeated
`const result = runStopSwarm(ctx); fixtureLib.cleanupFixtureRoot(fixture(ctx));`
before its own assertion body; now each calls
`assertOnResult(ctx, (result) => { ...same assertion body, byte-identical... })`.
`assertOnResult` itself is exactly the extracted three lines, in the same
order (capture result -> cleanup -> run caller's assertion). No assertion
logic, regex, or error message changed. Confirmed behavior-preserving by
running (not just reading) the full suite below.

## Full re-verification (all green)

- `node swarmforge/scripts/test/bl746_stop_swarm_fixture_cleanup_test.js` — PASS
- `node swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js`
  — 9/9 exhaustive combinations, ALL PROPERTIES HOLD
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-746-stop-swarm-real-refuse-gates.feature`
  — 5/5 pass (drives the cleaner's new `assertOnResult` path directly)
- `bash swarmforge/scripts/test/test_lifecycle_script_scope.sh` — 15/15 PASS

## Invariants (BL-654) — unchanged by this round, re-confirmed

Both declared invariants were fully reviewed against the coder's original
commit in my prior bounce pass and neither this fix nor the dedupe touches
the reviewed logic (D1 was a resource-cleanup gap, not an assertion-
correctness one; the dedupe is a byte-preserving extraction, confirmed
above). Invariant 1 (non-encodable, source-shape claim) and invariant 2
(the property runner above, still exhaustive/green) both stand as recorded
in `BL-746-architect-bounce-20260814.md`.

## Dependency-rule gate (BL-259)

All 5 files touched across both commits (`bl746StopSwarmRealRefuseGatesSteps.js`,
`bl746StopSwarmFixture.js`, `bl746_stop_swarm_fixture_cleanup_test.js`,
`bl746_stop_swarm_refuse_gate_property_runner.js`, plus the evidence md)
live under `specs/pipeline/` and `swarmforge/scripts/` — none under
`extension/src/` or `extension/media/`; `dependency-gate.js` is
structurally N/A for this parcel (same as every other pipeline/shell-only
parcel). Ran a full-repo baseline scan (`node
extension/out/tools/dependency-gate.js`, no args) as a sanity check: it
reports one pre-existing acyclic violation among
`telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
`telegramCursorOperatorLiveness.ts` — already tracked at
`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`,
untouched by this parcel, not a regression introduced here.

## Co-change coupling (BL-255)

Ran `co-change-report.js` on all 4 changed source/test files. All reported
co-changes are within the BL-746 family itself (the fixture lib, the
property runner, the cleanup test, `index.js`, the shell suite it
replaced logic in, and this ticket's own evidence files) — frequencies of
1-2, below the default flag threshold of 3, nothing crossing into
webview/extension-host code.

## Wiring

`specs/pipeline/steps/index.js:447` still registers
`bl746StopSwarmRealRefuseGatesSteps` — unchanged by either commit,
confirmed present.

## Property Testing pass (architect-owned, undeclared-property coverage)

The touched modules here are I/O-heavy (mkdtemp, spawnSync a real script)
rather than pure/testable in the fast-check sense, and the one
property-shaped surface (invariant 2's refuse-gate behavior) is already
covered by the coder's exhaustive property runner, confirmed non-vacuous
in my prior bounce pass. No additional property test warranted; none
added.

## Verdict

No defects found. Bounce D1 is resolved and verified by direct
measurement, not taken on the coder's word; the cleaner's dedupe is
behavior-preserving. Forwarding to hardender.

By architect.
