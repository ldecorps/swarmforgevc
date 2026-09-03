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

Cursor-staffed seats (agent token `cursor`, binary `cursor-agent`) and other
non-Claude agents are out of scope for **Claude `/rc` repair**: they have no
SwarmForge-wired `--remote-control` flag and no `/rc` footer. `./swarm ensure`
still emits an `rc:<role>` line for them — as **`OFF`** with an action string
(heal via `agent:<role>`; phone via Cursor Remote / Telegram), never a
misleading `HEALTHY`. Half-launch recovery (pane up, expected agent gone) is
owned by the `agent:<role>` check, which uses the same
`agent_process_marker_lib.bb` map as babysitter (BL-1108 stamp-off of hotfix
`f02f6ae5b4`). See
[BL-1079 Cursor residuals — remote-control](./BL-1079-cursor-identity-steward-certify-and-residuals.md#residual-remote-control-vs-claude-rc).

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
agent:documenter: HEALTHY
rc:documenter: OFF (no Claude /rc; heal via agent:; phone via Cursor Remote)
```

(In the example, `coder`/`hardender` are Claude seats with RC in the launch
script; `documenter` is a non-Claude seat with no `--remote-control`. A
Claude seat whose launch script deliberately omits the flag still prints
`rc:<role>: HEALTHY` — see absent-flag short-circuit below.)

Behavior per role, driven by `remote-control-health/check-role` (and the
ensure short-circuit when the launch script has no RC flag):

- **`:healthy`** → `rc:<role>: HEALTHY`, no action.
- **Absent `--remote-control` on the launch script** (`expected-rc-name`
  nil) → **agent-aware**, never probed (BL-514 RC-6 + BL-1108 re-fix of
  hotfix `f02f6ae5b4`). Skipping the probe is load-bearing: probing walks
  the pane's whole descendant process tree and hangs every ensure fixture
  that doesn't declare the flag if the short-circuit is ever lost.
  - **Claude** agent token → `rc:<role>: HEALTHY` (RC off by config is
    satisfied; covered by RC-6 in `test_swarm_ensure.sh`).
  - **Non-Claude** (`cursor`, `local-model`, …) → `rc:<role>: OFF` with
    heal/phone action (never a misleading HEALTHY; RC-6b / RC-6c + BL-1108
    acceptance).
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

## New: assigned-role mismatch — the flag is fine, the role isn't (BL-1345)

Every check above classifies the pane the CALLER was already pointed at —
it never asks whether that pane is even running the role the pack thinks it
is. A 2026-09-02 incident showed the gap: a stale `mono-router-active-role`
marker (see [BL-1020](BL-1020-stale-mono-router-marker-is-not-topology.md))
made `swarm ensure`'s RC repair respawn the specifier's pane with the
coordinator's launch script — and the RC check, pointed AT the coordinator
by that same stale marker, compared the coordinator's role against itself
and printed `rc:specifier: HEALTHY` over a pane running no specifier at
all.

`remote_control_health_lib.bb`'s `assigned-role-mismatch` is the
independent second check this closes: it compares the OBSERVED `--remote-
control` name against `expected-rc-name` — the role the PACK actually
assigns this pane, read fresh, never the role the caller happened to be
asking about. Wired into `swarm_ensure.bb`'s per-role RC loop, evaluated
only AFTER `actionable?` declines to act (so an ordinary `:degraded`/
`:session-dead` repair isn't pre-empted into a failure report), it reports
`:failed` naming both the expected and observed role. Silent in three
cases, each of which would otherwise cry wolf: a rotation-router pack (a
rotated resident legitimately runs another role's script — BL-1020/BL-648
unchanged), no observed RC name (that's the `:down`/`:off` path above, not
a mismatch), and no expected RC name (a launch script with no
`--remote-control` flag at all).

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

## New: `config remote_control off` now gates repair, not just launch (BL-1217)

Before this, `expected-rc-name` derived desired RC state from ONE source —
the persisted launch script — so `config remote_control off` only affected
auto-inject of `--remote-control` at *new* launch time. `swarmforge.conf`
and `packs/full-forge.conf` already name `--remote-control` explicitly on
every Claude window line, so flipping a running pack's config to `off`
changed nothing the health check could see: `classify` still said
`:degraded` (or `:session-dead`), `actionable?` still said true, and
`./swarm ensure` / `remote_control_health.bb --fix` kept respawning the pane
to "restore" a connection the human had deliberately switched off.

`expected-rc-name` now returns `nil` — the same value it already returns for
a script with no flag — whenever the **effective** pack config (read via
`backlog-depth-lib/conf-file-path`: the swarm-identity-persisted conf for
the swarm actually running, or the tracked default) sets `config
remote_control off`, regardless of what the launch script itself says.
`classify` already maps a `nil` expected name to `:off`, and `:off` is
already excluded from `actionable?` — **no new status, no new predicate**.
Every real repair path (`swarm_ensure.bb`, `remote_control_health.bb`,
`remote_control_respawn.bb`) inherits the gate for free through this one
shared seam; `orphan_agent_reaper_sweep_lib.bb` reaps orphaned processes and
never respawns/repairs RC, so it needed no change.

New predicates in `remote_control_health_lib.bb`:

- `remote-control-off-in-conf-text?` — pure: true when conf text sets
  `config remote_control off` (via `coordinator_config_lib/raw-config-value`,
  the same shared `config <key> <value>` reader `launch_contract_lib.bb`
  already reuses — never a hand-rolled third conf parser). An absent key or
  any other value means on, unchanged from today.
- `remote-control-configured-off?` — reads the effective conf file for
  `project-root` and applies the predicate above. **Fails open to on**: an
  unreadable conf file (missing, unparsable) is caught and treated as `""`,
  never a spurious `:off`.

Behaviour preserved byte-for-byte for the config-on and absent-config cases
— this only narrows when `expected-rc-name` returns `nil`, it does not
change what `:degraded`/`:session-dead` mean or the idle-safe respawn
mechanics for either. `config remote_control off` reported by an actionable
check is never a fault: `:off` keeps exiting 0, matching the "Non-Claude" row
in the `./swarm ensure` table above.

This slice deliberately does not touch what a *newly written* launch script
contains — a pack flipped to `off` today keeps its already-written scripts
carrying `--remote-control`, they're just no longer treated as desired
state. Stripping the flag at write time is the sibling ticket BL-1218 (same
source intake, direction 1) — landed, see below; landing both is the
intake's hybrid.

## New: `config remote_control off` decides the launched flag itself, not just auto-inject (BL-1218)

Before this, `config remote_control on|off` governed only auto-INJECT: a
Claude window line that omitted `--remote-control` got one added when the
default was on and none when it was off — but a window line that **named**
the flag explicitly was never consulted about the config at all. Both the
standing `swarmforge.conf` and `packs/full-forge.conf` name
`--remote-control` explicitly on every Claude window line, so on exactly
the packs a human is most likely to be running, `remote_control off`
switched nothing off: the seats still launched with remote control, still
registered cloud sessions, and the persisted launch script — the artifact
BL-1217 above now reads as desired state — still recorded the flag.

The decision now lives in one place, `resolve_remote_control_cli`
(`swarmforge/scripts/remote_control_launch_lib.sh`, sourced by
`swarmforge.sh`, a pure string transform so it is asserted directly rather
than only observed through a written script):

- **Non-Claude seat** — untouched; non-Claude seats have no remote control
  to govern (BL-1108).
- **`config remote_control` on (or absent)** — byte-for-byte today's
  composition: a window line that already names `--remote-control` keeps
  it exactly where it was; a line with no flag gets one appended the way
  `extra_cli+=" --remote-control"` always appended it.
- **`config remote_control off`** — no `--remote-control` flag survives in
  the composed line, whatever the window line said. `rc_strip_remote_control_flag`
  removes the flag and, when present, the session-name token that follows
  it (a following token starting with `-` is a different flag and is kept).

Together with BL-1217, a persisted launch script now never disagrees with
the config that was effective when it was written: BL-1218 makes what gets
**written** honor config off at launch time; BL-1217 makes what gets
**read** by health/repair honor config off for scripts already on disk.
Neither slice rewrites an already-written script when config flips — a
pack switched to `off` mid-run keeps its currently-running seats' scripts
as-is until each is next relaunched; BL-1217 is what keeps the health
check from treating that stale script as desired state in the meantime.

The lib is sourced by `zsh` (`swarmforge.sh`) and tested under `bash`
(`test_remote_control_launch_lib.sh`), so it uses a `sed`-based transform
rather than a token loop over an unquoted parameter — the same word-split
hazard BL-801 names elsewhere, since zsh does not split an unquoted
parameter on whitespace the way bash does.

## Related

`docs/how-to/BL-536-provider-auth-error-auto-respawn.md` — a different,
continuous auth-failure healing path for standing roles (handoffd's chase
sweep), not the `./swarm ensure` BAU sweep this doc covers.
