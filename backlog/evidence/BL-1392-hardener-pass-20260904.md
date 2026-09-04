# BL-1392 — hardener pass, 2026-09-04

Merged architect commit `60c1d4415d` (pass 2, clean — D1 from the bounce
fixed and independently re-verified; see
`backlog/evidence/BL-1392-architect-pass2-20260904.md`). That commit also
carried the coder's fixture-isolation retrofit shared with BL-1390/BL-1363
(lock + owner-stamped reap + wall-clock bound), landed together because all
three e2e suites source the same `swarmforge/scripts/test/lib/fixture_isolation.sh`.

## Own finding: dormant argv-corruption in `fixture_isolation_begin`'s re-exec

The architect's pass-2 evidence flagged, but did not bounce, a design note in
the shared library: the wall-clock-bound re-exec (`exec timeout "$bound" bash
"$0" "$@"`) used `"$@"` at a point where it still held the FUNCTION's own
positional args (prefix, bound) rather than the calling script's real
command-line arguments — a caller invoked with real CLI args would see them
silently replaced after the re-exec. None of today's three callers take CLI
arguments, so it was dormant, but a shared library exists precisely for the
next caller.

Fixed in `swarmforge/scripts/test/lib/fixture_isolation.sh`:
`fixture_isolation_begin` now does `shift 2` after reading `prefix`/`bound`,
so `"$@"` at the re-exec point is the CALLING SCRIPT's own argv. Every call
site now threads its own `"$@"` explicitly:
- `test_bl1390_post_commit_push.sh`
- `test_bl1392_dead_cron_never_silent.sh`
- `test_bl1363_close_ticket.sh`

**Verified empirically, not reasoned about** — built a minimal repro script
invoked as `bash script.sh original-arg1 original-arg2`, confirmed BEFORE the
fix it printed `args after begin: [bl1392-argv-test- 30]` (corrupted — its
own original args replaced by the library's prefix/bound), and AFTER the fix
it printed `args after begin: [original-arg1 original-arg2]` (correct).

## Own regression from the merge, found and fixed

The coder's fixture-isolation retrofit (same merged commit) renamed
`test_bl1390_post_commit_push.sh`'s guarded-git helpers to `g()`/`gq()` and
added a self-check refusing any raw `git -C` call outside the guard. My own
earlier scenario 5b (added in a prior BL-1390 hardening pass, before this
merge) used the old `git_q` name and two raw `git -C` calls, so it broke:
`git_q: command not found` and `found 2 raw 'git -C' calls`. Fixed by routing
both through `g`/`gq` like the rest of the file. Re-run confirms scenario 5b
and the guard's own self-check both pass again.

## Checks re-run, all independently

- `test_bl1390_post_commit_push.sh` — 24/24 ALL PASS (rc 0), including my
  scenario 5b fix above and the fixture-isolation guard's own checks (single
  instance, second-instance-exits-cleanly, no cross-run corruption, no raw
  `git -C` outside the guard).
- `test_bl1363_close_ticket.sh` — 20/20 ALL PASS (rc 0). My earlier BL-1363
  additions (exit-code check in scenario 2, scenarios 07/08) intact after the
  `"$@"` threading change.
- `test_bl1392_dead_cron_never_silent.sh` — 16/16 ALL PASS (rc 0): install-time
  marker + non-zero exit + crontab still written, live-daemon exit-0
  unchanged, launcher-path marker survival, all four runtime-sweep verdict
  checks, daemon wiring (label + cadence registration), invariant 3 (never
  starts/restarts/configures cron), no host config file written.
- `cron_heartbeat_lib_test_runner.bb` — ALL TESTS PASSED.
- `bl1392_cron_heartbeat_property_runner.bb` (run with `bb`, not `bash` — it
  is Clojure, not shell) — ALL PROPERTIES HOLD over 30 constructed cases,
  exhaustive over (presence × age-including-exact-boundary × episode-flag),
  plus the episode walked as a sequence (escalate → quiet → quiet-after-
  recovery → escalate-again) and the message's P3 checks.
- `run_acceptance.sh` on the BL-1392 feature — 6/6 pass.
- `check_feature_handler_registration.sh` — rc 0.

## required_wiring anchors (grepped, not assumed)

- `install_swarmforge_crons.sh::CRON_DAEMON_DOWN` — present, lines 69-70.
- `handoffd.bb::cron-heartbeat-stale` — present, line 2221 (the sweep's log
  line), plus `run-sweep! "cron-heartbeat"` registering it on the shared
  cadence.
- `bl1392DeadCronNeverSilentSteps.js::registerSteps` — present, exported at
  line 171.

## BL-149 cooldown gate

- `cron_heartbeat_lib.bb` — DECISION: run.
- `install_swarmforge_crons.sh`, `handoffd.bb` — DECISION: skip-cooldown
  (still actively churning); not mutation-tested this pass per the gate.

## Hand-authored mutation sweep — `cron_heartbeat_lib.bb`

No Babashka mutation tool wired (Startup Tools) — BL-638/BL-567 fallback,
oracle = the lib test runner + the property runner together. The two existing
suites (coder-authored, BL-654) already looked exhaustive by inspection —
confirmed rather than assumed with 6 real mutants on the pure decision logic:

1. Boundary `(<= age-ms bound)` → `(< age-ms bound)` — **KILLED** (the
   inclusive-boundary test in the lib runner).
2. Swap `:stale-escalate`/`:stale-already-escalated` branch order —
   **KILLED**.
3. `(not present?)` → `present?` in the first `cond` clause — **KILLED**.
4. Drop `:absent-escalate` from the `escalating?` set — **KILLED** ("a first
   absent escalates").
5. `next-episode-state`'s `:fresh` branch sets `:escalated true` instead of
   `false` — **KILLED**.
6. `stale-message`'s absent-vs-stale branch condition inverted — **KILLED**
   ("an absent log says so rather than reporting an age of zero").

6/6 killed, 0 survived, 0 equivalent. File restored byte-identical after each
mutant (diffed against a pre-mutation backup, confirmed clean).

## BL-113 Gherkin mutation

`grep -c "Scenario Outline"` on the feature file: 0. Ran
`run_gherkin_mutation.sh` to confirm rather than assume:
`"outcome": "inapplicable"`, matching BL-638.

## CRAP / DRY

This ticket's own diff touches no file under `extension/src` — N/A.

## Process / fixture hygiene

No orphaned `node --test`/`stryker` processes. Live tmux servers checked are
the standing swarm's own sessions, not fixture leftovers. Removed my own
`/tmp` debug scratch (the argv before/after repro dirs, ad hoc run logs) —
left the `.lock`/`.lock.owner` files the fixture-isolation mechanism itself
maintains, which are not litter.

## Result

Own finding (dormant argv-corruption) fixed and empirically verified across
all three shared-library callers; own merge regression (BL-1390 scenario 5b)
fixed and re-verified; BL-1392's own three invariants confirmed via property
runner, unit runner, e2e suite, acceptance, and a hand-authored mutation
sweep, all clean. Forwarding to documenter.

By hardender.
