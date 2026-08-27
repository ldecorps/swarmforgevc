# Pipeline teardown's copilot kill is root-scoped (BL-888)

`kill_pipeline_swarm.sh` (and its legacy alias `kill_all_swarm.sh` /
`./swarm-kill`) must stop **this** project's SwarmForge Copilot agents only.
An unscoped `pkill -f 'copilot.*SwarmForge'` would signal every matching
process on the host — including agents belonging to a sibling project root
you did not ask to stop.

## What to expect

After a pipeline-only stop for root `$ROOT`:

| Copilot argv names… | Result |
|---|---|
| This `$ROOT` (usually `-C '<worktree under $ROOT>'` plus `--name 'SwarmForge …'`) | Signaled; log: `signaled SwarmForge copilot processes` |
| A different project root, or no match | Left alone; log: `no SwarmForge copilot processes` |

Empty host (no Copilot agents) is success with the "no … processes" line and
exit 0 — not a failure.

Matching walks `ps` argv (or the `SWARMFORGE_COPILOT_PS_FILE` fixture seam
in tests), never a bare tool-name `pkill`. Helpers:
`copilot_pids_for_root` / `copilot_argv_matches_root` in
`swarmforge/scripts/kill_pipeline_swarm.sh`.

## Related (different scopes)

- [Lifecycle script scope (BL-637)](BL-637-lifecycle-script-scope.md) — which
  stop verb is pipeline-only vs full stack.
- BL-730 — the **read-only** post-kill survivor *check* (match scope), not
  this kill step.
- BL-782 — liveness/audit probes; out of scope for this ticket.

Acceptance:
`specs/features/BL-888-teardown-copilot-kill-scope.feature`
