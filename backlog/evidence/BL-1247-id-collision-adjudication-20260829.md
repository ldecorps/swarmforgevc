# BL-1247 id collision — specifier adjudication

**Raised by:** architect, `note` priority `00`, 2026-08-29 01:07Z —
*"id collision: 2 active YAMLs both id BL-1247, one needs renumber"*
**Adjudicated by:** specifier, 2026-08-29 (~02:15Z)

## Ruling, in one line

**Neither ticket is renumbered.** BL-1247 stays with the BL-593
property-generator ticket. The other claimant —
`BL-1247-reconcile-sweep-kill-switch.yaml` — is **RETIRED as superseded by
BL-1248**, whose work shipped and closed six hours before the collision was
reported. Renumbering it would push already-shipped work back into the
pipeline.

## The two claimants

| | file | where | state |
|---|---|---|---|
| **A** | `BL-1247-bl593-property-generator-emits-values-its-own-contract-refuses.yaml` | `main`, `backlog/active/` | live: minted `b24b0b6ef` 08-28 13:39, approved `0cdcb5102` 13:39, promoted `3b56eb485` 08-29 01:12 |
| **B** | `BL-1247-reconcile-sweep-kill-switch.yaml` | `swarmforge-architect`, `swarmforge-cleaner`, `swarmforge-hardender` only — **not on `main`** | superseded: its work shipped as **BL-1248** |

## Why B is superseded, not merely duplicated

B is the master-main reconcile kill switch, minted from the human's 12:16Z
ruling. That work **landed and closed as BL-1248**:

- `backlog/done/M8/BL-1248-master-main-reconcile-kill-switch-until-bl1236-lands.yaml`
- closed `0a7ebc81d` (08-28 20:24), merged `6ce2a8153` (20:12)
- the deliverable is on `main` now: `swarmforge/swarmforge.conf:352` reads
  `config master_main_reconcile_enabled false` — shipped OFF, per the ruling

So B's acceptance is already satisfied on `main` under another id. There is
nothing left to build.

## How the collision was created (it was not a mint error)

1. **13:35** — the kill switch is minted as **BL-1247** (`0a754dad5`).
2. **13:38:41** — the thirteenth master-main reconcile reset (`88059cd55`)
   discards twelve commits from the preceding four minutes. `0a754dad5` is
   among them: `git merge-base --is-ancestor 0a754dad5 main` → **NO**.
3. **13:39** — the specifier, reading a backlog in which BL-1247 no longer
   exists, mints the BL-593 property-generator ticket on that id. Correctly,
   from the evidence available: the id genuinely was free on `main`.
4. Later — the kill switch is re-minted as **BL-1248** and ships.

B survived only because it had already been handed down the chain
(`310b70170` "Merge main into coder (sync for BL-1247 handoff)") before the
reset, so coder → cleaner → architect → hardender branches each kept a copy
that `main` no longer had. **This is reset wreckage, not a numbering mistake**
— the same defect family as the six erased approvals of 2026-08-28.

## Consequence: the architect's bounce to the cleaner is withdrawn

At 01:58 and 02:02 on 08-29 the architect recorded a bounce
(`724b2e120`, `9b7bebf28`) blaming the cleaner for *"merge `68a16b9ec3`
silently drops critical BL-1247 (reconcile-sweep-kill-switch) ticket file via
a clean one-sided-add case"*.

- **Do not restore that file.** Its absence is the correct end state; restoring
  it resurrects shipped work — the BL-1192 hazard, on a ticket the pipeline
  would then rebuild against a conf key that already exists.
- **The bounce is withdrawn as to this file**, and a correction is recorded per
  BL-990: the cause is a specifier-side id collision manufactured by the reset,
  not cleaner workmanship. The cleaner did nothing wrong.
- **The architect's underlying concern is legitimate and already owned.** "A
  merge silently drops a one-sided add" is exactly **BL-1242**
  (`merge-never-silently-drops-branch-work`, currently parked in
  `backlog/hold/`). Do not re-mint it; nothing here changes that ticket.

## What each holder does

- **architect / cleaner / hardender**: delete
  `backlog/active/BL-1247-reconcile-sweep-kill-switch.yaml` from your own
  branch as retired-superseded-by-BL-1248, and its
  `specs/features/BL-1247-reconcile-sweep-kill-switch.feature` if your branch
  carries one. Do not renumber it, do not forward it, do not rebuild it.
- **nobody** touches A. It is live, approved and promoted, and it keeps the id.

By specifier.
