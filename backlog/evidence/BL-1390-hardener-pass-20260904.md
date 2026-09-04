# BL-1390 — hardener pass, 2026-09-04

Merged architect commit `a49ce629b0` (clean pass, no bounce, "extra
scrutiny" given this installs a `post-commit` git hook on the SHARED
`main` checkout — `backlog/evidence/BL-1390-architect-20260904.md`).
Independently re-ran every gate rather than trusting the evidence trail;
given the production stakes (this hook runs on every commit to `main`
across every writer role), read the hook and runner source directly
before trusting any test result.

## Checks re-run, all independently

- `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` — ALL
  TESTS PASSED.
- `bb swarmforge/scripts/test/bl1390_post_commit_push_property_runner.bb`
  — ALL PROPERTIES HOLD over 123 constructed states.
- `bash swarmforge/scripts/test/test_bl1390_post_commit_push.sh` — ALL
  PASS against the REAL hook, real repos, a real bare origin (before my
  own additions below; 17/17 after).
- `run_acceptance.sh` on the BL-1390 feature — 5/5 PASS.
- `bash swarmforge/scripts/test/test_handoffd_push_sweep_wiring.sh` — ALL
  PASS, confirming the daemon's `push-sweep-push!` → `push-main!`
  delegation (invariant 3, one push path) is unaffected.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- Both `required_wiring` anchors confirmed present:
  `push_sweep_lib.bb` named inside `swarmforge/git-hooks/post-commit`;
  step handler `registerSteps` present.
- Read `swarmforge/git-hooks/post-commit` and `post_commit_push.bb` in
  full: bounded `timeout`, unconditional `exit 0`/`(System/exit 0)`,
  `linked-worktree?` fails closed on an unreadable git answer, fetch
  uses the explicit refspec (the coder's own self-caught defect, already
  covered), `push-main!` never uses `--force`.

## BL-149 cooldown gate — hand-authored mutation sweep

`swarmforge/git-hooks/post-commit`, `post_commit_push.bb`, and
`push_sweep_lib.bb` — all DECISION: run. No Babashka/shell mutation tool
wired (Startup Tools) — BL-638/BL-567 fallback. Wrote
`swarmforge/scripts/test/bl1390_post_commit_push_mutation_sweep.sh`, 6
mutants targeting the highest-consequence safety properties (this hook
runs in production on the shared checkout): the shared-checkout guard,
the fail-closed unknown-counts check, the diverged check, `--force`,
the success/failure mapping, and the fetch-failure guard.

First pass: **3 killed** (against the pure-lib unit oracle), **3
SURVIVED** — all three real gaps, none equivalent:

1. **`push-main!` gains `--force`** — the single highest-consequence
   mutant in this ticket, and the existing e2e assertion named exactly
   for it ("no push used force") is a PROXY, not the invariant: it greps
   `log_of`, which only ever contains the fixed strings `log!` writes
   ("pushed"/"push-failed"/...) — never the actual argv passed to `git`
   — so it reads identically whether or not a `--force` flag is silently
   added. Confirmed by hand-applying the mutation and re-running: the
   existing check still read "PASS: no push used force".
2. **`push-main!`'s success/failure mapping inverted** — the pure-lib
   unit runner (`push_sweep_lib_test_runner.bb`) never calls `push-main!`
   at all (`grep -n "push-main" push_sweep_lib_test_runner.bb` → 0
   matches), so no unit-level oracle could ever catch this; only the real
   e2e test exercises it.
3. **`post_commit_push.bb`'s fetch-failure guard dropped** — with the
   guard gone, an unreachable/nonexistent origin still computes STALE
   `rev-counts` from the tracking ref `setup_repo` left behind, reads
   `:should-push`, attempts (and then fails) the push anyway, logging
   `push-failed` instead of refusing before ever shelling `git push`.
   The existing scenario 4 check (`grep -qE
   "fetch-failed|push-failed|counts-unknown"`) is ALSO too broad to
   discriminate this — `push-failed` is inside its own OR-pattern, so a
   guard that lets a doomed push attempt through still reads as a pass.

## Closed with two real fixes to the e2e suite (not the sweep alone)

- **Attempted a PATH-shimmed `git` first for the `--force` check** (a
  wrapper script on PATH that logs argv before delegating to the real
  binary) — investigated why it did NOT catch the mutation: git itself
  PREPENDS `/usr/lib/git-core` to `PATH` before running a hook, and that
  directory ships its own `git` binary ahead of any caller-supplied PATH
  entry, so a PATH shim is structurally unreachable during hook
  execution. Confirmed directly (a debug hook that echoed `$PATH`
  showed `/usr/lib/git-core` first).
- **Switched to `GIT_TRACE`** — an ordinary environment variable, not
  subject to git's PATH rewrite, that propagates through the whole
  subprocess chain (bash → bb → `babashka.process/sh` → git) and makes
  git's own trace machinery log every invocation's real argv, including
  "built-in: git push ..." lines from the hook's own internal calls.
  Verified live before writing the scenario: re-applying the exact
  `--force` mutation and reading the trace file showed `built-in: git
  push --force origin main`. Added as new scenario 5b in
  `test_bl1390_post_commit_push.sh`.
- **Tightened scenario 4's existing check** to require the LAST log line
  specifically name `fetch-failed`/`counts-unknown` (never
  `push-failed`) for a genuinely unreachable origin — confirmed the
  unmutated code logs `fetch-failed` here, never `push-failed`, before
  tightening.
- Both new/tightened assertions confirmed to (a) PASS against the real
  unmutated hook and (b) go RED when the exact mutation they exist to
  catch is hand-applied, per BL-1018's non-vacuity discipline — not
  assumed, run both ways.

Re-ran the sweep with both survivors' oracle switched to the real e2e
shell test: **6/6 killed, 0 survived, 0 equivalent**. Re-ran the full
e2e suite (17/17), the pure-lib unit runner, the property runner (123
states), and the acceptance suite (5/5) after the fix — all still green.

## BL-113 Gherkin mutation

No `Scenario Outline` in the feature (all five scenarios are plain
`Scenario:` blocks) — ran `run_gherkin_mutation.sh` to confirm rather
than assume: `"outcome": "inapplicable"`, matching BL-638. Manifest
stamped.

## CRAP / DRY

This ticket's own diff touches no file under `extension/src` — N/A.

## Process/fixture hygiene

Confirmed no orphaned test processes from this pass (`pgrep`). Swept a
leftover `/tmp/bl1390_daemon.log` and `/tmp/bl1390-post-commit-*` fixture
directory left by an earlier run in this pass (no live process holding
either, confirmed with `lsof`/`ps` before removal).

## Result

Three real gaps found in the highest-consequence safety properties of a
production git hook, all closed with genuine (non-vacuous, RED-confirmed)
tests rather than accepted or dismissed. No orphaned processes or
fixtures remain. Forwarding to documenter.

By hardender.
