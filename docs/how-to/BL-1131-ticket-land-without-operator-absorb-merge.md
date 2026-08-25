# Ticket land without operator absorb merge (BL-1131)

BL-1130 stopped automated absorb from leaving `MERGE_HEAD` for an editor.
It still left `behind>0` / `wait-dirty-clear` until a human finished
`Complete origin/main merge…`. BL-1131 closes that residual: a successful
ticket land must reach `behind=0` and coordinator `proceed` with **no**
operator conflict resolution.

## Rematch-then-FF rule

1. **Before publish:** rematch the land tip so `origin/main` is already an
   ancestor (FF or clean join). Conflict → rematch to the lander; never leave
   `MERGE_HEAD` for an operator.
2. **After publish:** master absorb is FF-only from `origin/main` (or the
   landed tip). Colliding local-ahead bookkeeping is replayed onto the new
   tip; replay conflict → rematch that bookkeeping owner — not
   "Complete origin/main merge".
3. Soft: during the land window, coordinator bookkeeping should not rewrite
   paths in the land tip's change set (or land after absorb).

Policy lives in `master_main_reconcile_lib.bb` (`prepublish-rematch-plan`,
`post-land-absorb-plan`, `absorb-dispatch-plan`, `land-pipeline-outcome`).
`handoffd` / Process B share that dispatch. BL-1130 `:refuse-rematch` and
BL-1120 foreign-merge skip remain for true tip / human-owned failures.

## Residual closed by BL-1135

Policy alone still let the live absorb sweep treat `:rematch-bookkeeping`
as `conflict` and page Operator for absorb merge.
[BL-1135](BL-1135-bl1131-residual-live-land-no-operator-absorb.md) keeps
rematch outcomes distinct and never escalates designed rematch recovery
as "needs a human".

## Related

- [BL-1135 live rematch vs absorb page](BL-1135-bl1131-residual-live-land-no-operator-absorb.md)
- [BL-1130 clean-refuse absorb](BL-1130-land-on-main-without-external-conflict-resolution.md)
- [BL-891 master-main reconcile](BL-891-master-main-reconcile-sweep.md)

Acceptance:
`specs/features/BL-1131-ticket-land-without-operator-absorb-merge.feature`
