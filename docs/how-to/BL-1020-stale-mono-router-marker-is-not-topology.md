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
`relaunch_resume_cli.bb resolve-resident-role` both use it.

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

Related: [Relaunch resume (BL-648)](./BL-648-relaunch-resume-orphan-claims.md) —
boot-role resume still reads the marker on **router** packs only.
