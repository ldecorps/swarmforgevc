# BL-611: babysitterd — the deterministic health-sweep daemon

**One babysitter exists: the daemon.** The earlier LLM-agent babysitter (a
Telegram-topic `claude` session asked to do deterministic health checking)
never behaved right and has been fully removed — no `babysitter.prompt` role,
no LLM launch path, no wake runtime. `babysitterd` replaces it: a shell/bb
loop that runs the same checks as a pure, unit-tested function over a
snapshot, and reports by nudging the coordinator's pane — never by acting on
the swarm itself.

This also supersedes the operator's private prototype
(`.swarmforge/operator/babysitter_check.sh` + `babysitterd.sh`, untracked and
gitignored). That copy should be stopped once this daemon is live; the
tracked version is the only one that should be running.

## What it checks

Each sweep evaluates a snapshot (tmux sessions, `ps`, file listings/ages, pane
captures, an available-memory reading) against these checks, in
`babysitterd_sweep_lib.bb`:

| # | Check | Fires when |
|---|---|---|
| 1 | live-session-per-role | a role pane has no live `claude` process (via a single `ps -eo pid=,ppid=,args=` snapshot filtered in-process by ppid — portable across GNU and BSD/macOS `ps`, never `pane_current_command`, which lies with a live child); if the `ps` gather itself fails outright, this reports `UNAVAILABLE` for that role rather than a false "no process" CRIT. Missing-session CRITs are mono-router topology aware (BL-804, below) — a dormant role's absent session under router mode is not a finding at all |
| 2 | remote-control-flag | a live process is missing `--remote-control` |
| 3 | handoffd-supervisor-fresh | handoffd/its supervisor is down, or `handoffd.log` is older than 5 minutes |
| 4 | dead-letter-nonempty | `.swarmforge/handoffs/failed/` is non-empty |
| 5 | stuck-in-process | an `inbox/in_process/` parcel is older than 30 minutes, in master **or** any worktree mailbox — under mono-router, most of what used to trip this was the resident forwarding then rotating without completing the received parcel; BL-805 (see `swarmforge/handoff-protocol.md`) closes that at the source by refusing resident-invoked rotation over an undrained `in_process`, so this check now mostly catches genuine stalls |
| 6 | menu-blocked-pane | a pane capture shows an interactive menu/dialog (report only — never picks an option) |
| 7 | busy-but-frozen | busy footer present but the spinner-stripped content hash is unchanged across 3 consecutive sweeps |
| 8 | memory-floor | available memory is below the configured floor; reports `UNAVAILABLE` (never a fabricated OK or CRIT) when no memory facility on the host is readable |
| 9 | rotate-not-honored | the newest completed parcel's rotate instruction is older than a 10-minute grace period, its target differs from `.swarmforge/mono-router-active-role`, and the note is newer than that file's mtime (suppresses a false positive when the persona changed *after* the note completed) |
| 10 | swarm-starved | active tickets exist, zero pending/in-process parcels across every mailbox, no pane shows a busy footer, sustained for **2 consecutive sweeps**; pending never counts abandoned or >120-minute-old parcels |
| 11 | claim-risk | the salvaged `babysitter_assess_lib.bb` scan (a role heading for bounce/halt with HEAD unchanged) |
| — | planned-pause awareness | while `.swarmforge/operator/control-pause.json` marks an active pause, checks 9 and 10 are suppressed (planned quiet is not starvation) |
| 12 | resume-overdue | a pause is still marked active but its `untilMs` expired more than 15 minutes ago (the auto-resume sweep itself failed) |

Every check is a pure function over a snapshot struct — no tmux/fs/sleep in
the test path. `swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`
and `..._property_runner.bb` drive it with fixtures.

**The daemon never fixes anything.** No respawns, no menu picks, no parcel
moves — apart from typing the nudge line into the coordinator's pane, it is
read-only. Judgment stays with the coordinator/human.

## What a nudge looks like

A CRIT finding, or a `stuck-*` WARN, gets typed (with a trailing Enter — typed
messages submit, draft overlays do not) into the coordinator's pane as:

```
babysitter health sweep: <finding 1 message> ; <finding 2 message> ; ... — investigate and take the minimal correct action (or tell the human).
```

