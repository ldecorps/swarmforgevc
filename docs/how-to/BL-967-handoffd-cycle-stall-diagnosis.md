# Diagnosing a handoffd cycle stall from the log

*How-to. Task-oriented: read `handoffd.log` when the daemon goes quiet, and
know which knob to reach for.*

`handoffd` writes a heartbeat at the start and end of every poll cycle. If the
end-of-cycle heartbeat does not land inside the freshness threshold, the
watchdog kills and restarts the daemon (that watchdog is
[BL-675](BL-675-daemon-log-freshness-watchdog.md) — this guide is about the
*cycle*, not the watchdog).

The failure that used to make this hard: the daemon process stayed alive, its
poll cycle went silent mid-sweep, and the log's last line was some ordinary
per-item action. Every sweep after that point logged only on events, so a
healthy-but-later sweep looked exactly like a stalled one. On 2026-08-19 that
produced a kill/restart roughly every six minutes, 30+ times over.

Two things now make the log answer the question on its own.

## 1. Find the guilty sweep: `sweep-boundary`

Every sweep in the heavy bundle emits one line when it finishes, whether or not
it did anything:

```
sweep-boundary sweep=<name> ms=<duration>
```

So the last `sweep-boundary` line names the last sweep that *completed*, and
the sweep that stalled is the one that should have reported next. A silent
sweep is no longer indistinguishable from a fast one.

These ride the heavy-cycle cadence only. The 1s idle ticks emit none, so the
log does not fill with boundary noise between real cycles.

To read a cycle end to end:

```sh
grep -E 'sweep-boundary|cycle' .swarmforge/daemon/handoffd.log | tail -40
```

Durations are per sweep, so a heavy cycle also tells you where its time went —
useful before concluding anything is wrong at all (see *Slow is not stalled*).

## 2. Find the wedged call: `subprocess-timeout`

Every subprocess wait on the cycle path runs through one bounded chokepoint. If
a child hangs past the bound, the daemon destroys that child's process tree,
logs the attempt, and **carries on**:

```
subprocess-timeout sweep=<name> bound-ms=<n> cmd=<cmd>
```

The call returns an ordinary failure result (exit `124`, mirroring
`timeout(1)`) rather than throwing, so the sweep survives and the cycle reaches
its heartbeat. A wedged `tmux`, `git`, or other child now costs one bounded
wait — never the heartbeat, never a restart.

The line names the sweep it happened in, so a timeout is self-attributing: you
get the sweep *and* the command in one line.

**Update, BL-1102 (2026-08-24):** the same chokepoint used to throw when the
binary could not be *started* at all (absent from PATH, missing path, or not
executable). `handoffd`'s delivery loop has no `catch`, so that throw ran the
`finally` (pid file gone, log line `stopped`) and ended delivery looking like
an orderly shutdown. `sh!` now returns `{:exit 127 :spawn-failed? true …}` for
a spawn that never happened — distinct from exit `124` (bound hit) and from a
command that ran and exited non-zero — so the tick records the failure and the
daemon keeps cycling. If the log ends on `stopped` with no further heartbeat
after a PATH change, check that `tmux` (and other cycle binaries) are still
reachable before treating it as a clean stop.

**Update, BL-1031 (2026-08-24):** BL-1022's spawn-edge closure found three
more libraries on the daemon path still calling unbounded `babashka.process`
(`handoff_inject_lib`, `pre_qa_gate_gather_lib`, `salvage_lib`). Those sites
now use the same `sh!` chokepoint; the BL-1022 named-file ratchet is empty.
A wait-bound hit while gathering the acceptance-contract (gherkin-parser /
resolve_contract_steps) fails the pre-QA gate CLOSED with a finding that
names the wait-bound — it must never look like a clean contract pass.

**Update, BL-1021 (2026-08-21):** the bound above used to cover only the
*exit-code* wait — `(deref proc bound ::timed-out)`. If the direct child
exited promptly but something it spawned kept the inherited stdout/stderr
write ends open, `babashka.process`'s stream-pump futures then resolved with
no bound at all and blocked in `read()` forever — invisible to the diagnosis
above, because `destroy-tree` and the `subprocess-timeout` log line were both
downstream of the timeout branch and never reached. The bound now covers the
whole call, exit wait and stream drain together, at any process depth, so a
missing `subprocess-timeout` line is no longer possible for this failure
shape — see the BL-1021 entry in
[`Specification.MD`](../reference/Specification.MD) for the mechanism.

## The bound, and when to change it

