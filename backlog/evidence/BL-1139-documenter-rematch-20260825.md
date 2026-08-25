# BL-1139 — documenter rematch — 20260825

**Tip base:** `origin/main` `b00681fd17` (QA bounce) + product from `daa699acc6`
**Task:** `BL-1139-master-checkout-drift-auto-repair`

## D1 remediation (blame: documenter)

Prior tip `a4c7556c82` lacked `origin/main` ancestry past BL-612 land and
would delete landed BL-612 evidence/docs/APS handlers. Remediation:

1. `git reset --hard origin/main` (`b00681fd17`)
2. Restore BL-1139 product paths from hardener `daa699acc6`
3. Re-apply Spec / how-to / BL-839 update / index / architecture
4. Confirm `dels_on_origin=0`, keep all BL-612 paths, `origin/main` ancestor

## Inventory

NONE (cleared own D1)

## Forward

`git_handoff` to QA, priority `00`, same task name.

By documenter.
