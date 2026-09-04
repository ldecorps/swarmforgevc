# BL-1391 — architect review, 2026-09-04: BOUNCE (intermittent, invariant 3)

Reviewed coder commit merged in via cleaner `586f2e75da`.

## Checks that passed

- Dependency gate on `bl1391BookkeepingConflictResolvedSteps.js`: PASSED.
- `required_wiring`: both anchors present (`bookkeeping-conflict` in
  `handoffd.bb`; step handler registers).
- `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS.
- `bl1391_bookkeeping_conflict_property_runner.bb` — ALL PROPERTIES HOLD
  over 515 constructed cases.
- Read `master-main-try-bookkeeping-absorb!` end to end: the design is
  correct on paper — every refusal path aborts the merge it opened
  (no MERGE_HEAD inherited), the guard-refusal path only differs from
  success by `git commit`'s own exit code (no bypass logic exists), and
  `append-only-merge`/`bookkeeping-conflict-plan` are pure and reused, not
  restated.

## D1 — the e2e suite is intermittently red, and one of the two failure shapes is invariant 3 itself (correctness, class: behavior)

`test_bl1391_bookkeeping_conflict.sh` and the acceptance suite that wraps
it are registered as **standing** — i.e., expected to be reliably green.
They are not. Measured this pass, 17 total runs across two invocation
paths:

- Standalone (`bash swarmforge/scripts/test/test_bl1391_bookkeeping_conflict.sh`),
  14 runs: **13 pass, 1 fail**. The one failure:
  ```
  FAIL: setup(four): seed push failed
  fatal: Remote branch main not found in upstream origin
  ```
  (the fixture's own `git clone -b main` racing a `git push -u origin main`
  to the same bare repo, immediately after).

- Via `run_acceptance.sh` (which runs the same script once per scenario,
  6 times per invocation), 3 runs: **1 clean (6/6), 2 with one failure
  each**, and the two failures are DIFFERENT:
  - Run 1: the same `setup(four): seed push failed` shape as above.
  - Run 2, more serious:
    ```
    FAIL: the resolver committed past a refusing guard chain
    FAIL: no refused-by-guards log line:
    ```
    This is **invariant 3 itself failing**: scenario 5 arms a `core.hooksPath`
    that always refuses (`pre-commit`/`pre-merge-commit` both `exit 1`),
    then asserts the resolver's merge commit did NOT happen. It did happen
    — `before_head` differed from `HEAD` after `run_tick`, and no
    `refused-by-guards` log line was written.

## Why this is a bounce, not a shrug

Both failure shapes point at the same underlying class this session has
already hit twice today (BL-1385's two concurrency races): expensive,
sequential real-git operations across several from-scratch bare
repositories, run under host load, occasionally racing each other or
racing a subprocess's own config/ref visibility. I cannot rule out that
the specific mechanism is fixture-only (a `cp -R` of the whole
`swarmforge/scripts/` tree per fixture root, six times per run, is heavy
I/O) rather than a defect in the resolver's own production logic — the
design read on paper is sound, and every clean run behaves exactly as
specified. But:

- A ~15-20% chance of a red run on a **standing** test is not a green
  gate by any honest reading (Article 4.4/"green suite is not evidence").
- One of the two observed failure shapes is a **direct falsification of
  invariant 3** as currently tested — "the resolver committed past a
  refusing guard chain" is not a vague flake message, it is the literal
  sentence the ticket's own severity rating exists to prevent. Even if
  the root cause turns out to be fixture-only, that still means the test
  as written cannot currently prove invariant 3 holds, which is exactly
  BL-654's obligation for a declared invariant.
- Coder's own evidence reports "ALL PASS" and "ALL SCENARIOS PASS" for
  this exact suite with no run-count or flakiness disclosure — this
  pass's own measurement contradicts that as a categorical claim.

## Not mine to diagnose further

I did not attempt to find the exact race (that is the coder's — likely
either a synchronization fix in the fixture's own git sequencing, e.g.
waiting on push completion before cloning, or a real fix to how the
daemon subprocess reads `core.hooksPath`/hook execution under contention).
Recorded what reproduces and how often, not a diagnosis.

## Verdict

NOT COMPLIANT (intermittently). Bouncing to coder to investigate and
harden against the race, then re-demonstrate non-flakiness (a run-N-times
loop, not a single green run, given the measured rate).

## Revert (BL-490/BL-495)

`record-bounce.js`'s revert check returned `verdict: violation` naming
`cd0d38875c` (the bounced coder commit itself, not an evidence commit —
genuinely authored content, BL-1208's restored-content suppression does
not apply). Reverted on `swarmforge-architect`:
`git revert --no-edit cd0d38875c` -> `6a2235cee7`. Confirmed by content:
`bookkeeping-conflict`/`bookkeeping-path?`/`append-only-merge` are all
absent from `handoffd.bb` and `master_main_reconcile_lib.bb` post-revert,
and the new step handler file no longer exists. Re-ran
`master_main_reconcile_lib_test_runner.bb` (ALL TESTS PASS) and BL-1390's
own suite (`push_sweep_lib_test_runner.bb`, `test_bl1390_post_commit_push.sh`
— both unaffected) to confirm the revert did not disturb the sibling
ticket's already-approved work.
