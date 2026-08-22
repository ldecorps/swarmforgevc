# Raw intake — WSL tmux 3.4 control-plane segfault; Cursor hotfix needs swarm stamp

Status: **new intake, not minted.** Capture only (human via Cursor,
2026-08-22 ~17:10 BST). **Operator/Cursor hotfix already in the tree** —
same posture as BL-811 / BL-849 / BL-879: commit makes it reviewable; this
intake asks the swarm to stamp it off through a high-severity review
ticket, not to re-implement from scratch.

Related (do not conflate)
- **BL-958** (done) — control-plane-missing classification + `./swarm ensure`
  recovery. Ensure can restore panes after a crash, but cannot stop Ubuntu
  tmux 3.4 from segfaulting again.
- **INTAKE-babysitter-control-plane-auto-heal-hotfix** — separate: babysitter
  never ran ensure on WSL because `vm_stat` aborted the sweep. That hotfix
  restores auto-heal; this one stops the underlying tmux crash loop.
- Upstream tmux commit `6234d79` (“Do not set manual size if no window”),
  present in **tmux ≥ 3.7**, absent in Ubuntu’s 3.4 package.

## Goal

1. Specifier mints a **high** defect / swarm-review ticket (BL-849 shape):
   verify the human-landed PATH preference, version warn, soft harden
   options, and how-to/install script are correct; stamp through the
   normal chain.
2. Acceptance must prove the live failure mode:
   dmesg showed repeated `tmux: server` SIGSEGV `segfault at 208` on
   `/usr/bin/tmux` 3.4; after bounce, the control-plane server must report
   `#{version}` **3.7b** (or other ≥3.7) from `~/.local/bin/tmux`, not 3.4.
3. Do **not** widen into babysitter meminfo/`vm_stat` (already filed) or
   second-coder capacity work.

## What landed (human, Cursor 2026-08-22)

### Observable incident

- Control plane died repeatedly while daemons stayed UP
  (`control-plane-missing`); ensure restored agents, then the 3.4 server
  crashed again within minutes.
- Live probe before bounce: client on PATH was already 3.7b, but
  `tmux display-message -p '#{version}'` on the swarm socket returned
  **3.4** and `/proc/<pid>/exe` → `/usr/bin/tmux` (server created before
  the 3.7b install).

### Root cause

Ubuntu tmux 3.4 NULL-window deref in `resize.c` when
`WINDOW_SIZE_MANUAL` is set (fault at offset 0x208). Fixed upstream in
3.7+. Soft option tweaks alone do not replace the version upgrade.

### Fix in tree (files)

- Host: official static **tmux 3.7b** at `~/.local/bin/tmux` (no root);
  control plane bounced (`kill-server` + `./swarm ensure`) so the live
  server is 3.7b.
- `swarmforge/scripts/swarmforge.sh` — `prefer_local_tmux_bin` before
  ensure/launch; `warn_if_tmux_too_old` when &lt; 3.7; `harden_tmux_server`
  (`focus-events off`, `window-size largest`).
- `swarmforge/scripts/control_plane_lib.bb` + `swarm_ensure.bb` —
  `harden-server!` after plane restore / when already `:up`.
- `swarmforge/scripts/install_tmux_wsl.sh` — reproducible install from
  `tmux/tmux-builds` release.
- `docs/how-to/BL-tmux-wsl-segfault-upgrade.md` — ops bounce procedure.

### Live verify (post-bounce)

- `#{version}` = 3.7b; exe = `~/.local/bin/tmux`; all agents UP;
  `focus-events=off`, `window-size=largest`.

## Out of scope

- Packaging tmux 3.7 into apt / requiring sudo.
- Operator-runtime tmux socket (separate process; upgrade optional).
- Doubling coder seats or difficulty-aware routing (BL-1001).