Every other WARN, and every OK, stays in the log only. Each finding is deduped
by its key with a 30-minute cooldown, so a persistent condition nudges once,
not every sweep. If the coordinator pane/process is down, the daemon logs
`NUDGE-SKIP` — it never nudges into a dead pane and never falls back to acting
on the swarm itself.

If you see a coordinator pane message starting `babysitter health sweep:`,
treat it as a trusted, deterministic report — not something to re-verify from
scratch.

## Start / stop / ensure

The spawn detaches via `setsid` when it is on `PATH` (Linux), and falls back
to plain `nohup`+`disown` when it is not (macOS ships no `setsid`) — the same
detachment `start_handoff_daemon.sh` already relies on. Either path survives
the launching shell exiting.

Managed by the same lifecycle as every other swarm daemon — no separate
command:

- `start_ancillary_services.sh` starts it (`start_babysitterd.sh`), unless
  `SWARMFORGE_SKIP_BABYSITTERD=1` is set.
- `stop_ancillary_services.sh` / `./stop-swarm.sh` stop it by pidfile, the
  same pattern as the other daemons.
- `kill_all_swarm.sh` (the nuclear path) signals its pidfile too.
- `./swarm ensure` verifies pid-alive and restarts it via
  `start_babysitterd.sh` if not — same posture as the `rc:<role>` component.
  Override the repair command with `SWARM_ENSURE_BABYSITTERD_CMD`.
- `./swarm status` reports a `babysitterd` row (from its pidfile) and no
  longer reports anything for the retired agent-based babysitter.

A second `start_babysitterd.sh` while a live pidfile exists is refused; the
original process is left running.

## Where the log and state live

```
.swarmforge/babysitterd/babysitterd.pid       daemon pidfile
.swarmforge/babysitterd/babysitterd.log       bounded ~2000 lines; one heartbeat line per tick
.swarmforge/babysitterd/streak                swarm-starved idle-sweep streak
.swarmforge/babysitterd/nudge-dedup.json      {finding-key -> last-nudged-ms}
.swarmforge/babysitterd/pane-hash-<role>      last 3 stable content hashes (check 7)
```

This is deliberately **not** `.swarmforge/babysitter/` (no `d`) — that
directory belonged to the retired LLM hawk. Keeping the state dirs distinct
means stale hawk state is never mistaken for daemon state; the daemon never
reads the old directory. `stop_ancillary_services.sh` best-effort clears any
leftover hawk process/socket it finds there as migration hygiene, not as part
of the daemon's own lifecycle.

The heartbeat line lets `daemon_log_freshness.conf` (BL-675) tell "quiet but
alive" from "wedged" — see
[Daemon log-freshness watchdog](BL-675-daemon-log-freshness-watchdog.md),
which also restarts babysitterd if its log goes stale.

## The env skip flipped meaning

`SWARMFORGE_SKIP_BABYSITTER` (no trailing `d`) is now **inert** — it is the
old LLM hawk's skip flag and nothing reads it anymore. The current flag is
**`SWARMFORGE_SKIP_BABYSITTERD`**.

This was a deliberate rename, not a reuse of the old slot: reusing
`SWARMFORGE_SKIP_BABYSITTER` would mean any host whose `.swarmforge/swarm.env`
already sets it (e.g. with a comment like "cost > value for this project",
written about the paid LLM agent) would silently boot with the new, free
deterministic daemon disabled too — reproducing the exact defect this ticket
fixes, under a new name.

If your `.swarmforge/swarm.env` (untracked, host-local) still sets
`SWARMFORGE_SKIP_BABYSITTER=1`, that line is now a no-op and should be deleted
by hand — nothing in this parcel can edit it for you.

**macOS hosts specifically**: if `.swarmforge/swarm.env` sets
`SWARMFORGE_SKIP_BABYSITTERD=1` (trailing `d`) under a stale rationale carried
over from the old paid LLM hawk (e.g. "cost > value"), that reasoning does not
apply to the free deterministic daemon. Since BL-802 (below), babysitterd runs
correctly on macOS — clearing that line by hand is what turns the sweep back
on for this host.

## macOS portability (BL-802)

The gathering layer reads whatever memory facility the host actually has:
`/proc/meminfo` first (or `BABYSITTER_MEMINFO_PATH`, the existing hermetic
test seam — unchanged), falling back to parsing macOS `vm_stat` when neither
`/proc/meminfo` nor the override path is readable. If neither facility yields
a reading, `available-mem-mb` is `nil` and the memory-floor check reports
`UNAVAILABLE` rather than fabricating a reading — the old behavior silently
defaulted to 999999MB available, which masked real low-memory conditions as
OK.

