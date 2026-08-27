# BL-1187 intake — babysitterd main-sync deadlock operator hint

**Source:** Operator Cursor session 2026-08-27 ~13:45 BST. Live incident:
main-sync-deadlock tripped (dirty overlap, ahead=144 behind=593). handoffd
notified Telegram once; resident spy shows no actionable hint.

## Problem

handoffd owns BL-891 reconcile and trip-once deadlock alerts, but:
- Deadlock alert is trip-once and generic ("clear overlapping dirty paths")
- babysitterd does not read `.swarmforge/daemon/main-sync-deadlock.json`
- Operators on spy-only view have no repeated, named hint path

## Fix

Teach babysitterd to:
1. Read main-sync-deadlock marker each sweep
2. When active, gather overlapping dirty paths (same git posture as handoffd)
3. Emit CRIT `main-sync-deadlock` finding with `operator-deadlock-hint` text
4. Escalate to operator queue (BL-653); suppress coordinator nudge (BL-1113)

## Out of scope

- Auto-clearing dirty overlap (BL-891 human step)
- Resident spy UI surface (separate ticket)
- Replacing handoffd trip-once Telegram
