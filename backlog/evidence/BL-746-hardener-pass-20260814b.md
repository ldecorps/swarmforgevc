# BL-746 — hardener pass, 2026-08-14 (post fixture-leak fix)

## Scope

Received from architect as `merge_and_process architect 7ae16e5357` —
architect's re-verify of coder's fixture-leak fix (`5a6b91607`,
`cleanupFixtureRoot`) and cleaner's `assertOnResult` dedupe (`1a6125bde`),
no defects found. Also merged QA's BL-890 merge-up broadcast
(`47bf03627`) in the same turn (unrelated ticket, same batch).

Files in scope for this parcel are all under `specs/pipeline/` and
`swarmforge/scripts/` — none under `extension/src/`, so Stryker/CRAP/DRY
(scoped to `extension/src` via `.jscpd.json`/`crapReport.js`) do not apply
here, same as the architect's dependency-gate finding on this ticket.
Hardening is the existing-suite + Gherkin-mutation pass this file class
gets instead.

## Re-verification of the fixture-leak fix (D1)

- `node swarmforge/scripts/test/bl746_stop_swarm_fixture_cleanup_test.js` — PASS
- `node swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js` —
  9/9 ALL PROPERTIES HOLD, and measured directly:
  `bl746-stop-fixture-*` count in `$TMPDIR` before/after an extra
  independent run of the property runner: **137 -> 137**, no growth.
  Confirms coder's fix holds under a fresh re-run, not just the original
  measurement.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-746-stop-swarm-real-refuse-gates.feature` — 5/5 PASS
- `bash swarmforge/scripts/test/test_lifecycle_script_scope.sh` — 15/15 PASS
- Cleaner's `assertOnResult` dedupe read directly: capture + cleanup order
  is unchanged (`runStopSwarm(ctx)` then `cleanupFixtureRoot(fixture(ctx))`
  then the caller's assertion), so every terminal step's behavior is
  identical to pre-dedupe — confirmed behavior-preserving by source read,
  not just green tests.

## Gherkin mutation (BL-113), first run for this feature — `soft`/`hard`

No `# acceptance-mutation-manifest-*` existed in the feature file before
this pass (never run). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-746-stop-swarm-real-refuse-gates.feature .
specs/pipeline/steps/bl746StopSwarmRealRefuseGatesSteps.js hard`
(both Scenario Outlines have `Examples:`, so the tool is applicable —
BL-638 N/A).

`Total=6 Killed=3 Survived=3 Errors=0`.

- **m1** (`babysitterd` -> `babysitTerd`, scenario 0 `named`) — killed.
- **m3** (`Operator` -> `OperatoR`, scenario 0 `named`) — killed.
- **m4** (survivor argv `--remote-control` -> `--remoTe-control`,
  scenario 0) — killed.
- **m2** (survivor argv `operator` dir component -> `operaTor`, scenario 0,
  babysitterd row) — **survived**. Read `stack_survivor_scan.sh:37`: the
  babysitterd match is `[[ "$rest" == *babysitterd.sh* ]]` — a glob on the
  `babysitterd.sh` substring only; the `operator/` directory segment
  earlier in the same argv string is never referenced by the match and the
  scenario's own assertion only checks `its stderr names "babysitterd" as
  a survivor` (the `named` field). No code path or assertion in this
  parcel's scope can ever observe that substring's exact spelling.
  **Equivalent mutant (BL-234)** — accepted, code-level reason as stated;
  not forced.
- **m5** (`kill_rc` `7` -> `4`, scenario 2 row 1) — **survived**.
- **m6** (`kill_rc` `3` -> `8`, scenario 2 row 2) — **survived**.
  For both: the generated test (`mutations/m5,m6/generated/*.js`) shows
  the SAME `<kill_rc>` example value substituted into both the `Given the
  stubbed pipeline kill exits <kill_rc>` setup step and the `Then its exit
  status is <kill_rc>` / `stderr contains "REFUSE: pipeline stop exited
  <kill_rc>"` assertion steps for the same row — mutating the row's value
  moves setup and expectation together, so the scenario stays
  self-consistent for any valid exit code. The actual invariant under test
  (verbatim `kill_rc` propagation, `stop-swarm.sh:91`'s `exit "$kill_rc"`)
  is independently and exhaustively covered by the property runner over
  `{0,1,7}` (BL-746 coder pass, invariant 2) — the acceptance Examples
  values themselves are not meant to pin specific numbers, only exercise
  the refuse path with *some* non-zero code, which they do.
  **Equivalent mutants (BL-234)** — accepted, code-level reason as stated;
  not forced.

Per BL-502: the embedded manifest's `scenarios: []` is expected (both
outline scenarios have a non-zero survivor count, so neither is written to
the manifest) and does not mean the tool didn't run — the run's own
summary line (`Total=6 Killed=3 Survived=3 Errors=0`) is the authoritative
record, reproduced above.

Scratch artifacts from the mutation run (`mutations/`, `base/`) removed
before commit, per Clean Up After Yourself.

## Verdict

No functional test gaps found. Three survived mutants, all independently
confirmed equivalent by direct code/generated-test read, not curiosity —
recorded per BL-234, not force-killed. Fixture-leak fix (D1) re-verified
holding under a fresh independent run. Forwarding to documenter.

By hardener.
