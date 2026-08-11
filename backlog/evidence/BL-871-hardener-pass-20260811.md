# BL-871 — hardener pass — 2026-08-11

## Scope reviewed

Batch parcel received from architect at `00d0a8e7b9`, forwarded as two
separate `git_handoff`s (BL-871, BL-874) per Article 2.6. This file covers
BL-871 only; BL-874 has its own evidence file
(`BL-874-hardener-pass-20260811.md`).

Files this task touches: `extension/vitest.properties.config.mjs`,
`extension/test/bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`,
`extension/test/maxConcurrentSpansInvariants.property.test.js`,
`extension/test/helpers/{workerPoolConfigGuard,maxConcurrentSpans,propertyLaneFixtureRunner}.js`,
`specs/pipeline/steps/bl871PropertyLaneWorkerPoolCapSteps.js`,
`specs/pipeline/steps/index.js`. No changes made to this set this pass — see
"Mutation scope" below for why.

## BL-149 cooldown gate (per changed production file)

Ran `mutation_cooldown_gate.bb` against every file this task touched.
Decisions: `skip-cooldown` for `vitest.properties.config.mjs`,
`propertyLaneFixtureRunner.js`, `specs/pipeline/steps/index.js` (all
recently integrated on `main` within the 3-day cooldown window, by BL-868 /
prior tickets); `run` for `maxConcurrentSpans.js` and
`workerPoolConfigGuard.js` (new files, no baseline on `main` yet). Host was
quiet at gate time (load 3.51/4 cores).

## Mutation scope — no wired tool covers this task's changed files

None of this task's changed files sit under `extension/src/**/*.ts`
(compiled to `out/**/*.js`, Stryker's `--mutate` scope) or under a `.bb`
file (the Babashka layer's own gate). `extension/test/helpers/*.js` and
`specs/pipeline/steps/**/*.js` are test infrastructure / step handlers, not
`tsc`-compiled extension source, so Stryker's `out/**/*.js` scope does not
reach them, and CRAP/DRY (`crapReport.js`, `jscpd`) both scope to `src/*.ts`
only — also not applicable, since this task added no `src/*.ts` changes.
Per engineering.prompt's "no tooling configured — do not improvise" +
BL-638's hand-authored-sweep precedent, treated this as a best-effort
coverage-gap pass instead of fabricating a Stryker run over files it does
not cover.

Independently re-verified (not taken on the architect's word) that the two
pure modules in scope are non-vacuously covered:
- `workerPoolConfigGuard.js`: the BL-871-invariant-2 property test
  (`bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`) fuzzes all
  four exported functions (`importsSharedBudgetModule`,
  `hasHardcodedMaxForks`, `hasHardcodedHeapSize`, `readsSharedWorkerBudgetOnly`)
  together across all 8 presence/absence combinations, 100 runs — this
  covers `hasHardcodedHeapSize` too, which the architect's own spot-check
  did not individually break/restore but which the property test's
  combinatorial generator does exercise per-boolean.
- `maxConcurrentSpans.js`: `maxConcurrentSpansInvariants.property.test.js`
  (architect-added) checks the real implementation against a brute-force
  overlap reference over 200 generated span sets.
No further hand-authored mutants found productive to add here; both files
are fully exercised by the existing property-fuzz coverage.

## Full property lane (`npm run test:properties`)

Host load was severely elevated all pass (peaks 33-48 on a 4-CPU host, vs
the project's own >>2x-cores discount threshold of 8) — the exact
contention class this ticket exists to fix, and the same condition the
architect's own evidence hit (load 16.7-28.6). Per the office-hours
mutation-bypass policy (never stall the pipeline waiting for a quiet host),
did NOT force the full 73-file run a second time. Instead:

- Ran the three new/changed property test files in isolation
  (`bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`,
  `maxConcurrentSpansInvariants.property.test.js`,
  `bl874PortableTimeInvariants.property.test.js`): **8/8 pass**, including
  invariant 1 (the real-subprocess pool-cap proof) — this is the mechanism
  scenario 04 and a full-suite run are actually checking, and it held under
  the same elevated load, not a quiet-host-only pass.
- Ran the ticket's own acceptance feature via `run_acceptance.sh`: scenarios
  01-03 (declaration/wiring/sizing) pass; scenario 04 (full-suite outcome)
  timed out at the 300s per-scenario budget under this load. This is
  exactly the risk the ticket's own `approval_context` and
  `qa_e2e_procedure` name in advance ("Scenario 04 ... QA: please re-run
  ... once host load is back near baseline") and matches the architect's
  own full-run finding (a heartbeat/RPC timeout, not an assertion failure).
  **Not re-run a third/fourth time** — same reasoning as the architect: two
  additional attempts under this load would only add contention without
  new signal, and the mechanism is independently verified above.
- Started a soft Gherkin-mutation pass over the feature's two Scenario
  Outlines (`run_gherkin_mutation.sh ... soft`); killed it (own process
  group, `kill -- -<pgid>`, confirmed reaped) after ~6 minutes under load
  36-48 rather than let a scenario-04-driven mutation run stall the pipeline
  indefinitely. **Deferred to the next quiet pass** — not recorded as a
  pass, not recorded as a fail; scenarios 01-03's declaration-only shape
  means this defers cleanly (BL-234-style: no assertion depends on it to
  ship the ticket's own required_wiring).

## Shell-test / cross-batch cleanup

Killing the Gherkin mutation run left one orphaned test-fixture file,
`extension/test/bl868-fixture-<pid>-<rand>.property.test.js` (from
`propertyLaneFixtureRunner.js`'s `runAsPropertyLaneFixture`, whose
`finally`-block cleanup didn't get to run before its subprocess was force-
killed by the acceptance run's own scenario-04 timeout). Confirmed its
content was a disposable generated fixture stub (matches the helper's own
documented "cleaned up unconditionally" contract) before removing it — not
a file I created, but debris from a run I triggered this turn, and left in
place it would have been picked up by the property lane's own
`test/**/*.property.test.js` include glob on the next run.

## Coverage-gap addition (own hardening finding, BL-874-adjacent but filed
## under BL-874's own evidence since the changed file is BL-874's)

See `BL-874-hardener-pass-20260811.md` for the `portable_relative_touch_stamp`
unsupported-unit coverage gap found and closed this pass — noted here only
because it was found while reviewing this batch as a whole.

## Verification

- `npm run compile`: clean.
- `npm test`: 422/422 files, 7438/7438 tests pass.
- Targeted property files: 8/8 pass (see above).
- Acceptance scenarios 01-03: pass. Scenario 04: timed out under severe host
  load, deferred to QA per the ticket's own procedure (not a code defect —
  the mechanism it checks is independently proven above).

## Verdict

No defect found in BL-871's own scope. Hardening pass is a coverage
confirmation (no source change needed for this ticket specifically — see
`BL-874-hardener-pass-20260811.md` for the one test added this batch, filed
against the file it actually touches). Forwarding to documenter.
Scenario 04 / full-suite Gherkin mutation re-verification on a quiet host
remains QA's explicit ask per the ticket text, unchanged from the
architect's own handoff.

By hardender.