The default is **60 seconds**, comfortably under the freshness threshold
declared for `handoffd` in `swarmforge/scripts/daemon_log_freshness.conf`
(120s at time of writing — read the conf, not this sentence, for the live
value).

Override it with the env seam:

```sh
SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS=30000
```

Keep any value well under the freshness threshold; a bound above it defeats the
point, because the watchdog fires first.

Note the firm line from the ticket that introduced this: **raising the
freshness threshold is not a fix for a stall.** A threshold change is
acceptable only as a documented consequence of measured healthy-cycle cost,
alongside a real fix — never instead of one.

## Slow is not stalled

A cycle legitimately in the 120–232s range on a Mac is slow-but-healthy work,
not a fault (BL-789). It completes, logs no timeout, and lands its heartbeat.
Do not read a long cycle as a stall unless a `sweep-boundary` line is *missing*
or a `subprocess-timeout` names a call.

## A stale pid lock now fails loudly

The daemon's pid-file lock spin used to be unbounded — a stale lock dir, say
one left behind by a freshness-kill landing inside the tiny lock window, spun
there silently forever. It now gives up after 30 seconds and raises an error
naming the lock dir. Remove the named directory and start the daemon again.

## What was actually wrong on 2026-08-19

`handoff_lib.bb`'s `session-exists?` — and six sibling call sites — still used
`clojure.java.shell/sh`, whose stream-read shim blocks in `read()` forever on a
wedged child. That is the BL-057/BL-061 deadlock family, and it is precisely
why `handoffd` itself moved to `babashka.process` long ago; the library
underneath it never followed. The chase sweep's tail calls `session-exists?`
once per role, unbounded and unlogged, which is exactly the gap between the
last logged chase action and the next sweep that logs anything.

All seven sites now route through the bounded chokepoint, as do the in-cycle
subprocess calls in `briefing_email_lib.bb`, `control_plane_lib.bb`, and
`handoffd.bb` itself.

**BL-1021 (2026-08-21) found an eighth, reached a different way.** The seven
sites above were found by walking `handoffd.bb`'s *load-file* closure — the
gate `daemon_cycle_guard_lib_test_runner.bb` locks in. `dispatch-gap-sweep!`
does not load its collaborator, `swarm_handoff.bb` — it *spawns* it as a
subprocess, an edge type the closure walk could not see at the time.
`swarm_handoff.bb` still used `clojure.java.shell/sh` on all nine of its own
subprocess sites, so the banned API was back on the daemon's critical path
via a hop the gate never checked. It now routes through the same `sh!`
chokepoint (already in scope via `handoff_lib.bb`'s load-file chain, so no
new wiring was needed).

**BL-1022 (2026-08-22) closed that blind spot in the gate itself.** The
closure walk (`resolve-daemon-reachability` in `master_checkout_drift_lib.bb`)
now follows spawn edges as well as load edges, transitively and mutually
recursive, and records which edge kind reached each file so a closure that
silently shrinks is visible instead of passing for the wrong reason. A spawn
target it cannot resolve statically fails the gate loudly rather than being
skipped. Following the new edge grew the daemon's reported closure from 38
files to 53 and surfaced three more files still making an unbounded
`clojure.java.shell`/`process/sh` call, reached transitively through the
`swarm_handoff.bb` spawn: `handoff_inject_lib.bb` (tmux),
`pre_qa_gate_gather_lib.bb` (git), and `salvage_lib.bb` (generic). Fixing
those is out of BL-1022's scope — the same class of follow-up BL-1021 was for
the first offender — so the gate holds them as a named ratchet (an equality
assertion, not a subset, so removing one from the list is a required gate
change, not an incidental pass) rather than leaving the debt invisible again.

One caveat worth keeping in mind: the stall never reproduced under a fixture —
it needs a genuinely wedged tmux server under real load — so that
identification rests on converging evidence rather than a caught-in-the-act
timeout. The full argument is in
[`backlog/evidence/BL-967-identified-wait-20260820.md`](../../backlog/evidence/BL-967-identified-wait-20260820.md).
That caveat is also why the two structural halves matter more than the
diagnosis: if some *other* wait was the real culprit, it is now equally bounded,
and the next occurrence prints `subprocess-timeout sweep=...` naming it.

## Verification note

`handoffd` is Babashka, and this repo wires no mutation, CRAP, or DRY tooling
for `.bb`. This work is gated by the daemon wiring and unit suites plus its own
`daemon_cycle_guard_lib` runners — read any hardening claim about it as that
degraded fallback, not as a mutation-scored pass.
