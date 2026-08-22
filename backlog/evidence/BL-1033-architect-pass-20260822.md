# BL-1033 architect pass — 2026-08-22

**Parcel:** cleaner-forwarded commit `743d46fa95` ("BL-1033: merge coder's
temp-root cleanup fix, resolve conflict"), merged into `swarmforge-architect`
(no conflicts on this branch; `bl1033TempRootCleanupSteps` registered
correctly in `specs/pipeline/steps/index.js`).

## Scope note: this merge also carried BL-1060's in-flight content

The merge brought in a large amount of unrelated `main`-synced state,
including BL-1060 (Bubble pairing-button URL scheme) at an EARLIER commit
(`c4404ed8f`) than its current tip on the coder line (`48e38aaad`, a
scenario-05 amendment not yet in this branch). BL-1060 is still `status:
active`, has not reached architect as its own parcel, and this handoff names
only BL-1033. Reviewed BL-1033 exclusively; BL-1060's content is incidental
shared history, not this pass's concern.

## What this fixes

`bl1025_expedite_approval_property_runner.bb` created its fixture temp root
at the top and removed it with `fs/delete-tree` at the bottom, at top level,
in no try/finally and behind no shutdown hook — reached only when every
preceding form completes. The runner's `g` git-helper throws `ex-info` on any
non-zero git exit, so a throw during the 57-call fixture setup left a
`bl1025-prop-*` directory behind permanently, and
`extension/test/tempDirTrapGuard.test.js` (in the default unit lane) was RED
at HEAD as a result.

## The fix — read and independently reproduced

A JVM shutdown hook (`(.addShutdownHook (Thread. #(when (fs/exists? root)
(fs/delete-tree root))))`) added right after `root`'s creation, deleting it
if it still exists on ANY exit — throw, `System/exit`, or SIGTERM. The
happy-path `(fs/delete-tree root)` at the end is kept as the fast path (the
hook is a backstop, not a replacement) — exactly the precedent pattern the
ticket names twice over in the same directory (`bl977_supervisor_progress`,
`bl887_scope_predicate_invariants`, the latter recording its own prior QA
bounce under this exact guard).

## Three findings surfaced while writing the tests — each independently verified real

1. **The leak detector used `fs/glob`, which does not match directories** —
   it would have returned the empty set regardless of how many roots leaked,
   passing every assertion vacuously. Confirmed by reading both the property
   runner's `roots()` (list-dir + name-prefix filter, explicit comment
   recording the `fs/glob` trap) and the step handler's `rootsIn()`
   (`readdirSync` + filter, same discipline) — neither uses a glob.
2. **Only git calls 1-17 (fixture setup) throw out of the run**; from call 18
   a failure is recorded as an ordinary property failure and the run reaches
   its own `delete-tree` regardless of the fix. The acceptance handler's
   `LAST_THROWING_GIT_CALL = 17` and its own comment record this was
   bisected against the un-fixed runner, and that an earlier version testing
   call 20 "proved nothing." The property runner independently rediscovers
   and floors this same boundary (`:leaky-window` vs `:post-setup`
   coverage, floored separately).
3. **A fired git shim does not always mean a failed run** — `is_qa_ancestor.sh`
   is a predicate whose non-zero exit is a legitimate "no." P2 in the
   property runner is correctly scoped to throws that genuinely propagate
   (calls ≤17), not to "any shim firing," which would have asserted a
   predicate can never return false.

## Test suites — all run directly, not assumed green

- `bb bl1025_expedite_approval_property_runner.bb` (the fixed file itself) —
  **32 cases, exhaustive — ALL PROPERTIES HOLD.**
- `npx vitest run test/tempDirTrapGuard.test.js` — **4/4 pass**, confirming
  the guard is now clean over the whole `swarmforge/scripts` tree (was RED
  at HEAD on exactly this file).
- `bb bl1033_temp_root_cleanup_property_runner.bb` — **ALL PROPERTIES
  HOLD**, 30 runs / 20 distinct throw points (floor 10), coverage
  `:leaky-window 13` / `:post-setup 11` (both above their floors), spawning
  the REAL 57-git-call runner as a subprocess against a git shim that fails
  exactly its Nth call, reading the REAL filesystem afterward for leaked
  `bl1025-prop-*` directories. Header documents 3 non-vacuity breaks proven
  at authoring time (remove the hook → P1 fails every throw shape; move the
  happy-path delete above the assertions → P3 fails; swallow the throw →
  P2 fails).
- `bash test_bl1033_property_runner_temp_root_survives_a_throw.sh` — **ALL
  PASS**, 4 scenarios including a real SIGTERM kill mid-run (settles around
  the one window a shutdown hook genuinely cannot close — creating the
  directory and registering the hook are not atomic — named rather than
  asserted away; SIGKILL correctly not claimed at all).
- Acceptance `BL-1033-...feature` run live via `specs/pipeline/cli.js` —
  **5/5 pass**, including the temp-dir-trap guard running over the whole
  scripts tree. `gherkin_lint_gate.sh` — parses cleanly.
- The runner's own assertions and its 32-case exhaustive sweep are
  untouched — confirmed both by re-running it (still reports "32 cases,
  exhaustive") and by reading the diff: no change to `expected-exit`,
  `commit-shapes`, `expedite-states`, or the sweep-count guard.

## Dependency-rule gate (BL-259) and co-change (BL-255)

No `extension/` TypeScript file touched — only one JS step-handler file
(test infrastructure) plus `.bb`/`.sh` scripts. Gate run against the one JS
file: **PASSED, no forbidden edges.** Co-change: all flagged pairs at
frequency ≤2, all pre-existing `expedite`/`is_qa_ancestor` family siblings —
nothing new or suspicious.

## Invariant (declared)

**"A fixture temp root is removed on every exit path — assertion failure,
thrown helper, or kill — never only when the runner reaches its last
line."** Property-encoded with generator-reach explicitly argued and floored
against two specific ways this could pass while testing nothing (clustering
throw draws at low N; only ever drawing the throw shape and destroying the
happy path) — a materially more rigorous encoding than a fixed example table
would give, and independently confirmed via a real SIGTERM kill in the shell
test for the one abnormal-exit case a property test cannot itself exercise.

## What is NOT the problem — do not change

- The runner's own 32-case exhaustive sweep and its constitutional-rule-derived
  `expected-exit` table — untouched, confirmed still exhaustive and still
  agreeing with the implementation as an independent check, not a tautology.
- The two sibling runners' own shutdown-hook precedent — this parcel follows
  it, does not alter it.
- BL-1032 (the sibling tmux-reaper guard defect) — explicitly out of scope
  per the ticket, untouched.

## Verdict

COMPLIANT. A correctly-scoped fix following established in-repo precedent,
with genuinely rigorous non-vacuous testing that caught and fixed three real
test-fidelity bugs (a glob that cannot see directories, a throw point that
proved nothing, a predicate conflated with an error) during its own
authoring — independently reproduced every claim rather than taking the
commit message on faith. Forwarding to hardener.

By architect.
