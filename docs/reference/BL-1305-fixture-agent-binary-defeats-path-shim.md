# BL-1305: Fixture Agent-Binary Stub No Longer Defeated by Pane-Shell PATH

`specs/pipeline/steps/roleLifecycleParkUnneededSteps.js`'s fake-`claude`-binary
shim is now reached unconditionally inside a tmux pane, closing the path that
let acceptance fixtures boot real, billable Claude agents.

**Last Updated:** 2026-08-31

## Background

`mkFakeBin()` writes an `exit 0` script named `claude` into a fixture
temp dir, and `fakeEnv()` prepends that dir to `PATH`. When the fixture's
agent command is a bare `claude` resolved by a real shell (as it is inside
a tmux pane, unlike a direct `spawnSync`), the pane shell sources the
user's own startup file, which prepends the directory holding the *real*
agent binary ahead of the fixture's directory. PATH precedence alone
cannot hold against a shell that re-orders PATH, so the bare command
resolved to the real binary — a real agent booted against a throwaway
fixture root and told to begin its role loop.

Measured on 2026-08-30: 21 real agent processes from 7 fixture roots,
alive ~1h50m, ~2.6 GB resident, alongside 22 orphaned fixture roots and 13
orphaned fake-bin dirs. BL-458 and BL-817 (see below) reap what a fixture
spawned; neither one prevents the real binary from being *reached* in the
first place, so even perfect reaping still boots a real agent for the
duration of every run.

## How It Works

`roleLifecycleParkUnneededSteps.js` now gives each fixture its own
`ZDOTDIR`, pointed at a fixture-owned directory containing a `.zshenv`
that prepends the fake-bin directory to `PATH`. zsh reads
`$ZDOTDIR/.zshenv` instead of `~/.zshenv` when `ZDOTDIR` is set, which
*removes* the pane shell's own re-orderer rather than trying to out-race
it. This propagates correctly into a tmux pane, and was proven against two
hand-authored mutants (reverting the `.zshenv` prepend to an append; and
removing `ZDOTDIR` from `fakeEnv()`) — both killed by the property test's
"reach floor" assertion, which resolves the command with isolation removed
(the stub loses) and then restored (the stub wins), so the generator's
states are demonstrated real rather than vacuous.

The new step handler `bl1305FixtureAgentBinarySteps.js` (registered in
`specs/pipeline/steps/index.js`) exercises this through a real tmux pane —
not a direct `spawnSync`, which would not exercise the defect at all. Its
two non-terminal scenarios register their fixture root with the shared
`fixtureReaper` (BL-458) via the `.swarmforge/tmux-socket` pointer file and
a `node:test` `afterEach`, the same pattern BL-817 established, so the new
handler doesn't reintroduce the tmux-server leak BL-817 closed elsewhere.

## What This Does Not Cover

- **Widening the agent column to accept a binary path** was surveyed and
  declined: `swarmforge/scripts/swarmforge.sh`'s `validate_agent` is a
  closed allowlist that refuses a path before anything launches, and
  `write_role_launch_script` dispatches on `case "$agent" in claude)` with
  ~26 further comparison sites driving model resolution, the billing
  guard, and provider-key forwarding. Relaxing that allowlist is a
  mutation-heavy change across every live seat's launch path, not a
  fixture-hygiene slice, and nobody has asked for the capability.
- **A sweep of sibling step-handler files** was surveyed and found
  unnecessary: of the ~20 files sharing the fake-bin idiom, only this one
  resolves a bare command name inside a real tmux pane. The one other file
  that both starts tmux sessions and mentions a `claude` command
  (`bl804BabysitterMonoRouterTopologyAwarenessSteps.js`) fakes its argv
  with `exec -a "claude --remote-control fake" sleep 999` and never
  resolves a real binary at all.

## Related

- [Fixture Tmux-Server Reaper Adoption (BL-817)](BL-817-fixture-tmux-server-reaper-adoption.md) —
  the shared reaper this fix's fixture registers with.
- BL-458 — the original fixture-process-leak reaper BL-817 extended.
