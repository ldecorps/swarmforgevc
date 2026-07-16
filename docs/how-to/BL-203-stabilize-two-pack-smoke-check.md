# BL-203: verifying the stabilize-two-pack daemon-on workflow

## Background

The `stabilize-two-pack` profile (`swarmforge/profiles/stabilize-two-pack.conf`,
launched via the "Run Extension (two-pack stabilize · daemon on)" VS Code
launch config) is a minimal coordinator+coder+cleaner pack with the handoff
daemon left on, used to prove the extension's launch/daemon/handoff path
works end to end without the cost of a full seven-pack run.

Two of the daemon diagnostics scripts — `verify_daemon_lifecycle.sh` and
`collect_daemon_postmortem.sh` — used to call `stat -f FORMAT`, the
BSD/macOS-only form, with no fallback. On Linux/WSL that call fails silently,
so the daemon heartbeat read as missing even when handoffd was healthy. Both
scripts now source `swarmforge/scripts/portable_stat_lib.sh`, which tries the
BSD form and falls back to GNU `stat -c` automatically.

## Running the checks

Two independent, non-destructive scripts verify this workflow. Run them from
the repo root (or pass a root path as the one argument):

```sh
swarmforge/scripts/smoke_check_stabilize_two_pack.sh
```

Checks the **static wiring**: the `stabilize-two-pack.conf` profile defines
exactly `coordinator coder cleaner`, leaves the daemon on (no
`SWARMFORGE_SKIP_DAEMON`), and that `.vscode/launch.json`'s "Run Extension
(two-pack stabilize · daemon on)" entry actually points at that profile with
the daemon left on. It does not launch or stop anything.

```sh
swarmforge/scripts/verify_daemon_lifecycle.sh
```

Checks a **currently-running** swarm: that `handoffd` and its supervisor
process are alive and beating, logging every probe to
`.swarmforge/daemon/daemon-start-audit.log` for post-mortem. Run this against
a live stabilize-two-pack swarm after launch to confirm the daemon actually
came up (smoke check above only confirms the *config* would bring it up).

Both scripts exit non-zero and print a `FAIL`/error line naming what's wrong
if a check fails; exit 0 on success.
