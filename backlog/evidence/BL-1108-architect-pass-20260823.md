# BL-1108 architect pass

- Reviewed commit lineage: cleaner `e5f6f71b8a` (shared `agent_process_marker_lib.bb`) on coder stamp-off `4d53be3a4f` of hotfix `f02f6ae5b4`.
- Forward commit: `2cbee60661` (property sync gate retargeted; received `e5f6f71b8a` is ancestor).
- Inventory: NONE
- Dependency-rule gate: no `extension/src` paths in this parcel (bb + acceptance/property only) — N/A; full-repo scan still shows standing `telegram-front-desk-bot` ↔ `telegramCursorOperator*` acyclic debt (BL-759 class; not introduced here).
- Co-change: intentional shared-lib coupling among marker lib / babysitter_check / swarm_ensure / swarmforge.sh; no new architectural fan-out to bounce.
- Invariants: both encoded in `bl1108CursorSeatReadiness.property.test.js`; green via `vitest.properties`; break-4 non-vacuity on ensure load-file removal RED then restored.
- Architecture: single marker map owned by lib; babysitter re-exports; ensure calls lib; non-Claude RC `off` via `rc-applicable?`; Cursor launch uses prompt-file (hotfix contract). No tile/host boundary breach.

By architect.
