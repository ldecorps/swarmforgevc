# BL-372 architect review — 20260714

## Verdict: BOUNCE to coder — the required self-check cannot detect the failure it exists to catch

## What was reviewed

Merged cleaner's `aa6275ac4d` (coder's original `5391c3225b`, cleaned up by
`aa6275ac4d`'s `read_socket()` dedup + CLI ready-flag test coverage) into the
architect worktree. Architecturally this is clean: pure decision logic
(`swarm_detach_lib.bb`) is properly separated from the thin CLI wrapper
(`check_swarm_detached.bb`, I/O via `ps` only) and the bash I/O wiring
(`start-swarm.sh`), matching the CLI thin-wrapper rule. `dependency-gate.js`
has nothing to say here (no TypeScript touched) and `co-change-report.js`
shows only the expected same-ticket file cluster, all below the coupling
threshold. `swarmforge/` is a maintained fork (local-engineering Architecture
Rule 2) and the ticket's own notes record the human's explicit scope call to
add the new helper module there rather than touch `swarmforge.sh` — compliant,
not a fork violation.

## The defect

The ticket is explicit and non-negotiable on this point: *"The self-check IS
part of this ticket... FAIL LOUDLY if it is not [detached]... An assertion
that cannot fail is decoration: scenario 02 requires the failing path to be
real and reachable."*

`start-swarm.sh`'s `check_detached()` resolves the tmux **server's** OS pid
(`tmux -S "$sock" display-message -p '#{pid}'` — confirmed via `tmux(1)`:
`pid` = "Server PID", not client/pane pid) and asks
`swarm_detach_lib.bb/detached?` whether that pid's **current ppid** differs
from `$$` (`start-swarm.sh`'s own pid). This is the same signal the ticket's
own unit tests (`swarm_detach_lib_test_runner.bb`) and shell acceptance test
(`test_swarm_outlives_launcher.sh`) verify — correctly — against a bare
`sleep` stand-in process. But a real tmux server is not a bare background job:
I reproduced this against a real `tmux -S <sock> new-session -d` twice,
independently, in this sandbox:

```
$ tmux -S $SOCK new-session -d -s testsess 'sleep 60'
my shell pid ($$): 1300603
tmux server pid:   1300625
tmux server ppid:  1641        # already NOT $$, immediately, no sleep needed

$ nohup bash -c "tmux -S $SOCK2 new-session -d -s testsess3 'sleep 60'" &
outer launcher pid ($$): 1303426   # still alive throughout, never exited
tmux server2 ppid:       1641      # identical result, nohup or not
```

`tmux(1)`'s server self-daemonizes: the `tmux new-session` **client** forks
the server and exits almost immediately (by design, independent of any
`nohup`/`disown` on whatever invoked it), so the server is reparented away
from its original caller's pid within a fraction of a second — **before
`check_detached()` ever runs** (it only runs after `wait_for_ready` has
already polled and confirmed the sessions are up, i.e. well after this
reparenting has settled). The two runs above show the exact same result
(ppid `1641`, the sandbox's subreaper) whether or not the launch chain used
`nohup` — the signal `check_detached()` reads never correlates with the
presence or absence of the actual fix.

Concretely: **`check_detached()` will report "detached" against a real tmux
server in every real invocation, including the pre-fix, broken code path.**
It cannot fail the way scenario 02 requires. This is exactly the "assertion
that cannot fail is decoration" trap the ticket calls out by name — except it
slipped past the acceptance suite because the suite's own step handlers
(`swarmOutlivesLauncherSteps.js`, and the `.bb`/`.sh` unit tests) all test
`check_swarm_detached.bb`'s pure logic and I/O wiring against a synthetic
`sleep`/`spawn` stand-in, per their own comments, deliberately never against a
real tmux server — that proof is deferred to "QA's own E2E procedure," so
nothing in the automated pipeline currently exercises the combination that
breaks.

The actual incident (per the ticket's notes) was about a signal — SIGHUP —
reaching the swarm's process group/session when the caller's window/session
tears down, not about parent/child pid topology; the tmux server already gets
a fresh session id at creation (also verified in my repro: `SID` = its own
pid), independent of any launcher fix. `nohup`'s real, relevant effect is
that `SIGHUP`'s disposition is set to `SIG_IGN` and that ignored disposition
is inherited across fork/exec — a property `/proc/<pid>/status`'s `SigIgn`
mask can check directly, unlike ppid.

## Why this is a bounce, not a rule_proposal

The engineering/constitution rule is direct: a correctness defect the
architect can see is a send-back, not a `rule_proposal` — softening it risks
exactly BL-333's outcome (a real defect landing on `main` because a note
alone doesn't stop the parcel). This one is the ticket's own named risk
("an assertion that cannot fail is decoration") materializing in the one
path (a real tmux server) the automated suite never reaches.

## Remediation direction (not prescriptive — coder's call on mechanism)

`check_detached()` needs a signal that actually correlates with whether the
launched tree survives the caller's departure. PPID-vs-caller-pid does not,
against a real tmux server, because the server orphans itself immediately by
design regardless of the fix. Two directions that would: (a) check the
server's actual `SIGHUP` disposition (`SigIgn` bit in
`/proc/<server_pid>/status` on Linux; portability to macOS needs its own
answer, e.g. `procstat`/`ps -o sigignore`) rather than ppid identity, or (b)
restructure the check to prove the property the ticket actually cares about
some other verifiable way. Whatever is chosen, re-verify it can genuinely
fail against a **real tmux server** (not just the `sleep` stand-in), since
that gap is exactly what let this ship.

## Scope check

Neither `5391c3225b` nor `aa6275ac4d` has this evidence file's finding as an
ancestor — this is the first time it has been raised for BL-372.
