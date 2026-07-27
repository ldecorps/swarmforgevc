# BL-648: Relaunch Resume and the Orphan-Claim Sweep

**When a `rotation router` (mono-router) swarm restarts, the resident boots
back into whichever role it was in when the swarm last stopped, and every
role's stranded `in_process` claim is checked for a live owner before the
launch continues.**

This runbook explains what the two behaviors do and what you'll see in the
launch log when they fire.

## The Problem This Fixes

Before BL-648, a `rotation router` relaunch always brought the resident up at
its **home** role (usually `coder`), no matter which role it was actually
working as when the swarm was stopped. If a parcel was mid-integration in
another role's `inbox/in_process/` — say `QA`, claimed but not yet
committed — nobody resumed it: dispatch won't re-deliver a claimed parcel,
and the session that claimed it no longer exists. The swarm looked idle even
though a parcel was one stage from landing, and it stayed that way until a
human noticed and ran `rotate_to_role.sh` by hand, or an idle-detection sweep
eventually caught up.

## What Happens Now, In Order

Both checks run automatically during `./swarm` / `swarmforge.sh`'s launch
sequence, after every previous session is confirmed dead and before any new
session is created:

1. **Boot-role resume** (`rotation router` packs only). The launcher reads
   `.swarmforge/mono-router-active-role` — the durable marker rotation
   already keeps up to date — and boots the resident **as that role** instead
   of home, provided the marker names a role the pack actually knows about.
   A missing, blank, or unrecognized marker falls back to booting at home, as
   before.
2. **Orphan-claim sweep** (every pack). Every role's `inbox/in_process/` is
   checked for a claim whose owning session is not alive. A claim belonging
   to the role being resumed in step 1 is left untouched — that role will
   pick its own claim back up via `ready_for_next.sh`. Every other stranded
   claim is moved back to that role's `inbox/new/`, at its original
   priority, so normal dispatch delivers it again.

Neither step can abort the launch: a resolution failure (unreadable marker,
empty `roles.tsv`, an unexpected error) degrades to "boot at home" / "skip
that claim" and prints a loud line instead of raising.

## What You'll See In The Launch Log

Boot-role resume, when it redirects the resident:
```
BL-648 LOUD: mono-router-active-role names an unreadable/unknown role 'foo' (reason ...) - falling back to home role 'coder'.
```
(printed only on the fallback path — a clean resume prints nothing extra;
the resident simply comes up running the resumed role's own launch script)

Orphan-claim sweep, every launch:
```
Orphan-claim sweep (BL-648)...
BL-648: orphan-claim sweep reclaimed 2 parcel(s).
```
or, when there was nothing stranded:
```
BL-648: orphan-claim sweep found nothing to reclaim.
```

A sweep or resolve failure (not a normal outcome — check `.swarmforge/`
manually if you see this):
```
BL-648 LOUD: orphan-claim sweep exited non-zero - continuing launch; claims may still be stranded, check .swarmforge/ manually.
```

## Verifying After a Relaunch

1. Check which role the resident actually came up as — it should match
   `cat .swarmforge/mono-router-active-role` from before the stop, unless
   that marker was missing or named an unknown role.
2. If the log reported reclaimed parcels, confirm they show up in the
   named role's `inbox/new/` (or have already been picked up) rather than
   sitting invisibly in another role's `inbox/in_process/`.
3. A live role's own claim is never touched by the sweep — if the resident
   resumed as (say) `QA` with a parcel still in `QA`'s `in_process/`, that
   parcel should still be there, untouched, ready for `ready_for_next.sh` to
   pick it back up.

## Scope

This covers **task-mode** claims left behind by a dead session at
**launch time** only:

- A batch-mode role's claim-progress sidecar gap (a healthy in-flight batch
  parcel with no progress record) is a related but separate defect —
  see BL-678.
- Mid-run idle/wedged-session detection (BL-528's claim-idle auto-heal) is
  unchanged; it is tuned for a session that is alive but stuck, not for a
  fresh relaunch.
- `kill_all` reporting a false "clean slate" over live survivor sessions is
  a separate defect, not covered here.

## See Also

- **BL-528** — claim-idle auto-heal for wedged (not dead) sessions.
- **BL-576** — aged-note actionability, the other mono-router dormant-role
  drain mechanism.
- `swarmforge/scripts/relaunch_resume_cli.bb` — the CLI wrapping both
  decisions (`resolve-boot-role`, `sweep`), called from
  `swarmforge/scripts/swarmforge.sh`'s `resolve_and_sweep_relaunch_resume`.
