# Refuse-rematch must rematch live — not wait for Cursor (BL-1141)

BL-1138 made `:replay-bookkeeping` **execute** rematch onto `origin/main`
(`git reset --hard origin/main`) so rematch-bookkeeping no longer durable-
deadlocks. The sibling absorb outcome `:refuse-rematch` still only returned
a surface failure (`{:success false :outcome :refuse-rematch}` / Process B
`print-refuse-rematch!` + exit 1). Live master sync therefore sat on
`wait-reconcile` / `surfaced: refuse-rematch` until a human rematched
(measured 2026-08-25 ahead≈12 behind=3, ticks≥13).

## Fix

1. **Execute rematch on refuse.** When absorb-dispatch chooses
   `:refuse-rematch`, `handoffd` `master-main-reconcile-merge!` and Process B
   `run-post-hotfix-merge!` rematch onto `origin/main` (shared recovery with
   BL-1138 bookkeeping) instead of only naming / printing the outcome.
2. **Clear the surface on success.** After rematch reaches `behind=0`,
   reconcile clears standing `refuse-rematch`; `main_sync_status_cli`
   returns `proceed` or `ff-only` — not a standing wait for Cursor.
3. **Preserve BL-1130 / BL-1120.** No editor `MERGE_HEAD` / unmerged paths;
   a foreign `MERGE_HEAD` present at tick start is not aborted.

Designed recovery is rematch lander or rematch bookkeeping owner — never
Operator/Cursor "Complete origin/main merge" as the standing path.

## Operator check

```bash
bb swarmforge/scripts/main_sync_status_cli.bb .
# After recovery: action proceed|ff-only, behind=0 — not wait-reconcile
# with surfaced refuse-rematch.
```

If you still see a standing `refuse-rematch` wait after this land, that is
a new residual — not the designed path.

## Related

- [BL-1138 rematch-bookkeeping recovery](BL-1138-bl1135-residual-rematch-bookkeeping-deadlock.md)
- [BL-1135 live rematch surface](BL-1135-bl1131-residual-live-land-no-operator-absorb.md)
- [BL-1130 clean-refuse absorb](BL-1130-land-on-main-without-external-conflict-resolution.md)
- [BL-891 master-main reconcile](BL-891-master-main-reconcile-sweep.md)

Acceptance:
`specs/features/BL-1141-bl1138-residual-refuse-rematch-not-executed.feature`
