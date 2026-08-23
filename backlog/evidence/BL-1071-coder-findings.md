# BL-1071 — coder pass: verdicts on the seven review goals

Stamp-off of the human-landed hotfix `f6b6aef25`. This is a REVIEW ticket, so
what follows is a verdict per goal, with what was changed and what was
deliberately left alone.

Gate is degraded by construction (Babashka + shell only, no mutation/CRAP/DRY
wired for either layer): `test_babysitter_check.sh`,
`babysitterd_sweep_lib_test_runner.bb`, and the nine acceptance scenarios. All
green. No mutation ran, and nothing below should be read as implying it did.

---

## 1. `BABYSITTER_FAKE_ENSURE_RESULT` — CONFIRMED, and removed

`run-control-plane-ensure!` checked the env var FIRST and, when set, returned a
fabricated result and wrote a counter file instead of recovering. Anything that
set it in a real environment silently disabled the auto-heal this ticket exists
to deliver — the same class of silent blackout as the incident.

**Removed**, along with `BABYSITTER_ENSURE_COUNT_FILE`. What stands in for it is
the `./swarm` SCRIPT, in the fixture's own project root: the real spawn, the
real bound and the real exit handling all run, and only the target is a
stand-in. Same shape as the expeditor's stop-command fixture.

`test_babysitter_check.sh` case M now also asserts, from the source, that
`getenv "BABYSITTER_FAKE_ENSURE_RESULT"` does not come back. It matches the
getenv CALL rather than the word, so the docstring that explains the removal
does not trip its own guard.

## 2. Bounded in attempts, not in time — CONFIRMED, and fixed

`bash ./swarm ensure` was shelled with no wall-clock deadline. The attempt
budget stops a recovery being *retried* forever and says nothing about one that
never *returns*; a hung ensure held the sweep open so the next tick never
happened. A babysitter that is stuck is indistinguishable from one that is not
running, which is the incident's own shape one level up.

Fixed with `run-bounded!`, mirroring `expedite_cli.bb`'s function of the same
name — including both traps its docstring records, because both apply here:

- `.destroyForcibly` kills the DIRECT child only, so a shell script's children
  survive. The command is wrapped in `setsid` and the whole GROUP is killed via
  `kill -KILL -- -<pgid>`. The `--` is load-bearing and its absence is silent.
- Deref-ing a destroyed process BLOCKS while a surviving grandchild holds the
  stdout pipe, so output goes to files and a timed-out process is never
  deref'd.

Default bound 5 minutes, overridable by `BABYSITTER_ENSURE_TIMEOUT_MS` — the
env seam engineering.prompt sanctions for daemon wiring tests. It moves a
deadline; it cannot disable the recovery.

The REPAIR line now has THREE outcomes, not two. A recovery that never returned
is not a failure (nothing said no) and emphatically not a repair:
`REPAIR [unfinished] control-plane`.

## 3. `sh!` synthesising `:exit 127` — CONFIRMED harmless today, marked

No caller branches on 127 meaningfully. Checked across `babysitter_check.bb`
and `babysitterd_sweep_lib.bb`: the only occurrence of the literal is the
synthesised value itself.

**Not narrowed.** Narrowing the catch to spawn failure specifically would let
every other throw class abort the sweep again, which is the thing the hotfix
fixed and the thing invariant 1 forbids. Instead the synthesised result now
carries `:spawn-failed? true`, so a caller that ever needs to tell a real
"command not found" from a spawn that never happened can, without any
behaviour changing today.

## 4. `observe!` failing silent — CONFIRMED, and fixed

The catch returned `{:classification :unknown}`, and `check-control-plane`
fires only on `:control-plane-missing`. So a throwing observer produced **no
control-plane finding at all** — the sweep printed `OK all checks green` while
knowing nothing about the plane. That is the incident's own mechanism one layer
up, inside the fix for it.

`control_plane_lib/classify` returns only `:up`, `:control-plane-missing` or
`:down`, so `:unknown` could ONLY ever mean "the observer threw". It is now
`:unavailable`, carrying the exception message, and `check-control-plane` emits
an `UNAVAILABLE [control-plane]` finding for it — never a healthy reading,
never an absence, and never a queued recovery.

Reproduced live: with `tmux` absent from every PATH entry,
`daemon_cycle_guard_lib/sh!` throws IOException out of ProcessBuilder (measured
directly — it does not catch spawn failure). Before this change that host
printed the all-clear.

## 5. BL-802's UNAVAILABLE path — CONFIRMED PRESERVED, by running it

Acceptance scenario 05 passes: a failed `ps` gather reports
`UNAVAILABLE [proc-gather-coder]` and raises no half-launch CRIT.

Worth recording, because it produced a FALSE NEGATIVE on the first attempt:
`gather-failed?` is `(and pid (nil? ps-output))`, so the pane must have a **pid**
for a failed gather to be distinguishable from "nothing to look up". A fixture
whose tmux stub answers `list-panes` with anything other than a pid raises the
very half-launch CRIT the scenario forbids — and the fault is the fixture's,
not the production code's. The fixture now supplies a pid, matching the shell
suite's own case F.

## 6. Per-role suppression shape — CONFIRMED

Scenario 02, both rows. The per-role CRIT stands; only the racing repair is
suppressed. Asserted as `REPAIR [ok] swarmforge-*` never appearing and no
`new-session` being issued — not as "no REPAIR line at all", because
`REPAIR [no-launch-script]` is the repair path correctly declining, which is
what the launch-scripts-absent row wants to hear.

## 7. Follow-ups found — narrow, not widened here

**(a) `run-bounded!` now exists twice**, in `expedite_cli.bb` and
`babysitter_check.bb`, carrying the same two hard-won traps. This is the
hand-copy shape BL-571 documented across six sites. It should be one shared
lib.

Deliberately NOT extracted in this parcel: `expedite_cli.bb` is being edited by
**BL-1030** right now (in flight, forwarded to cleaner the same day), and
touching it here would collide with active work — the Concurrent Work
Orthogonality rule. Worth a narrow ticket once BL-1030 lands.

**(b) `daemon_cycle_guard_lib/sh!` does not catch spawn failure.** Measured:
`(daemon-cycle-guard-lib/sh! {:continue true} "definitely-not-a-real-binary")`
throws IOException. Every caller of that lib is one unspawnable binary away
from the failure mode this whole ticket is about. `babysitter_check.bb`'s own
`sh!` is now protected; the shared one is not, and its callers are outside this
ticket's scope.

## Not reopened

`BL-1070` is unmasked by this hotfix, not caused by it — the ticket says so and
nothing here contradicts it. The tmux segfault root cause (BL-1069), the memory
floor's choice of facility, and handoffd chase-respawn are all out of scope and
untouched.
