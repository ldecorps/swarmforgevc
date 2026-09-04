# BL-1390 — CLEANER PASS (QA bounce rework), 2026-09-04

D1 found and fixed (one item, class: correctness/test-hygiene). Details
below.

## D1 — a typo'd function call silently errored on every run of a standing test

`test_bl1390_post_commit_push.sh` line 315 called `git_q "$root" fetch
origin main`. No such function exists anywhere in the file — the real
guarded wrapper is `gq()` (defined line 88, itself calling `g()` which
enforces the `in_fixture` guard). Every run printed
`test_bl1390_post_commit_push.sh: line 315: git_q: command not found` to
stderr and continued (the file runs under `set -uo pipefail`, no `-e`),
so the intended fetch never happened and the error was silently absorbed
rather than failing the suite.

**Failing command:** `bash swarmforge/scripts/test/test_bl1390_post_commit_push.sh`
**Commit:** `966f3a1c30` (as received)
**First error excerpt:** `test_bl1390_post_commit_push.sh: line 315: git_q: command not found`
**Failure class:** test-hygiene (a real defect in the test's own code, not
in the code under test — see below)
**Expected vs observed:** Expected — every git call in this fixture goes
through the guarded wrapper and no stray stderr noise ships in a
"standing" suite. Observed — a nonexistent function name, unguarded (no
`in_fixture` check runs at all for this call), erroring silently.
**Blamed:** coder (a typo in `966f3a1c30`'s own commit).
**Remediation:** fixed directly — `git_q` -> `gq` (the actual wrapper name).

**Consequence checked, not assumed:** the missing fetch did NOT invalidate
scenario 5b's assertion. `git push origin main` updates the local
`origin/main` remote-tracking ref directly on a successful push (no fetch
needed to observe it), so `counts()`'s subsequent `rev-list` read `0/0`
correctly either way. Confirmed by re-running the suite three times after
the fix: 23/23 PASS, no stderr noise, identical PASS/FAIL outcome to
before the fix — the bug was real but had not (yet) produced a false
positive. Left unfixed, it would have: any future check relying on a
FRESH fetch (as opposed to the local ref a push already updates) would
have silently read stale state.

## What else was checked

- Re-ran `test_bl1390_post_commit_push.sh` after the fix: 23/23 PASS,
  clean (no stray stderr), three consecutive runs.
- `bl1390_post_commit_push_mutation_sweep.sh` — re-ran: 6/6 killed, 0
  skipped, 0 survivors.
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1390 feature —
  re-ran directly: 7/7 PASS, confirming both of QA's bounce items
  (scenario 6's step handler, and the concurrency/reap fix) are genuinely
  present and wired, not merely claimed.
- The traced-commit guard fix (this commit's own headline item): read the
  diff — `in_fixture "$root" && GIT_TRACE=... git -C "$root" commit ...`
  keeps the structural raw-`git -C`-call check honest (a bare `git -C`
  without the `in_fixture &&` guard ahead of it would trip the check the
  suite runs on itself) while still allowing `GIT_TRACE` to be set on the
  one call that needs it.
- `mutation-site-count.js` on the step handler: 200 sites (`over` 100,
  the highest yet — this file has accumulated scenarios across BL-1390's
  full rework history). Reviewed and declined to split: still one
  Gherkin feature, one handler, high assertion density from many
  scenarios rather than mixed responsibilities.
- `jscpd` over the step handler and the shell suite: 0 clones.
- TypeScript compiles clean; the handler discovers via BL-1371's registry.

Forwarding, continuing the chain to architect.

By cleaner.
