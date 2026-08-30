# BL-1224 — the watch adopts a deliberately restarted runtime

Coder, 2026-08-30.

## What changed, and how little of it there is

`operator_runtime_watch_lib.bb` gains two pure functions and one branch:

- `adoptable-pid` — the pid to adopt, or nil when this is a genuine crash;
- `adopt-entry` — the tracked entry following the new pid, `:attempts`
  untouched;
- `decide` consults them between the deliberate-stop gate and `check-one-fn`.

`operator_runtime_supervisor.bb` passes `:pidfile-pid`, read fresh each tick,
and gains a `:adopted` arm in `log-event!`.

`check-one!` is not touched. It is shared by five supervisors that must not
change behaviour, and `decide` is the operator-runtime watch's alone — the seat
the ticket pointed at, and the reason this stays a small slice.

## Why the branch and not a counter reset

`decide`'s existing structure already makes a guarantee by construction rather
than by convention: the deliberate-stop branch provably never restarts anything
because it never calls `check-one-fn`, the only thing that can spawn. The
adoption branch is the same shape for the same reason — `check-one-fn` is also
the only thing that counts an attempt, so "an adoption starts nothing and spends
nothing" is not two behaviours to remember but one path not taken.

That is also why the human's third option (reset attempts on intentional
restart) was not the one to build: it corrects a budget after the miscount
instead of not miscounting. And the second (make sync signal the watch) is a
contract between two processes that has to be maintained; the pidfile already
distinguishes the two cases, so the watch stops being wrong even if a fourth
thing restarts the runtime tomorrow.

BL-1154's `voluntary-build-stale-started-entry` is the precedent followed: a
deliberate non-crash gets its own event rather than being charged to the crash
budget.

## No new liveness predicate

`adoptable-pid` takes the caller's own `alive?`, which in production is
`pid-alive?` — the cmdline-checked one. Pid reuse stays a crash only because
that predicate already rules it out, and BL-993's architect bounce was
specifically about not growing a second, diverging liveness check. The
constraint is honoured by *not writing anything*, which is the easiest kind to
get wrong by accident.

## One thing the ticket did not name and the invariant did

Invariant 3 says every adoption is visible in the watch's log. `log-event!`'s
`case` ended in a bare `nil` default, so `:adopted` would have been **silently
invisible** — the event fires, the status file updates, and the log says
nothing. Adding the `:adopted` arm fixes the instance; the default arm now logs
the event name instead of swallowing it, which is the same fail-safe direction
`announcement-for-event` already documents for its own default and for the same
reason: a new event should be noisy and wrong rather than quiet and missing.

## The invariants (BL-654)

`swarmforge/scripts/test/bl1224_watch_adoption_property_runner.bb`, seeded LCG.

Reach is drawn directly over the adversarial space rather than sampled from a
wide one: the pidfile from the FOUR states that exist (different live runtime,
the dead tracked pid, absent, live-but-unrelated), each floored at 60; whether
the tracked pid is still alive, floored at 120 each way; and the attempt count
across the give-up boundary, so an adoption is checked to spend nothing whether
the budget is fresh or nearly gone. A random integer pidfile would produce the
adoption case — the only one that changes behaviour — almost never.

Measured: 270 / 297 / 324 / 309 across the four states, 606 tracked-dead, 300
with the budget already spent.

Invariant 1 is stated as an equivalence — an adoption happens **exactly** when
the pidfile names a different live runtime — so both directions are checked on
every draw: a deliberate restart that was not adopted, and an adoption that
masked a crash, are separate named failures.

Invariant 2 is checked as consequence AND cause: spawned zero, attempts
unmoved, AND the restart state machine never reached. Asserting only the
counters would pass against a fix that reached the machine and undid the damage.

**Non-vacuity, all three by breaking the code and running:**

| break | result |
|---|---|
| adopt whenever the pidfile names any pid (pid reuse masks a crash) | P1 FAILS |
| an adoption bumps the attempt counter | P2 FAILS |
| `:adopted` added to the announced set | P3 FAILS |

Restored; ALL PASS at 400 runs each.

## Runs

| what | result |
|---|---|
| BL-1224 acceptance | **7/7** |
| `bl1224_watch_adoption_property_runner.bb` | ALL PASS, 400 runs each |
| `operator_runtime_watch_lib_test_runner.bb` (extended) | ALL PASS |
| `test_operator_runtime_watch_adoption.sh` (new, end to end) | 15/15 |
| `test_operator_runtime_control_lost.sh` | ALL CHECKS PASSED |
| `front_desk_supervisor_lib_test_runner.bb` + tick + liveness | ALL PASS / ALL CHECKS PASSED |
| suite inventory | ok — 438 files, the new shell test registered |

The new shell test is **red-capable, checked**: with the adoption branch
disabled it fails 6 of its checks. It drives the real
`operator_runtime_supervisor.bb --check-once` over a temp root, with a real
`bb` process standing in for the runtime — because the discriminator IS the
command line, and a bare `sleep` would not exercise the pid-reuse case at all.

## Out of scope, untouched

Everything in BL-1225; whether `build_freshness_cli.bb` should restart the
runtime at all, or how often the coordinator syncs; routing
`restart-operator-group!` through `start_operator_runtime.sh` (a real gap, and
recorded as a remaining slice on epic BL-539, carrying a behaviour question
this slice must not answer); the other five supervisors sharing `check-one!`;
and the freshness-cron / `operator.done` paths the source intake itself put
aside.

This ticket makes the watch correct about restarts it did not perform. It does
not reduce their number.
