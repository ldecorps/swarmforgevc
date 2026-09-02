# Intake: operator hotfix landed - specifier pane no longer restaffed with coordinator.sh by `swarm ensure`

Filed by the Operator (2026-09-02, human-directed via Claude Code). NOTICE
plus a BL-848 stamp-off request; the specifier drains this like any root item.

## What landed on main (live immediately - swarm_ensure.bb is a per-run CLI)

`195de28861` (cherry-pick of `abf0c3154a`) - trailer
`Hotfix-Certification: pending`, ledger row recorded.

`rc-launch-role` in `swarmforge/scripts/swarm_ensure.bb` classified the first
roles.tsv row (specifier under full-forge) as the mono-router resident and
handed the RC repair the role named by `.swarmforge/mono-router-active-role` -
a stale `coordinator` from the morning's mono-router run. The RC check read
the specifier pane against coordinator.sh's flag, called it :degraded and
`respawn-pane`'d coordinator.sh INTO `swarmforge-specifier`: duplicate
coordinator, zero specifiers, specifier inbox backing up (13:18, 16:34, 17:30
today - the coordinator's own evidence
`backlog/evidence/coordinator-specifier-pane-duplicate-coordinator-20260902.md`).
BL-1020 already ruled a stale marker is not topology on a standing pack; the
RC repair path never got that rule. It now resolves through
`mono_router_lib/resolve-resident-role` (honours the marker only when
`rotation-router-mode?`).

Mitigation already applied live: the stale marker was moved aside
(`.swarmforge/mono-router-active-role.stale-20260902T1107`) and the duplicate
coordinator in the specifier pane was terminated; handoffd's role-keyed
chase-respawn restored `specifier.sh` (pts/5, 19:00:32). Role census: 1
coordinator, 1 specifier, 8/8 seats correct.

## Evidence (TDD, isolated worktree, RED then GREEN)

- New `RC-7b` in `test_swarm_ensure.sh`: standing identity (blank rotation),
  stale marker `coordinator`, correctly-staffed specifier. RED: fake tmux
  recorded `respawn-pane -k -t swarmforge-specifier zsh .../coordinator.sh`.
  GREEN: no respawn, `rc:specifier: HEALTHY`.
- Full `test_swarm_ensure.sh`: 51 PASS / 0 FAIL; RC-7 (router pack, marker
  honoured) unchanged.

## Two side findings for the specifier (not fixed here)

1. `rc-cmdline-fn` runs `SWARM_ENSURE_RC_CMDLINE_CMD` via
   `sh -c "$CMD" sh <socket> <session>`; the existing RC-7/RC-8.. fixtures
   set a bare script path, so their fakes receive NO arguments, answer "no
   process", classify :down and pass vacuously. RC-7b forwards `"$1" "$2"`
   explicitly. Worth a chore to fix the older fixtures the same way.
2. After the wrong respawn, ensure's report line still read
   `rc:specifier: HEALTHY` - the post-repair recheck does not catch a pane
   respawned with a different role's script. Worth its own defect.

## Asks

1. Specifier: mint ONE BL-848 stamp-off for `195de28861` and `--link` it
   (grep the SHA across backlog/ first). Consider folding side finding 2 into
   the same review's follow-up.
2. No worker-worktree port needed: `swarm ensure` runs only from the master
   checkout.

By operator.
