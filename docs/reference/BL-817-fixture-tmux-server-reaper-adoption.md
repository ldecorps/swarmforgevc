# BL-817: Fixture Tmux-Server Reaper Adoption

Seven acceptance step-handler files that start real, detached tmux servers
as fixtures now register them with the shared `fixtureReaper` (BL-458)
instead of relying on hand-rolled terminal-step `cleanup()`. A new standing
gate refuses any step-handler file that starts a tmux server without that
registration.

**Last Updated:** 2026-08-19

## Background

Six (later found to be seven) files under `specs/pipeline/steps/` started a
real detached tmux server in `startTmuxSessions()` and tore it down only
from `cleanup(ctx)`, called from each scenario's terminal `Then` step. A
mutant that fails an assertion before reaching that step — or the runner
receiving `SIGTERM` — skips `cleanup()` entirely, so the server, detached
on its own socket, outlives the run. The BL-807 hardening pass measured
this directly: 22 Gherkin mutations, 5 leaked tmux servers, 2 still alive
hours later.

`specs/pipeline/steps/lib/fixtureReaper.js` (BL-458) already solves exactly
this class of leak for other fixture trees: `track(root)` registers a root
against `exit`/`SIGINT`/`SIGTERM` handlers installed once; `reap(root)` is
idempotent against a scenario's own inline teardown and, for a tracked root
with a `.swarmforge/tmux-socket` pointer file, runs `tmux -S <sock>
kill-server`. The six files the hardener's BL-807 pass named never called
it.

## How It Works

### Adoption

Each affected file calls `fixtureReaper.track(root)` **before** its own
tmux server is spawned, so a crash mid-launch is covered too (the ordering
`fixtureReaperAbnormalExitHarness.js` already modeled). Existing inline
`cleanup()` calls are unchanged — `reap()` is idempotent by design, so
normal-path cleanup and the exit/signal handler never double-fault.

Adopters, as landed:

```
alwaysOnOperatorPresenceSteps.js
bl486ReapOrphanedAgentProcessesSteps.js
bl647RotationRouterLivenessSteps.js
bl804BabysitterMonoRouterTopologyAwarenessSteps.js
bl807BabysitterStuckInProcessOwnerLivenessSteps.js
controlLossIsNotAgentDeathSteps.js
```

`bl807BabysitterStuckInProcessOwnerLivenessSteps.js` is a genuine seventh
offender, found by surveying every step file for the literal `new-session`
tmux subcommand rather than trusting the hardener's original count of six:
its own per-scenario `try`/`finally` cleanup covered a thrown-assertion
ending but not a `SIGTERM` to the whole process — the same gap class this
ticket closes.

`tmuxDoubleAnswersInProcessSteps.js` (the sixth name implied by the
hardener's count) was investigated and confirmed to need no change: it
never starts a real tmux server in any of its five scenarios — its
in-process double intercepts `child_process.spawnSync` before the real
`tmux` binary is reached, and its one real-subprocess scenario spawns a
fake `tmux` script via `installFakeTmux`, never the real binary.

### The socket-path guardrail

These fixtures reuse the live swarm's own session names (e.g.
`swarmforge-coder`), so a reaper that discriminates by session name would
kill the running swarm along with a leaked fixture. `fixtureReaper`'s
`killTmuxServer` now calls `isLiveRepoSwarmforgeSocket()` first and refuses
outright on a match, exported for testing. It matches all three real
production socket shapes, verified against their actual writers rather than
guessed:

- `.swarmforge/tmux/<hash>.sock` (`swarm_socket_lib.bb`'s primary socket path)
- `.swarmforge/operator/operator-tmux.sock` (`operator_runtime.bb`)
- `.swarmforge/operator/front-desk-operator-tmux.sock` (`operator_runtime.bb`)

### The standing gate (`tmuxReaperGuard`)

`specs/pipeline/steps/lib/tmuxReaperGuard.js` mirrors
`tempDirTrapGuard.js`'s shape (BL-459/BL-872): a pure
`findTmuxReaperViolation(basename, text)` plus an impure, non-recursive scan
of `specs/pipeline/steps/*.js` — never `lib/`, where `fixtureReaper.js` and
its own abnormal-exit harnesses legitimately call `track()` directly. It
flags a file that contains a quoted `new-session` token without a paired
`require('./lib/fixtureReaper')` and `track()` call, so the idiom cannot
return a seventh time unnoticed.

`extension/test/tmuxReaperGuard.test.js` gives the gate a standing home in
the one suite every parcel runs, including the real "`specs/pipeline/steps`
has zero violations" assertion — `specs/pipeline/test/` alone has no
standing gate running it (see the note in the shared engineering article).
Checked against real false-positive candidates before landing (other
tickets' `/lets-talk/new-session` HTTP paths and `data-testid` strings,
simulated `ps`-output payloads containing the word) — none flagged.

### Invariant coverage

- **Invariant 1** (no server outlives its run, whatever ends the scenario)
  and **invariant 3** (reaping is idempotent) are proven against a real
  process, not a property test — both quantify over OS process/signal
  lifecycle. `specs/pipeline/steps/lib/fixtureReaperTmuxOnlyHarness.js`
  (new) starts a real tmux server, registers it with `track()`, then ends
  one of three ways (self-reap + normal exit; an uncaught exception; an
  external `SIGTERM`), driven by this ticket's new acceptance feature.
  Invariant 3 also has a pre-existing example test in
  `specs/pipeline/test/fixtureReaper.test.js`.
- **Invariant 2** (socket path is the only safe discriminator) is proven by
  `extension/test/fixtureReaperLiveSocketGuard.property.test.js`: every real
  production socket shape is protected under any root (including a root
  that itself lives under a temp dir), a non-matching shape is never
  protected, and a near-miss (one extra nested path segment) is never
  protected either.

### Hardener stopgap removed

The hardener's manual "after a mutation pass, `pgrep -afl tmux` and reap
strays by socket path" bullet (added when this ticket was filed, explicitly
marked as a stopgap to delete once BL-817 landed) is removed from
`swarmforge/roles/hardender.prompt`. The unrelated pre-run orphan-process
`pgrep` check earlier in that file is untouched.

## New Human-Facing Surface

None. This closes a test-infrastructure leak in the acceptance harness; it
changes no extension command, setting, or UI.

## Related Tickets

- **BL-458:** Built `fixtureReaper.js`, the shared primitive these six
  files adopt.
- **BL-413:** Sibling stale-sandbox sweep boundary; unchanged by this
  ticket.
- **BL-459/BL-872:** `tempDirTrapGuard.js`, the shape `tmuxReaperGuard.js`
  mirrors.
- **BL-807:** Hardening pass that measured the leak (22 mutations, 5 leaked
  servers) and raised the `rule_proposal` this ticket answers.
- **BL-654:** Property-testing convention `fixtureReaperLiveSocketGuard.property.test.js`
  follows for invariant 2.
