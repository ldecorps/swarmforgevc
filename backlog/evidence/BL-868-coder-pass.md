# BL-868 — coder pass

Wires the property lane's `vitest.properties.config.mjs` with the same two
`setupFiles` `vitest.config.mjs` already registers (`tmpDirSetup.js` BL-420,
`envRestoreGuardSetup.js` BL-720), so a property test's leaked temp
directory is swept and a leaked `process.env` key fails loudly — same as
the unit lane, per the ticket's second declared invariant ("a lane cannot
exist without them").

## Approval-question 1 resolution: what the guards actually surfaced

The ticket flagged the blast radius as genuinely unknown until the guards
ran, and asked whether to fix whatever surfaces inline or split it into
follow-ups. Running the full 67-file property suite with the guards wired,
repeatedly, in isolation and in the full batch, to separate deterministic
wiring-caused failures from pre-existing flakiness:

- **`test/bl622TelegramTokenSeparationInvariant.property.test.js`** —
  genuine, 100% reproducible regression caused by this wiring (confirmed:
  fails every time with the guards on, passes every time without them,
  both in isolation over 3 runs each). Root cause: line 61 built
  `CONFLICT_CHECK_SCRIPT` via `mkTmpDir()` at **module load time**, meant
  to be read by every `test()` in the file — exactly the shape
  `mkSharedTmpDir()` exists for (its own doc comment names this pattern).
  `mkTmpDir`'s per-test `afterEach` sweep (now wired into this lane) swept
  it after the file's first test, breaking the second. Fixed inline:
  swapped to `mkSharedTmpDir()` (one line + one import), which sweeps at
  `afterAll` instead. Verified 3/3 passing runs with the guards on after
  the fix. Grepped every other `*.property.test.js` file for the same
  module-level-`mkTmpDir` shape (`grep -n "^const .*mkTmpDir("
  test/*.property.test.js`) — no other instance found.

  This one-line fix is in scope under the ticket's own "plus whatever the
  guards surface" clause: it is exactly the failure mode BL-868 exists to
  catch, deterministically caused by this ticket's own change, and
  minimal.

- **`test/bl760DuplicateChainGuard.property.test.js`** (3 timeouts) and
  **`test/bl787NamedTunnelInvariants.property.test.js` invariant 1** (1
  intermittent failure) — confirmed **NOT** caused by this ticket. Each
  reproduces the same timeout/failure when run through the full 67-file
  suite with the guards **removed** (stashed `vitest.properties.config.mjs`
  back to no `setupFiles` and reran the full suite: bl760 timed out
  identically; a different file, `bl805RotateGateOnUnfinishedInProcessParcel`,
  failed that run instead of bl787 — the failing set itself is
  non-deterministic between runs of the *same* unwired config). Each of
  bl760, bl787-invariant-1, and bl805 passes reliably when run **alone**
  (3/3 each). This is resource contention from running ~67 subprocess-heavy
  property files concurrently on this host, not an env/tmp leak — outside
  both BL-867 and BL-868's scope. Left unfixed; reported separately (see
  below) rather than folded into this commit.

Net: the set of passing files changes by exactly one, in the direction of
newly-passing (bl622, previously silently relying on unswept state), which
satisfies the qa_e2e_procedure's closing check ("no verdict changed for
already-clean property files... apart from files this ticket deliberately
fixes").

## Approval-question 2

Unchanged per the ticket: no cleanup of the pre-existing 435 MB backlog of
already-orphaned fixture directories was attempted (none were even present
on this host at build time — `ls -d "${TMPDIR:-/tmp}"/bl*-* | wc -l` read 0
before this pass started).

## Invariants (BL-654)

Both declared invariants are coder-authored property tests
(`extension/test/bl868PropertyLaneIsolationGuards.property.test.js`):

- **Invariant 1** ("a property test leaves the host no state it did not
  find") is a process-level guarantee, not a pure module — proven by
  generating real leaky fixture property-test files and running them
  through the actual `vitest.properties.config.mjs` via
  `test/helpers/propertyLaneFixtureRunner.js` (writes the fixture under
  `extension/test/` — the only place the lane's `include` glob resolves —
  runs it, deletes it unconditionally). Two sub-properties, freshly
  randomized key/prefix per run: a leaked `process.env` key fails the run
  and the failure names that key; a temp dir created via the shared helper
  does not survive.
- **Invariant 2** ("every Vitest configuration... registers the shared
  isolation guards") is a pure module
  (`test/helpers/isolationSetupFilesGuard.js`, text-based so it never
  executes a config's side effects) fuzzed over varied config-source
  shapes (quote style, path prefix, decoy entries, which of the two
  required basenames is present) so the guarantee generalizes past the two
  real files. The acceptance feature's Scenario Outline (04) applies the
  same guard to the two real config files.

Both verified non-vacuous: reverted the `setupFiles` line in
`vitest.properties.config.mjs` and reran invariant 1's two sub-properties;
both failed with the expected shape (env leak undetected; temp dir left on
disk), then restored and reconfirmed green.

## Acceptance

`specs/features/BL-868-property-lane-isolation-guards.feature` already
existed (specifier-authored). Wrote its step handlers
(`bl868PropertyLaneIsolationGuardsSteps.js`), reusing
`propertyLaneFixtureRunner.js` and `isolationSetupFilesGuard.js` — one
mechanism proven twice (property test + acceptance), never two
reimplementations. `run_acceptance.sh`: 5/5 subtests pass.

## Follow-up to report

The bl760/bl787/bl805 full-suite-load flakiness above is a pre-existing,
out-of-scope test-infrastructure issue (this property lane has no worker
pool cap analogous to the unit lane's BL-422 `WORKER_POOL_SIZE`, so a full
`test:properties` run of all 67 files can contend hard enough on this host
to intermittently time out or fail real-subprocess-heavy files). Surfacing
to specifier via a `note` rather than fixing here — it is unrelated to the
isolation-guard mechanism this ticket wires.

## Commands run

```
npx vitest run --config extension/vitest.properties.config.mjs extension/test/bl868PropertyLaneIsolationGuards.property.test.js
bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-868-property-lane-isolation-guards.feature
npx vitest run --config extension/vitest.properties.config.mjs extension/test/bl622TelegramTokenSeparationInvariant.property.test.js   # x3
npm run test:properties   # full suite, guards on: 65/67 files pass (bl760, bl787 pre-existing flakiness)
npm run test:properties   # full suite, guards removed (stashed): same class of flakiness (bl760, bl805) confirms independence
```

All green apart from the documented pre-existing flakiness. By coder.
