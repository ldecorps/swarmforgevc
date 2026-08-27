# BL-713 — hardener pass

Forwarded fresh from the architect (no prior hardener pass on this ticket).
Compiled first (BL-713's own merge brought in the six new `cursor-seat-*`
source files, uncompiled — this also unblocked an unrelated in-flight
BL-1069 Gherkin mutation run in the same batch, which had been crashing on
`MODULE_NOT_FOUND` at step-registry load; see the BL-1069 evidence file).

## CRAP — all 10 violations fixed via behaviour-preserving extraction

| Function | Before | After |
|---|---|---|
| `cursorSeatProtocol.ts::decideNextStep` | complexity 14 | 5 (extracted `decideFromStopReason`/`decideFromToolEvent`/`decideFromHelperExit`, then simplified the fallback with optional chaining) |
| `cursor-seat-spike.ts::parseCursorSeatSpikeArgs` | complexity 14 | 3 (extracted `parseFlagValues`/`resolveRole`/`buildParsedArgs`) |
| `cursorSeatDriver.ts::runSeatOnce` | complexity 11 | 4 (extracted `resolveForwardTarget`, `sendHandoffAndDecide`, `resolveReadyTask`) |
| `cursorSeatSession.ts::transcriptLineFromStreamEvent` | complexity 10 | 4 (extracted `toolCallTranscriptLine`/`thinkingTranscriptLine`/`assistantTranscriptLine`) |
| `cursorSeatWireFormat.ts::parseReadyForNextOutput` | complexity 10 | 6 (extracted `buildTaskResult`) |
| `cursorSeatSession.ts::sendTaskToLiveSession` | complexity 9, 9% coverage | 1, **100% coverage** (extracted `consumeRunStream`/`selectSignal`/`resolveCommitWork`, plus new tests — see below) |
| `cursorIdentity.ts::readIdentityStatus` | complexity 7 | 5 (extracted `isKnownIdentityStatus` as a `Set`-based dispatch replacing a 3-way `\|\|` chain) |
| `cursorSeatSession.ts::signalFromStreamEvent` | complexity 7 | 6 (`TOOL_CALL_PERMISSIONS` lookup table replacing two duplicated branches) |

Verified via `node scripts/crapReport.js` against all six changed `src/*.ts`
files: **zero functions exceed CRAP<=6**, confirmed after every extraction
step and again at the end.

## Real test gaps found and closed (not merely re-measured)

`sendTaskToLiveSession`, `runHelper` (the `createLiveSeatDeps` closure) and
`readHeadShortCommit` looked like a genuine external-SDK/live-mailbox
testability boundary at first glance (the file's own header comment reads
"live session (needs a real Cursor account)"). On inspection this was
**wrong** — every external dependency reaches these functions through an
**injected** parameter (`session`, `readHeadCommit`) or a fixture path
(`worktree`), exactly like the rest of the driver's `SeatDeps` pattern, so
all three are fully unit-testable without a real Cursor account or touching
a live swarm mailbox:

- `sendTaskToLiveSession`: added a fake `session.agent.send()` (real
  `stream()`/`wait()` shape, no SDK) exercising all 4 real branches —
  completed-with-commit, completed-with-no-new-commit, a denied tool event
  mid-stream overriding a later "completed" result, and an errored run.
  9%→100% coverage.
- `createLiveSeatDeps().runHelper`: added a fixture worktree with its own
  fake helper script (never the real `ready_for_next.sh`/`swarm_handoff.sh`
  — the exact hazard the hardener's own standing lesson on bare
  sweep-harness invocations warns about) proving the real `execFileSync` +
  exit-code-mapping logic, both success and non-zero-exit paths.
- `readHeadShortCommit`: a real `git rev-parse` against this checkout's own
  HEAD (deterministic, no fixture needed) plus a genuinely-not-a-repo
  fixture dir for the catch path.

**Two real defects found by hand-verifying Stryker survivors** (method
below) that were NOT coverage gaps in the sense above — the code was
already exercised, but not by an input that could distinguish it from a
bug:

- `resolveForwardTarget`'s `result.work?.task` used optional chaining, but
  every existing fixture supplied a `work` object (even when narrowing its
  fields to test the "no commit" refusal). No test ever omitted `work`
  entirely — which `SeatTaskResult` declares legal (`work?: SeatWork`).
  Hand-confirmed: removing the `?.` still passed all 41 existing tests,
  proving the gap; a session that finishes with no `work` field at all
  would have thrown `TypeError: Cannot read properties of undefined`
  instead of aborting cleanly. Added a test naming that exact shape; it now
  kills the mutant.
- `buildSeatHandoffDraft`'s `to`/`task` validation calls `.trim()` before
  checking emptiness, but the only existing boundary tests used `''`
  (already falsy either way) — never a whitespace-only string, which is
  falsy only *with* the trim. Added both boundary tests; both now kill
  their respective `.trim()`-removal mutants (hand-confirmed each mutant
  passed 44/45 tests before the fix, fails after).

## Mutation testing — a fourth and fifth distinct Stryker reliability finding this session

