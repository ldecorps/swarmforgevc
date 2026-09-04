# BL-1358 — hardener pass, 2026-09-04

Merged architect commit `204517347c` (clean pass, no bounce —
`backlog/evidence/BL-1358-architect-20260904.md`). Independently re-ran
every gate rather than trusting the evidence trail.

## Checks re-run, all independently

- `node --test specs/pipeline/test/bl1358MutantTimeCeiling.test.js` —
  6/6 PASS (before my own additions; 8/8 after, see below), including the
  process-group-reclaimed assertion.
- `npx vitest run --config vitest.properties.config.mjs
  bl1358MutantTimeCeiling` — 2/2 PASS.
- `run_acceptance.sh` on the BL-1358 feature — 4/4 PASS.
- `node --test` on `runnerAdapter.test.js`, `gherkinMutation.test.js`,
  `endToEnd.test.js`, `cli.test.js` — 17/17 PASS, matching the
  architect's exact regression count.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## BL-149 cooldown gate — hand-authored mutation sweep

`specs/pipeline/mutationWorker.js` and `specs/pipeline/runnerAdapter.js`
— both DECISION: run. Neither is compiled TS under `extension/src`, so
Stryker's own `--mutate` scope (`out/**/*.js`) never reaches either —
BL-638/BL-567 hand-authored fallback applies. Wrote
`specs/pipeline/test/bl1358_mutant_timeout_mutation_sweep.sh`, 7 mutants
against `bl1358MutantTimeCeiling.test.js` as the oracle.

First pass: **5 killed, 2 SURVIVED**:

1. **"success computation drops the `!timedOut` check"** — investigated
   and confirmed EQUIVALENT, verified empirically against Node's own
   `spawnSync` semantics (not assumed): `spawnSync('sleep',['5'],
   {timeout:200,killSignal:'SIGKILL'})` reports `status:null,
   signal:'SIGKILL'` — a process killed by `spawnSync`'s own timeout
   NEVER reports a numeric exit status, let alone `0`. So
   `result.status === 0` is already `false` on every real timeout,
   whatever `timedOut` reads; the two conditions are redundant for every
   input this function can actually receive. Recorded as accepted
   equivalent, BL-234 discipline, in the sweep script.
2. **"`resolveMutantTimeoutMs`'s positivity guard dropped"** — a REAL
   gap, not equivalent. No test exercised `GHERKIN_MUTATION_TIMEOUT_MS=0`
   or a negative override reaching the guard, despite it being the exact
   hazard the code's own comment names ("no ceiling is the state this
   ticket exists to end... must not be reachable through a typo in an env
   var"). Verified empirically why it matters: Node's `spawnSync` treats
   `timeout:0` as **no timeout at all** (confirmed: a `sleep 1` with
   `{timeout:0}` runs to completion unbounded), and a negative timeout
   **throws** a `RangeError` (confirmed: `{timeout:-5}` throws
   "must be an unsigned integer"), which would crash the worker with an
   uncaught exception rather than reporting a graceful mutant outcome.

Closed the real gap by adding two tests to
`specs/pipeline/test/bl1358MutantTimeCeiling.test.js`:
- **05**: direct unit coverage of `resolveMutantTimeoutMs` itself (now
  exported for exactly this), asserting `'0'`, `0`, `'-5'`,
  `'not-a-number'`, and `undefined` all fall back to
  `DEFAULT_MUTANT_TIMEOUT_MS`, plus a non-vacuity check that a genuinely
  valid override (`'4200'`) IS honored.
- **06**: an integration-level check through the real
  `runGeneratedTests` → `resolveMutantTimeoutMs` chain with
  `GHERKIN_MUTATION_TIMEOUT_MS='0'` set, using a FAST-finishing fixture
  (not a hang) so the test does not itself wait out the real 300s
  default — the first draft of this test tried to prove the ceiling by
  actually letting a hang run past a broken env var, which meant waiting
  the full 300-second default to observe the kill; rewritten to instead
  read `result.timeoutMs` back from a fast run, which proves the
  resolution happened without needing the ceiling to elapse.

Re-ran the sweep: **6/6 killed, 0 survived, 1 equivalent**. Re-ran the
full test file: **8/8 PASS**, ~11s total (no test in the minutes range).

## Process hygiene incident, self-caused and self-corrected

My FIRST attempt at re-running the updated test file exceeded the
sandbox's 120s foreground ceiling and was auto-backgrounded; I then
`pkill -9`'d the outer test-runner process directly rather than waiting
for/collecting it properly. Since `runGeneratedTests` calls `spawnSync`
**synchronously** and the group-kill-on-timeout logic runs inside that
same blocked parent process, SIGKILL to the parent from outside prevents
its own internal cleanup from ever executing — leaving that run's hung
child (and any of its own descendants) orphaned with no one left to send
the group kill. This accumulated across the pass's many test/mutation
invocations into ~50 orphaned `node` processes rooted under
`/tmp/bl1358-ceiling-*` and `/tmp/bl1358-property-*`, all reparented to
`init`.

**Not a defect in BL-1358's own code** — the group-kill mechanism itself
is verified working on every *uninterrupted* run (test 01b, "killing
reclaims the whole process group", passed on every invocation in this
pass, including inside the mutation sweep's own repeated `node --test`
calls). This is the same class of hazard the constitution already names
("Never hand-mutate a source file a detached suite is still reading";
BL-971 "a killed run traps nothing") — one more instance of it, self-
inflicted this time by my own mid-run interruption rather than an
external kill.

Reaped by process group (`kill -9 -- -<pgid>` per orphan, all leaders of
their own group) and swept the leftover `/tmp/bl1358-*` fixture
directories. Confirmed clean: `ps -ef | grep -i bl1358` returns nothing
before forwarding.

## BL-113 Gherkin mutation

No `Scenario Outline` in the feature (all four scenarios are plain
`Scenario:` blocks) — ran `run_gherkin_mutation.sh` to confirm rather
than assume: `"outcome": "inapplicable"`, matching BL-638. Manifest
stamped.

## CRAP / DRY

Confirmed this ticket's own diff touches no file under `extension/src`
— CRAP/DRY N/A.

## Result

One real hand-authored-sweep gap found and closed with two new tests
(direct unit coverage of the positivity guard, plus a fast integration
check of the env-var path). No orphaned processes remain (self-caused
leak from this pass, fully reaped). Forwarding to documenter.

By hardender.
