# BL-921-chase-trusts-active-role-marker-over-pane-identity — architect bounce

Architect ran the full gate inventory (Article 4.4 — complete pass, one
bounce). Every gate below was RUN, not assumed. Only D1 is a real defect;
everything else is recorded PASS/N-A for the record.

## D1 — correctness/hygiene: new acceptance step handler leaks its fixture
temp dir on any assertion or daemon-invocation failure

1. **File**: `specs/pipeline/steps/bl921ChaseVerifiesLiveIdentitySteps.js`
2. **Commit reviewed**: `c29a61dc92` (coder's commit, forwarded unchanged by
   cleaner).
3. **What's wrong**: the `the chase sweep runs (\d+) times` step
   (lines 136-214) creates a real fixture root via
   `fs.mkdtempSync(path.join(os.tmpdir(), 'bl921-chase-'))` and stores it as
   `st.fixtureRoot`. The ONLY place that deletes it is
   `fs.rmSync(st.fixtureRoot, { recursive: true, force: true })` at the very
   end of the SEPARATE `no wake text is injected into the resident pane`
   step (line 228) — reached only *after* that step's own assertion passes
   (lines 216-227). Two failure paths skip cleanup entirely and leak the
   directory under the real OS temp dir forever:
   - the `--chase-sweep-once` daemon invocation itself fails on any of the N
     iterations (`throw new Error(...)` at line 210), before the assertion
     step even runs;
   - the assertion at lines 223-226 throws — i.e. exactly the case where
     this scenario is doing its job and catching a real regression (wake
     text WAS injected). The scenario that most needs to preserve failure
     evidence is also the one that guarantees the fixture is never cleaned
     up, and never runs again either (`--chase-sweep-once` sinks a real
     `bb` subprocess and creates fresh dirs on every retry).
4. **Failure class**: `behavior` (resource-leak / test-hygiene defect I can
   see directly, not a hand-verified invariant).
5. **Why this is a real defect here and not a nitpick**: this exact failure
   shape — a temp-dir fixture deleted only on the happy path — was fixed in
   this same repository, same day, for a sibling ticket:
   `be5ccb372 Cleanup BL-913: guarantee temp-dir cleanup on failure in
   tool-miss-heal test runners` (try/finally + shutdown hook, explicitly
   because "a mid-run exception ... left it on disk forever"). The
   established convention in this step-handler family is to guarantee
   cleanup regardless of outcome — see
   `specs/pipeline/steps/bl870WakeAttributionSteps.js`'s `cleanup(ctx)`
   helper, invoked from inside try/finally at every one of its assertion
   steps (lines 254-264, 270-280 and the 7 other call sites). BL-921's new
   step file does not follow either precedent.
6. **Remediation pointer**: wrap the fixture body in `try { ... } finally {
   fs.rmSync(st.fixtureRoot, { recursive: true, force: true }); }` inside
   the `the chase sweep runs (\d+) times` step itself (so cleanup happens
   whether or not the daemon invocations succeed), and drop the now-dead
   `fs.rmSync` call from the `no wake text is injected` step — matching the
   `bl870WakeAttributionSteps.js` pattern already established for exactly
   this class of real-subprocess fixture.

   Owning role: **coder** (author of the new step handler,
   `c29a61dc92`).

## Everything else run — complete inventory, none blocked

- **Ticket invariants** (3 declared): all three have non-vacuous property
  tests in `swarmforge/scripts/test/mono_router_lib_property_runner.bb`
  (P4/P4b for invariant 1, P5/P5b for invariant 2, P6 for invariant 3).
  Non-vacuity is asserted in the commit message (mutant-restored check
  against the pre-BL-921 marker-only bodies) and independently confirmed
  by running the suite myself:
  `bb swarmforge/scripts/test/mono_router_lib_property_runner.bb` →
  `500 runs each / ALL PROPERTIES HOLD`, generator-coverage floors for the
  new `:wake-resident`/`:already-active` branches both non-zero (60/97).
- **Unit runner**: `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb`
  → `ok`. New BL-921 assertions cover diverged marker, unreadable (nil and
  blank) live-role, marker-itself-wrong, and own-standing-session-unaffected.
- **Acceptance**: `node specs/pipeline/cli.js
  specs/features/BL-921-chase-verifies-live-pane-identity.feature` → 7/7
  scenarios PASS, including scenario 04's real `handoffd.bb
  --chase-sweep-once` daemon fixture (not mocked) run 5 times against a
  genuinely diverged marker/live-identity with a real unclaimed handoff
  waiting — confirms the wiring (not just the pure gates) is correct
  end-to-end.
- **required_wiring** (2 items): both confirmed present and actually
  threaded, not just present as an unwired mechanism (the BL-419 shape the
  ticket explicitly warns against) —
  `mono_router_lib.bb::live-role-agrees?` is consulted by both
  `dormant-mailbox-chase-action` and `should-rotate-resident?`;
  `handoffd.bb`'s new `resident-live-role` probe is fed into both call
  sites (`chase-poke-action` line ~403, the `should-rotate-resident?` call
  site line ~1360-1363) — grepped for every production call site of both
  gate functions (2 each, both in `handoffd.bb`), confirmed no third,
  unwired call site exists.
- **Tightening-only property** (invariant 2) spot-checked by reading, not
  just trusting the property: the new conjunct is always `(and
  <old-condition> (live-role-agrees? ...))` in both functions — a
  conjunction can only narrow a true branch to false, never the reverse; P3
  (a pre-existing property, unrelated to this ticket) still passes with
  `:live-role` pinned to agree with `active-role`, correctly isolating the
  new axis from the starve/busy/cooldown precedence order P3 actually
  tests.
- **Dependency-gate hard gate** (BL-259): N/A this parcel — every changed
  file is under `swarmforge/scripts/` or `specs/pipeline/steps/`, none
  under `extension/src` or `extension/media`, the only scope
  `dependency-gate.js` resolves against (`DEFAULT_SCOPE_PATHS = ['src',
  'media']`, `EXTENSION_ROOT`-relative). Confirmed by attempting the
  per-parcel invocation, which correctly errors "can't open" on a
  repo-root-relative path outside that tree — there is nothing in this
  parcel for a TS module-boundary gate to check.
- **Co-change report**: run against all 6 changed files. `handoffd.bb`
  surfaces dozens of "SUSPECTED COUPLING" hits, but it is a structurally
  central daemon file touched by nearly every ticket in this project's
  history (briefing, chase, push, ambulance, supervisor libs all appear) —
  expected hub-file noise, not a signal specific to this parcel's own
  boundary. Nothing in the report points at a coupling this ticket's scope
  should have addressed and didn't.
- **Architecture boundary rules** (two-layer, extension-host-owns-IO,
  no-webview-storage, integrate-not-fork): N/A — this parcel touches only
  `swarmforge/scripts/*.bb` (the maintained SwarmForge fork itself, where
  modification is the point) and `specs/pipeline/steps/*.js` (test
  infrastructure); zero files under `extension/`.
- **Orphaned processes**: `pgrep -fl 'bb .*handoffd'` after the acceptance
  run finds only the two real live-swarm processes (`handoffd.bb`,
  `handoffd_supervisor.bb` running against
  `/Users/ldecorps/projects/swarmforgevc`, PIDs distinct from anything this
  run spawned) — nothing from this parcel's `--chase-sweep-once` fixture
  runs, which are one-shot-and-exit by design, matching `--sweep-once`'s
  existing posture. `bl921-chase-*` under the OS temp dir: none left behind
  (this run's scenario 04 passed, so its own cleanup ran; D1 above is about
  what happens when it doesn't).

By architect.
