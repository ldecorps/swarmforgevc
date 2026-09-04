# BL-1361 — hardener pass, 2026-09-04

Merged architect commit `aae489bd4d` (COMPLIANT, clean sweep —
`backlog/evidence/BL-1361-architect-20260904.md`). Applied the architect's
dormant-note recommendation directly rather than deferring it to a
specifier note: `test_bl1361_sweep_tells_roles.sh`'s
`fixture_isolation_begin` call did not thread `"$@"` through — added it,
matching every other retrofitted caller from today's session.

## Merge conflicts

`suite-manifest.tsv` union only (`test_bl1361_sweep_tells_roles.sh` added).
`handoffd.bb` and `test_bl1363_close_ticket.sh` auto-merged clean this time.

## Checks re-run, all independently

- `post_qa_branch_sweep_lib_test_runner.bb` — ALL PASS (before my own
  additions below and after).
- `test_bl1361_sweep_tells_roles.sh` — 4 consecutive runs, ALL PASS each,
  including after the `"$@"` fix.
- `run_acceptance.sh` on the BL-1361 feature — 6/6.
- `check_feature_handler_registration.sh` — rc 0.
- required_wiring anchor grepped directly: `registerSteps` exported from
  `bl1361SweepTellsSurfacedRolesSteps.js:68/140`.

## BL-149 cooldown gate — hand-authored mutation sweep

`post_qa_branch_sweep_lib.bb` — DECISION: run. No Babashka mutation tool
wired (Startup Tools) — BL-638/BL-567 fallback. 6 mutants targeting this
ticket's own declared behavior (wake-only-for-dirty, dedupe, the 80-char
truncation cap, role eligibility, `decide-role` priority, and the
`try`/`catch` isolation around `tell!`).

First pass: **3 killed, 3 SURVIVED** — all three real gaps, closed with
non-vacuous tests (each confirmed to pass on real code and fail on the
mutant):

1. **Coordinator/specifier role-based exclusion dropped from
   `sweep-eligible-role?`** — survived because the ONLY existing test
   fixture for the exclusion (`{:role "coordinator" :worktree-name
   "master"}`) also trips the SEPARATE `(not= "master" ...)` worktree-name
   check, masking the role-based branch entirely. Closed with a
   `specifier`/non-`"master"`-worktree-name fixture that isolates the
   role-based check on its own.
2. **`surface-notice`'s 80-char truncation (`subs text 0 80`) dropped** —
   survived because both existing fixtures produce text at EXACTLY 80
   chars (the short-sha is itself capped at 10 chars by the function, so a
   longer sha cannot grow the message), making truncation a no-op either
   way at that boundary. Closed with an unknown, deliberately long reason
   keyword (falls through `surface-reason-text` to `(str reason)`), which
   genuinely forces the untruncated text past 80 and proves the fallback
   fires.
3. **`decide-role`'s `dirty?`/`in-process?` priority order swapped** —
   survived because the two existing cases each set only ONE of the two
   flags true, so neither could see which branch is checked first. Closed
   with a `:dirty? true :in-process? true` case asserting `dirty-worktree`
   wins (the ticket's own framing: dirty is the one reason that does not
   resolve itself).

Re-ran the sweep after the fixes: those 3 mutants now KILLED. Then
extended the sweep with a 4th mutant not in the first pass — removing the
`try`/`catch` around the `tell!` call inside `sweep!`'s `reduce` — because
the existing "one unreachable mailbox does not withhold the rest" test
only exercises `tell!` RETURNING `{:success false}`, never `tell!`
THROWING, and the comment directly above the code says the wrap exists
specifically for the throwing case ("a `tell!` that THROWS must not end
the sweep either"). That mutant SURVIVED too (confirmed via exit code, not
a naive grep for "FAIL" — the mutant makes the whole runner crash with an
uncaught exception, exit 1, which a text-only oracle can misread as a
tool failure rather than a kill). Closed with a new scenario where `tell!`
throws for one role and a second role must still be told; re-confirmed the
mutant is genuinely killed (nonzero exit / uncaught exception) and the
real code passes clean.

Final: **6/6 killed, 0 survived, 0 skipped.** File diffed against a
pre-mutation backup after each mutant and confirmed byte-identical restore.

## BL-113 Gherkin mutation

One `Scenario Outline` present in the feature. Ran the real mutation pass:
`"outcome": "pass"`. Confirmed against the embedded manifest per BL-460
discipline: `{"Total":3,"Killed":3,"Survived":0,"Errors":0}`.

## CRAP / DRY

No `extension/src` file in this ticket's own diff (`aae489bd4d` touches
only backlog/evidence and step-handler/lib files). N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes. Hand-mutation backups
(`/tmp/pqbs.orig*.bb`) removed after use.

## Result

Applied the architect's dormant-note fix directly (uniform `"$@"`
threading); found and closed 4 real mutation gaps (masked-fixture role
exclusion, boundary-coincidence truncation gap, unexercised priority
order, and an unexercised throw path) with non-vacuous tests, each
confirmed to fail on its own mutant before the fix. Forwarding to
documenter.

By hardender.
