# Raw intake — parent-orphaned tmp front-desk bridge/bot skipped the age gate; human-landed fix needs swarm stamp

Status: **ARCHIVED** — minted as **BL-879**
(`backlog/paused/BL-879-swarm-stamp-parent-orphaned-front-desk-hotfix.yaml`),
ledger entry 36ea0109e9 linked. Specifier 2026-08-11.

Was: new intake, not minted. Capture only (human via Cursor 2026-08-10
~21:30 CEST, landed 2026-08-11). **Operator hotfix already in the tree** —
same posture as BL-811 / BL-849: commit makes it reviewable; this intake
asks the swarm to stamp it off through a high-severity review ticket, not
to re-implement from scratch.

Related (do not conflate)
- **BL-849** (done) — Darwin process-table stamp-off; this is a *follow-on*
  on the same janitor surface: enumeration works, but the multi-hour
  ancillary age gate still left PPID-1 fixture bridges fighting host :8765.
- **BL-789** (done) — freshness/bridge orphans fighting production front
  desk; tonight's give-up emails are the same failure class with a
  narrower root cause (age gate, not Darwin enumeration).
- **BL-486** (done) — orphan agent reaper; out of scope here.

## Goal

1. Specifier mints a **high** defect / swarm-review ticket (BL-811 / BL-849
   shape): verify the human-landed parent-orphaned front-desk reap path is
   correct, guarded, and wired; stamp it off through the normal chain.
2. Acceptance must prove the live failure mode that motivated the fix:
   disposable-root `start-bridge-headless.js` / `telegram-front-desk-bot.js`
   with PPID 1 (or a dead parent) were swept as candidates but reaped 0
   until the multi-hour ancillary age gate fired — long enough to bind
   host `127.0.0.1:8765`, crash-loop the production bridge, and trip the
   front-desk give-up email.
3. Do **not** widen into babysitter/tmux PPID-1 fast-paths (PPID 1 is
   normal for those) or fixture_reaper redesign unless review opens a
   follow-up.

## What landed (human, Cursor 2026-08-10)

### Observable incident

- Front-desk supervisor give-up emails at ~20:18 and ~21:05 CEST
  2026-08-10: bridge crash-looped on port 8765, hit the 5-restart cap,
  emailed, then auto-re-armed.
- Process table held many `tmp.*/start-bridge-headless.js` + matching
  `telegram-front-desk-bot.js` leftovers with **PPID 1**.
- `orphan-janitor-sweep` was enumerating them (non-zero candidates) but
  logging `reaped 0` — every ancillary still waited on the ~2h stale
  threshold.

### Root cause

Disposable-root front-desk bridge/bot match `tmp-ancillary-cmdline?` and
enter the ancillary path, but `reapable-tmp-ancillary?` required `stale?`.
Fixture supervisors die and leave children reparented to launchd (PPID 1)
within minutes; the age gate is far too slow for a fixed host bridge port.

### Fix in tree (files)

- `swarmforge/scripts/process_table_lib.bb` — new `parent-orphaned?`
  (nil / PPID 1 / dead parent via ProcessHandle).
- `swarmforge/scripts/orphan_janitor_lib.bb` — `front-desk-bridge-or-bot-cmdline?`;
  `reapable-tmp-ancillary?` skips the age gate when both
  `front-desk-bridge-or-bot?` and `parent-orphaned?` hold. Host paths still
  require a disposable-root extract.
- `swarmforge/scripts/orphan_janitor_sweep_lib.bb` — wire the parent probe
  and audit `reason=parent-orphaned-front-desk` when the fast path fires.
- Tests: `orphan_janitor_lib_test_runner.bb`,
  `orphan_sweep_enumeration_unavailable_test_runner.bb`.

### Live verification already done on this host

- Unit runners: both green after the change.
- One-shot sweep: tmp fixture bridges/bots reaped; host bridge/bot PIDs
  untouched; port 8765 stayed with the production bridge.
- `operator_runtime` was restarted onto the new code that evening (later
  lost when auto-pull autostashed the dirty tree; this landing restores
  it).

## Out of scope for this stamp ticket

- Fast-reaping parent-orphaned babysitter/tmux (PPID 1 is normal there;
  keep the age gate).
- Re-opening BL-849 Darwin enumeration / silent-zero work.
- Killing the human's interactive Cursor / Telegram bridge sessions.
- Broader fixture_reaper allowlist work.

## Locked human decisions

1. Treat this as **swarm-review stamp-off of a landed hotfix**, not a
   greenfield implement ticket (same posture as BL-811 / BL-849).
2. Severity **high** — production front-desk give-up emails from fixture
   orphans the janitor already sees but will not kill in time.
3. Decapitation guards stay: never match host-repo paths; disposable-root
   extract remains mandatory; living-parent fixture bridges stay protected
   by the ordinary `stale?` path.
