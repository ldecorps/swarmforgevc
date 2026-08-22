# Raw intake — babysitter control-plane auto-heal was permanently dead on WSL; Cursor hotfix needs swarm stamp

Status: **new intake, not minted.** Capture only (human via Cursor,
2026-08-22 ~16:50 BST). **Operator/Cursor hotfix already in the tree** —
same posture as BL-811 / BL-849 / BL-879: commit makes it reviewable; this
intake asks the swarm to stamp it off through a high-severity review
ticket, not to re-implement from scratch.

Related (do not conflate)
- **BL-958** (done) — control-plane-missing classification + `./swarm ensure`
  recovery path; response-policy names `babysitterd` as owner, but the live
  owner never ran ensure until this hotfix.
- **BL-802** (done) — meminfo / `vm_stat` fallback for the memory floor; the
  WSL `slurp(/proc/meminfo)` failure mode was not covered and aborted the
  whole sweep.
- **BL-1017 / BL-1018** (done) — per-role session repair; unreachable while
  the sweep died before `assemble-findings`.

## Goal

1. Specifier mints a **high** defect / swarm-review ticket (BL-849 shape):
   verify the human-landed babysitter auto-heal path is correct, guarded,
   and wired; stamp it off through the normal chain.
2. Acceptance must prove the live failure mode that motivated the fix:
   on WSL/Linux, every babysitter tick threw on missing `vm_stat` after
   `slurp` failed on `/proc/meminfo` (`Invalid argument`), so
   `babysitterd.log` showed heartbeats with **zero** `OK`/`REPAIR` lines
   and an open `control-plane-missing` incident never triggered
   `./swarm ensure`.
3. Do **not** widen into tmux segfault root-cause (separate; observed
   `segfault at 208` thrice earlier the same day) unless review opens a
   follow-up.

## What landed (human, Cursor 2026-08-22)

### Observable incident

- Pack productive ~90m, then tmux control plane gone ~16:23 BST; daemons
  UP; dashboard "Live panes unavailable".
- `.swarmforge/incidents/control-plane.json` open with
  `owner: babysitterd`, `command: ./swarm ensure` — and **no ensure ran**.
- `babysitterd.log`: ~192 `Cannot run program "vm_stat"` stack traces;
  0 `OK all checks green`; 0 `REPAIR`.

### Root cause

1. Babashka/`slurp` (seeking readers) fail on WSL `/proc/meminfo` with
   `Invalid argument`; `FileInputStream` reads it fine.
2. Fallback `sh! "vm_stat"` throws `IOException` on ENOENT — `{:continue
   true}` only softens non-zero exits, not spawn failures — aborting
   `-main` before any BL-1017 repair.
3. BL-958 policy named babysitterd as ensure owner, but the gatherer never
   invoked `./swarm ensure` on `control-plane-missing`.

### Fix in tree (files)

- `swarmforge/scripts/babysitter_check.bb` — non-seeking meminfo read;
  `sh!` catches spawn failures; observes via `control_plane_lib`; runs
  bounded `./swarm ensure` on `:ensure-control-plane` repair.
- `swarmforge/scripts/babysitterd_sweep_lib.bb` — `check-control-plane`;
  suppresses racing per-role `ensure-session` when plane ensure is queued.
- Tests: `test_babysitter_check.sh` (L, M), `babysitterd_sweep_lib_test_runner.bb`.

## Out of scope

- Why `tmux: server` segfaults on this host (dmesg earlier today).
- Replacing babysitterd's memory floor with something other than
  meminfo/`vm_stat`.
- Restarting or redesigning handoffd chase-respawn.

---

DISPOSITION (specifier, 2026-08-22): minted as **BL-1071**
(`backlog/paused/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix.yaml`),
a `high` severity swarm-review stamp-off of commit f6b6aef25, as this intake
directed. All three locked human decisions, the related-do-not-conflate list
and the out-of-scope list are carried into that ticket verbatim. 1:1 -
nothing merged, nothing split.