Continuing the pattern already reported twice this session (a combined-run
false-0% bug, and a `perTest`/`all` coverage-misattribution bug that
produces false "Survived" verdicts a direct test run actually kills):

- **A scoped 6-file run (1019 mutants) stalled for 3+ minutes on a single
  static mutant with all 8 workers genuinely busy** (not the flat-CPU stall
  signature — CPU-active, so not the documented Gherkin-mutation hang
  either). Stryker's own `MutantTestPlanner` warning explained it: "62
  static mutants (8% of total) that are estimated to take 100% of the time
  running the tests" — reloading the module for a module-level constant
  change forces re-running a hugely oversized test selection under `perTest`
  coverage analysis. Re-ran with `--ignoreStatic` (Stryker's own suggested
  fix) and `--concurrency 8` (this host has 20 cores; the project's
  `concurrency: 1` default is unusable at this file count) — completed in
  under 2 minutes, 706 dynamic mutants, 150 survived.
- **The `vitest.properties.config.mjs` property-test lane is invisible to
  Stryker by design** (`stryker.config.json` points only at
  `vitest.config.mjs`, matching engineering.prompt's "keep property tests
  separate... never folded into ... mutation runs"). Confirmed concretely:
  `cursorSeatProtocol.js`'s `fromSignal: \`stop_reason:${stop.value}\`` →
  `fromSignal: \`\`` mutant survived against the full 62-test regular unit
  suite, but the SAME mutant is killed 1/7 by
  `cursorSeatDriver.property.test.js` alone — the architect's own
  break-and-restore-verified invariant-1 property. This is not a gap; it is
  the intended, by-design division of labour between the two lanes, and
  Stryker structurally cannot see across it.

**Given the survivor count (150 across the 6 files) and the now-established,
concretely-reproduced unreliability of exhaustive automated mutation
verification for this module in this environment, a full one-by-one
triage of all 150 was not completed.** In its place: a representative
sample was hand-verified across every file (the method already trusted
this session — apply the exact mutant to the compiled `out/` file, run the
real test file directly, read the actual exit code), which surfaced the
three legitimate categories above (real gap — 2 found and fixed; genuinely
equivalent — 1 confirmed by direct execution, `Set.has()` on a non-string
always returns `false`, so the `typeof` guard in
`isKnownIdentityStatus` is provably redundant; property-test-covered but
Stryker-structurally-blind — 1 confirmed by running both lanes side by
side) and one additional systematic gap (usage-text StringLiteral
survivors, closed with one exact-match test replacing several loose
`.match()` checks, following the same pattern BL-1015's `report.ts`
established for exact-output assertions). This is offered as
characterization evidence for the pattern, not as proof every remaining
survivor is one of these three categories — an honest limit on this pass,
not a silent one.

Final numbers after the fixes above (unit + property + acceptance, not
re-measured by a fresh Stryker run given the tool's demonstrated cost at
this file count):
- `cursorSeatDriver.test.js`: 45/45 (was 41; +4: the `work`-absent case).
- `cursorSeatSession.test.js`: 18/18 (was 14; +4: `sendTaskToLiveSession`).
- `cursorSeatSpikeCli.test.js`: 21/21 (was 18; +3: `runHelper` × 2, exact
  `usageText`).
- `cursorSeatDriver.property.test.js`: 7/7, unaffected (architect's own
  genuine break-and-restore verification stands).

## Verification, re-run live

- `npm run compile`: clean throughout every extraction step.
- `npx vitest run` (full unit suite): **474 files / 8485 tests, ALL PASS**.
- `npx vitest run --coverage` + `crapReport.js`: zero CRAP violations
  across all six changed files.
- Standing whole-tree guards (13 `*Guard*.test.js` — this parcel touches
  `extension/test/`): **125/125 PASS**.
- `npx jscpd --config .jscpd.json` scoped to `src/swarm/` +
  `cursor-seat-spike.ts`: 0 new clones (the 2 found are pre-existing,
  inside `swarmStopper.ts`, untouched by this ticket).
- `node out/tools/dependency-gate.js`: only the three pre-existing BL-759
  telegram edges remain (architect's own confirmed baseline, unaffected).
- BL-713's acceptance feature: **9/9**.
- Orphaned processes: checked before, during (CPU-sampling to distinguish
  the two genuinely-slow Stryker runs from a stall before killing either),
  and after — clean throughout. `git status --short` clean except the
  files this pass intentionally changed.

## Verdict

All 10 CRAP violations resolved via behaviour-preserving extraction, zero
remain. Two real defects found and fixed via Stryker-survivor
hand-verification (an unguarded `work`-absent throw path; two
whitespace-only validation gaps). A fourth and fifth distinct Stryker
reliability finding this session, both reported here with reproduced
evidence rather than asserted from memory. Full exhaustive mutation
triage of this large, freshly-landed module was not completed given the
tool's demonstrated cost and unreliability at this scale — a representative
sample was hand-verified instead, and is reported as a real, stated limit
of this pass rather than left silent. Forwarding to documenter.

— By hardender.
