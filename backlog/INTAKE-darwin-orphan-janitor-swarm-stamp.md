# Raw intake — Darwin orphan-janitor was a no-op; human-landed fix needs swarm stamp

Status: new intake, not minted. Capture only (human via Cursor 2026-08-07
~18:00 CEST). **Operator hotfix already in the tree** — same posture as
BL-811: commit makes it reviewable; this intake asks the swarm to stamp it
off through a high-severity review ticket, not to re-implement from scratch.

Related (do not conflate)
- **BL-486** (done) — orphan agent reaper (`/proc`-based); this extends the
  process-table half so Darwin hosts are not silent no-ops.
- **BL-458 / BL-413** (done) — fixture / sandbox sweeps; still `/proc`- and
  `/tmp`-centric. Out of scope unless review finds a required sibling.
- **BL-611** (done) — babysitterd lifecycle; host daemon stop stays
  `stop_ancillary_services.sh`. This intake covers *leftover* worktree /
  disposable-root babysitterd + tmux only.
- **BL-817** (paused) — fixture tmux leak past terminal cleanup; sibling
  shape, different allowlist. Do not fold unless review says so.

## Goal

1. Specifier mints a **high** defect / swarm-review ticket (BL-811 shape):
   verify the human-landed Darwin orphan-janitor + process-table work is
   correct, guarded, and wired; stamp it off through the normal chain.
2. Acceptance must prove the live failure mode that motivated the fix:
   on Darwin (no `/proc`), the janitor used to log `swept 0, reaped 0`
   forever while dozens of disposable-root front-desk bots / bridges and
   worktree `babysitterd.sh` / `bl647` tmux leftovers stayed alive.
3. Do **not** widen into fixture_reaper `/tmp` allowlist redesign or VS Code
   extensionDevelopmentPath reaping unless review opens a follow-up.

## What landed (human, Cursor 2026-08-07)

### Observable incident

- Host Quiet on swarm mailboxes; Cursor bridge busy answering ops questions.
- Process table held ~30× temp `telegram-front-desk-bot.js` + matching
  `start-bridge-headless.js` under `/var/folders/…/T/tmp.*` and
  `bl622-primary-launch-*`, plus worktree `babysitterd.sh` → temp roots and
  stale `bl647.sock` tmux sessions.
- `operator_runtime` was alive and ticking:
  `orphan-janitor-sweep swept 0 candidate(s), reaped 0` every cycle.

### Root cause

1. Janitor / agent-reaper candidate scans listed `/proc` only — **absent on
   Darwin** → empty candidate set every tick.
2. Disposable-root matching was Linux `/tmp/tmp.|aps-|sfvc-` only — Darwin
   `$TMPDIR` (`/var/folders/…/T/…`) never counted as disposable.
3. Ancillary patterns missed `babysitterd.sh` and absolute-path
   `/…/bin/tmux` under disposable sockets (`(?:^|\s)tmux` failed on
   `/usr/local/bin/tmux`).

### Fix in tree (files)

- `swarmforge/scripts/process_table_lib.bb` (new) — `/proc` on Linux;
  `ProcessHandle` (+ `lsof` cwd) on Darwin.
- `swarmforge/scripts/orphan_janitor_lib.bb` — Darwin disposable roots;
  `babysitterd.sh` + path-tolerant `tmux` under those roots.
- `swarmforge/scripts/orphan_janitor_sweep_lib.bb` — enumerate via
  `process_table_lib`.
- `swarmforge/scripts/orphan_agent_reaper_sweep_lib.bb` — same process-table
  seam for cmdline/scan/age/cwd.
- Tests: `orphan_janitor_lib_test_runner.bb`,
  `process_table_lib_test_runner.bb`.

### Live verification already done on this host

- One-shot sweep after the fix: **58** disposable front-desk/headless
  ancillaries reaped; host bot/bridge/runtime untouched.
- Follow-up pattern extension: **4** worktree babysitterd + **2** bl647
  tmux reaped; host `babysitterd` and host `.swarmforge/tmux/…` left alone.
- `operator_runtime` restarted on the new code; ticks no longer stuck at
  `swept 0`.

## Out of scope for this stamp ticket

- Raising `active_backlog_max_depth` (separate operator knob, already set).
- Killing the human's interactive Cursor / Telegram bridge sessions.
- Broader fixture_reaper allowlist or sandbox-sweep Darwin `/var/folders`
  directory sweep (open follow-ups only if review requires them).

## Locked human decisions

1. Treat this as **swarm-review stamp-off of a landed hotfix**, not a
   greenfield implement ticket (same posture as BL-811).
2. Severity **high** — silent no-op reaper on the production Mac host.
3. Decapitation guards stay: never match host-repo paths; disposable-root
   extract remains mandatory for ancillary kills.
