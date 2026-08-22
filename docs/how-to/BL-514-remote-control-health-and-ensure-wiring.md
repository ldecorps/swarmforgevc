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
  `:degraded` (and, since BL-898, `:session-dead` — see below), so the RC
  check can never double-respawn a pane the agent-pane check just revived.

Under mono-router, the resident may currently be running a rotated role's
launch script rather than its home role's — the RC check is evaluated
against that **active** launch script (`rc-launch-role`), never forced back
to home, so a legitimately rotated resident is never misclassified as
`:degraded`.

`rc:<role>` folds into the same aggregation as every other `./swarm ensure`
component: it never aborts the sweep on one `FAILED`, and the overall exit
status is non-zero iff any component (RC included) is `FAILED`.

## New: `:session-dead` — the flag is fine, the cloud session isn't (BL-898)

`classify` (above) trusts argv alone: the live `claude` process still
carrying its `--remote-control <name>` flag. Argv cannot change while the
process runs, so when the claude.ai/code session behind a correct flag dies,
every RC check described above keeps reporting `HEALTHY` while the human has
no remote control at all — the failure mode a 2026-08-15 coordinator-pane
incident exposed by hand (see `remote_control_health_lib.bb`'s file header).

The pane footer carries the second signal `classify` cannot see: Claude Code
prints a bare `/rc` when its remote-control session is live, `/rc failed`
when it drops. `./swarm ensure`'s RC check now reads that footer line (the
last non-blank line of the pane capture — never the whole scrollback, so a
`/rc failed` merely echoed higher up in scrollback from an earlier redraw is
never mistaken for current chrome) on every sweep and persists a
consecutive-failure streak per role under
`.swarmforge/rc-footer-streak/<role>`. One failed observation never triggers
anything — a mid-reconnect blip must not fire a respawn — only 2+
*consecutive* failed observations reclassify an otherwise-`:healthy` role as
`:session-dead` (`classify-session`, `advance-footer-streak!`). `:degraded`,
`:down` and `:off` are untouched — `:session-dead` only ever reclassifies
what `classify` already called `:healthy`.

`:session-dead` is routed through the same `actionable?` predicate as
`:degraded`, so every existing caller already asking that one question picks
it up automatically — no second, parallel repair path. Its repair
(`repair-session-dead!`) differs from `:degraded`'s immediate respawn in one
deliberate way: it is idle-safe. It waits up to
`SWARM_ENSURE_RC_SESSION_DEAD_WAIT_SECONDS` (default 180) for the pane to go
idle (`remote-control-health/wait-until-idle!`, the same busy signal
`remote_control_respawn.bb` already polls), respawns only then, confirms the
flag came back (`confirm-rc!`), and — invariant 2 — always tells the human
the outcome: the new `claude.ai/code/session_...` address when readable, an
explicit "address not readable yet, check the pane" when it is not, never a
fabricated URL. The notice reuses `operator_telegram_lib.bb`'s existing
`send-message-request` primitive (no new comms path); when Telegram isn't
configured it no-ops, and the outcome is still visible in this component's
own report line either way. A pane still busy past the wait budget is left
alone and reported `FAILED` — never a mid-turn kill.

```text
rc:coordinator: HEALTHY
rc:documenter: FIXED (respawned pane to restore a dead remote-control session - new session: https://claude.ai/code/session_...)
```

Env overrides for fixturing this path (mirrors the existing `remote-control`
overrides): `SWARM_ENSURE_RC_CAPTURE_CMD` (pane-capture probe, for both
footer detection and the idle-wait busy check), `SWARM_ENSURE_RC_NOTIFY_CMD`
(substitutes the human-notify call so a test can assert on exactly what
would have been sent).

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
5. Feed a single failed-footer pane capture through `./swarm ensure`
   (`SWARM_ENSURE_RC_CAPTURE_CMD`) — confirm nothing is triggered. Feed a
   second consecutive one — confirm the role now reports `:session-dead` and
   is repaired. Point the repair at a pane whose busy probe never goes idle
   — confirm the pane is left untouched and reported `FAILED`, not killed.
   Confirm a genuine `:degraded` pane still repairs exactly as before —
   BL-898 must not have moved that behavior at all.

## Related

`docs/how-to/BL-536-provider-auth-error-auto-respawn.md` — a different,
continuous auth-failure healing path for standing roles (handoffd's chase
sweep), not the `./swarm ensure` BAU sweep this doc covers.
