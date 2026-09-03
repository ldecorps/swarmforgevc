# Stale `mono-router-active-role` is not topology on standing packs (BL-1020)

## The trap

`.swarmforge/mono-router-active-role` is a **cache for rotation-router packs**.
On a standing pack (empty rotation / full-forge), a leftover file (e.g. still
naming `specifier` after a prior router era) is not authority — but
`attach-swarm`'s no-arg / `resident` path used to read it anyway. Paths that
disagree on whether the file is topology are a boy-scout trap.

## Rule

| Pack | Marker |
| --- | --- |
| Rotation router | Honoured as today (resident cache) |
| Standing (non-router) | **Ignored** as topology; pack config / home role wins; leftover reported **stale** on stderr |

Shared decision: `mono_router_lib/resolve-resident-role`. Attach and
`relaunch_resume_cli.bb resolve-resident-role` both use it — as does
`swarm ensure`'s RC repair (`rc-launch-role`, hotfix `195de28861`) and, since
BL-1345, `babysitter_check.bb`'s health sweep: on a standing pack the sweep
now derives no resident role, resident-mailbox state, or dispatch-note
state from the marker at all, instead of reasoning about a resident that
does not exist.

## When a consumer gets this wrong anyway (2026-09-02 incident, BL-1345)

A marker left over from a prior router era (`coordinator`) made `swarm
ensure`'s RC repair — before `195de28861` — respawn the specifier's pane
with the coordinator's launch script, twice, leaving the swarm with no
specifier at all. The failure was quiet from every angle: seven sessions
alive, the pane itself looking healthy — because the RC health check had
been pointed AT the coordinator (the stale marker's role) and so compared
that role against itself and agreed.

BL-1345 closed that blind spot with a second, independent check:
`remote_control_health_lib.bb`'s `assigned-role-mismatch` compares the
OBSERVED process against the role the pack actually assigns the pane —
never against whatever role the caller happened to be asking about — and
reports a `:failed` mismatch naming both. Silent on a rotation-router pack
(a rotated resident legitimately runs another role's script) and silent
when there's no RC flag to compare in the first place. Wired into `swarm
ensure`'s per-role RC loop (`swarm_ensure.bb`), checked only after the
ordinary `actionable?` repair path declines to act — so a pane already
mid-repair isn't double-reported.

## What you see

```text
BL-1020 STALE: mono-router-active-role names 'specifier' on a non-router pack — ignored as topology; pack config resolves to 'coder'.
```

Machine line (stdout): `honour=0|1 stale=0|1 role=<name> recorded=<name-or-empty>`.

## Operator check

```bash
bb swarmforge/scripts/relaunch_resume_cli.bb resolve-resident-role .
# On full-forge with a leftover marker: honour=0 stale=1 role=<home> recorded=<leftover>
./attach-swarm.sh          # must not treat leftover as resident on standing packs
./attach-swarm.sh resident
```

Router packs are unchanged — scenario 02 pins that the marker is still honoured
when rotation is configured.

Acceptance: `specs/features/BL-1020-stale-mono-router-marker-is-not-topology.feature`.
Acceptance (health-sweep gating + assigned-role recheck):
`specs/features/BL-1345-a-stale-router-marker-does-not-staff-a-standing-pack.feature`.

Related: [Relaunch resume (BL-648)](./BL-648-relaunch-resume-orphan-claims.md) —
boot-role resume still reads the marker on **router** packs only.
