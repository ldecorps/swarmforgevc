# Remote-control health/respawn tooling, and its `./swarm ensure` wiring

## Background

Fork/operator-substrate tooling under `swarmforge/scripts/` — not
Milestone-1 extension product — that supervises the swarm's remote-control
(claude.ai/code / mobile) sessions. The three scripts below (retro-ticketed
BL-514, landed un-ticketed via `7dd4d14e`, KEEP per coordinator directive)
were already live and tested before this doc; what's new is the fourth
item — folding the same health check into the routine `./swarm ensure`
sweep.

The trustworthy remote-control (RC) signal is the pane's live `claude`
process still carrying its `--remote-control <name>` flag — **not** pane
scrollback, which scrolls the session banner out of view and false-negatives.

## The three standalone scripts (unchanged by this ticket)

### `remote_control_health.bb <project-root> [--fix]`

Reports RC status for every configured role: `HEALTHY`, `DEGRADED` (live
agent lost its `--remote-control` flag), `DOWN` (agent not running — not
this script's job to revive; see `./swarm ensure`'s `agent:<role>` check),
or `off` (remote control disabled for that role). Exit 1 if any role is
`DEGRADED`, else 0.

With `--fix`: respawns **only** `:degraded` panes from their persisted
launch script (which restores the flag), then re-reports. Never touches a
`:healthy` pane and never acts on `:down` — safe to run against a live
swarm.

### `remote_control_respawn.bb <project-root> [--role N] [--wait-seconds N] [--dry-run]`

Graceful **full** respawn to refresh session URLs (not just repair a
degraded flag). Respawns a pane only while idle — watches for Claude Code's
own busy footer ("esc to interrupt"), the same signal the chase daemon
uses — and waits a busy agent up to `--wait-seconds` (default 180) before
SKIPPING it, never killing mid-turn. `--dry-run` reports each role's
idle/busy state and respawns nothing. Roles are respawned one at a time so
a mass simultaneous restart never races the handoff daemon; any parcel a
respawned agent had already claimed is picked back up by its launch
script's own RESUME-ON-START block.

### `remote_control_health_lib.bb`

The shared pure predicate library both scripts (and the `./swarm ensure`
wiring below) call — `classify`, `actionable?`, `wait-outcome`,
`session-url-in-capture`, `check-role`, etc. Covered by
`swarmforge/scripts/test/test_remote_control_health.sh` (the acceptance of
record for this half — Babashka scripts are gated only by their own shell
unit-test suite; no mutation/CRAP/DRY tooling is wired for `.bb`).

## New: `./swarm ensure` now checks RC too

`./swarm ensure`'s BAU "are the agents up" sweep emits one `rc:<role>` line
per configured role, immediately after that role's own `agent:<role>` line:

```text
agent:coder: HEALTHY
rc:coder: HEALTHY
agent:hardender: HEALTHY
rc:hardender: FIXED (respawned pane to restore --remote-control flag)
```

Behavior per role, driven by `remote-control-health/check-role`:

- **`:healthy` or `:off`** → `rc:<role>: HEALTHY`, no action. For `:off`
  (the role's launch script declares no `--remote-control` flag at all),
  this is a short-circuit on `expected-rc-name` being `nil`: the live
  process is **never probed**. Skipping the probe is load-bearing, not
  cosmetic — probing walks the pane's whole descendant process tree, which
  hangs every ensure fixture that doesn't declare the flag if the
  short-circuit is ever lost. Covered by the RC-6 case in
  `test_swarm_ensure.sh`, which asserts both the `HEALTHY` status and that
  the probe's marker file was never created.
- **`:degraded`** → repaired by respawning the pane from its persisted
  launch script, then reclassified: `FIXED` if the flag came back,
  `FAILED` if it didn't.
- **`:down`** → `rc:<role>: HEALTHY`, no action taken here — a crashed pane
  is entirely the `agent:<role>` check's job (which respawns it and
  thereby restores RC as a side effect). `actionable?` is true only for
  `:degraded`, so the RC check can never double-respawn a pane the
  agent-pane check just revived.

Under mono-router, the resident may currently be running a rotated role's
launch script rather than its home role's — the RC check is evaluated
against that **active** launch script (`rc-launch-role`), never forced back
to home, so a legitimately rotated resident is never misclassified as
`:degraded`.

`rc:<role>` folds into the same aggregation as every other `./swarm ensure`
component: it never aborts the sweep on one `FAILED`, and the overall exit
status is non-zero iff any component (RC included) is `FAILED`.

## Verifying the live path

Against the live swarm (or a fixtured tmux session):

1. `bb swarmforge/scripts/remote_control_health.bb <root>` — one line per
   role, exit 0 when none `DEGRADED`.
2. Induce a `:degraded` pane (a live agent started without the flag), then
   run the same with `--fix` — confirm only that pane respawns and comes
   back `HEALTHY`; a `:healthy` pane is untouched.
3. `bb swarmforge/scripts/remote_control_respawn.bb <root> --dry-run` —
   confirm it reports idle/busy per role and respawns nothing; a busy
   agent is reported as would-wait-then-skip.
4. `./swarm ensure` — confirm `rc:<role>` lines appear alongside the
   `agent`/`daemon`/`operator`/`front-desk` lines, a `:degraded` role shows
   `FIXED`, a `:down` role is left to its `agent:<role>` line (no double
   respawn), and the overall exit status reflects any `FAILED`.

## Related

`docs/how-to/BL-536-provider-auth-error-auto-respawn.md` — a different,
continuous auth-failure healing path for standing roles (handoffd's chase
sweep), not the `./swarm ensure` BAU sweep this doc covers.
