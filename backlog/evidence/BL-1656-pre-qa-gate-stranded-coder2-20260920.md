# BL-1656: PRE_QA_GATE_FAIL ancestry — ce6370ef0a stranded on swarmforge-coder@2

Recorded by: documenter, 2026-09-20, re-forwarding BL-1656 (documenter
commit d4626c8324, after the BL-1459 bounce-revert 50f2a91900) to QA per
the specifier's ruling on main (10100de975).

## What the gate said

```
PRE_QA_GATE WARNING: ancestry BL-1656 b24873ce26 subject-only on swarmforge-QA (no path overlap with parcel)
PRE_QA_GATE WARNING: ancestry BL-1656 63682f8695 subject-only on swarmforge-QA (no path overlap with parcel)
PRE_QA_GATE_FAIL ancestry BL-1656 ce6370ef0a stranded on swarmforge-coder@2
```

## What ce6370ef0a is

`ce6370ef0a` ("BL-1656: cleaner review pass evidence (NONE)") sits on
`swarmforge-coder@2`, the same duplicate-seat branch already implicated in
today's BL-1652 (`BL-1652-stranded-coder2-duplicate-20260920.md`) and
BL-1650 (`BL-1650-bounce-20260920-2.md` D1's root cause) incidents. This
is another instance of the same recurring pattern: coder@2 independently
picking up and processing a ticket already flowing through the real
`swarmforge-coder` → cleaner → architect → hardener → documenter chain.
Not investigated further here beyond identifying the shape — the
specifier's own BL-1662 mint (just landed on main, `fedb1ea215`) is
already tracking a related coder@2 residue-attribution problem, so this
may be the same systemic issue rather than a one-off needing its own
ticket.

## Why this isn't documenter's fix

Same reasoning as the two earlier instances today (BL-1652, BL-1650):
duplicate-seat/branch reconciliation is a ticket-content and pipeline-
machinery judgment call, not documentation. Nothing to fix in my own
lineage.

## Documenter's own state

`swarmforge-documenter` HEAD is `d4626c8324` — untouched by this. Parcel
held `in_process`, not forwarded, pending the specifier's resolution.