Both the pane process gather and the memory-floor gather now distinguish "the
gather tool itself failed" from "the thing being checked for is genuinely
absent" — a failed gather reports `UNAVAILABLE` in the log; it is never
nudge-eligible (`UNAVAILABLE` is neither `CRIT` nor a `stuck-*` `WARN`), so it
never produces a false CRIT nudge and never silently passes as OK.

## Mono-router topology awareness (BL-804)

Under `config rotation router` only two sessions stand: the resident (first
non-coordinator `roles.tsv` session) and the coordinator. Before this fix,
check 1 CRIT'd on every dormant role's absent session anyway — 6 false
CRITs per sweep on a live mono-router install (specifier, cleaner,
architect, hardender, documenter, QA) — and because CRITs are nudge-eligible,
that noise re-hit the coordinator's pane every 30-minute dedup window.

`babysitter_check.bb` now resolves rotation-router mode the same way
`handoffd.bb` does — swarm-identity rotation key, else the identity-recorded
active pack conf, else the tracked `swarmforge/swarmforge.conf` — via
`mono_router_lib.bb` (`rotation-router-from-identity?`,
`conf-rotation-router?`), and stamps each role's `:should-stand?` from
`mono-router-lib/should-have-standing-session?`. `check-live-session` in
`babysitterd_sweep_lib.bb` suppresses a missing-session finding only when the
gatherer says that role should not stand; a present pane is always fully
checked (process/menu/frozen/remote-control), and a required session
(resident or coordinator) still CRITs if missing. Non-router packs are
unchanged — every role is expected to stand, exactly as before BL-804.

The daemon never grows a second topology parser: this is a call site for the
same `mono_router_lib` resolution `handoffd` already uses, not a
reimplementation.

## Claim-risk stall detection restored (BL-809)

`babysitter_assess_lib.bb`'s `worktree-head-commit-10` (the HEAD read check 11
scans with) used `process/shell` without `:out :string`, which inherits
stdout instead of capturing it — leaking the raw 10-char hash to the console
on every sweep — and left `:out` a `NullInputStream`, so trimming it threw
into the broad `catch` and the function returned `nil` even when `git`
succeeded. `scan-claim-risks`, the production entry point, always hits that
fallback, so `head` was permanently `nil`: `head-unchanged?` was always
false, and three of the seven claim-risk severities — `:watch`,
`:warn-uncommitted`, `:warn-fixture-droppings` — could never fire.
`list-untracked-files` had the identical bug on the same call path.

Both now use `process/sh` (captures stdout by default, matching
`handoffd.bb`'s already-correct equivalent) and degrade to `""` / `[]` on
failure instead of `nil`. The stdout leak is gone, and the stall detector — a
role holding a claim past its idle timeout with HEAD unmoved — can fire
again. Row 11 above is otherwise unchanged: same trigger, same nudge path,
now actually reachable.

## Verify

```bash
bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb
bb swarmforge/scripts/test/babysitterd_sweep_lib_property_runner.bb
bash swarmforge/scripts/test/test_babysitter_check.sh
bash swarmforge/scripts/test/test_babysitterd_lifecycle.sh
```

Acceptance feature:
[`specs/features/BL-611-deterministic-babysitterd-managed-by-swarm-lifecycle.feature`](../../specs/features/BL-611-deterministic-babysitterd-managed-by-swarm-lifecycle.feature).

The BL-802 macOS-portability behavior above has its own acceptance feature:
[`specs/features/BL-802-babysitterd-macos-portability.feature`](../../specs/features/BL-802-babysitterd-macos-portability.feature).

The BL-804 mono-router topology-awareness behavior above has its own
acceptance feature:
[`specs/features/BL-804-babysitter-mono-router-topology-awareness.feature`](../../specs/features/BL-804-babysitter-mono-router-topology-awareness.feature).

The BL-809 claim-risk stall-detection fix above has its own acceptance
feature:
[`specs/features/BL-809-worktree-head-read-leaks-stdout-and-always-returns-nil.feature`](../../specs/features/BL-809-worktree-head-read-leaks-stdout-and-always-returns-nil.feature).
