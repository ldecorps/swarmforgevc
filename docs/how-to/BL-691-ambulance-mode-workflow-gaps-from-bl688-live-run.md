# Ambulance workflow gaps from the first live run (BL-691)

BL-655 shipped ambulance mode. Its first live run (BL-688) still moved
non-patient work on the sync handoff path, left the patient waiting behind a
busy resident, and allowed engage on a `paused/` ticket — a silent freeze.
BL-691 closes those three gaps. The full engage / hold / release recipe stays
in [Ambulance mode — the hold](BL-655-ambulance-mode-the-hold.md); this page
is the operator-facing delta.

## What changed for you

| Gap | Before (live) | After |
|---|---|---|
| Sync deliver | `swarm_handoff` could land a non-patient parcel in `inbox/new/` despite the hold | Held parcels stay in the sender `outbox/` until release (same predicate as daemon deliver / dequeue) |
| Busy resident | Patient mail waited while chase skipped rotate for `busy` | Patient mail at role R may rotate the resident to R even when busy |
| Engage target | `ambulance BL-###` / CLI `engage` accepted any backlog YAML | Engage refuses unless the ticket is in `backlog/active/`; refusal names the folder and says to promote first (no auto-promote) |

## Operator checklist

1. Promote the patient into `backlog/active/` before engaging.
2. Engage from Control (`ambulance BL-###`) or CLI — expect a refusal that
   names `paused/` / `hold/` / … if you skip step 1.
3. Non-patient parcels you send while engaged should remain in your role
   outbox until `ambulance off` / CLI `release`.
4. On mono-router, expect the resident to leave busy non-patient work when
   the patient's parcel is waiting at another role.

Acceptance: `specs/features/BL-691-ambulance-workflow-gaps.feature`.
