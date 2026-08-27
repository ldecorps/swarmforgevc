# Rematch-bookkeeping must recover — not durable-deadlock (BL-1138)

BL-1135 stopped paging Operator/Cursor to finish a conflicted absorb when
reconcile chose `:rematch-bookkeeping`. Same evening, the live path still
**surfaced** rematch-bookkeeping and then tripped `main-sync-deadlock` with
reason `rematch-bookkeeping` — coordinator froze closes (e.g. BL-568) while
`behind` climbed and local bookkeeping stayed ahead.

## Fix

1. **Execute rematch.** `handoffd` / absorb `replay-bookkeeping` rematches
   onto `origin/main` (`reset --hard origin/main` on the bookkeeping tip)
   instead of only naming the outcome.
2. **Clear deadlock on success.** After rematch/replay reaches `behind=0`,
   `main-sync-deadlock` clears; `main_sync_status_cli` returns `proceed` or
   `ff-only`, not `deadlock-tripped`.
3. **Never design-end as deadlock.** Rematch-owner reasons
   (`rematch-bookkeeping`, `refuse-rematch`) are excluded from
   `deadlock-trip-due?` / `designed-end-state-is-deadlock-tripped?` so
   standing Cursor-wait is not the intended end state.

BL-1130 (no editor `MERGE_HEAD`) and BL-1120 (foreign merge not aborted)
still hold.

## Operator check

```bash
bb swarmforge/scripts/main_sync_status_cli.bb .
# After recovery: action proceed|ff-only, behind=0 — not deadlock-tripped
# with reason rematch-bookkeeping.
```

If you still see `deadlock-tripped` / `rematch-bookkeeping` after this land,
that is a new residual — not the designed path.

## Residual closed by BL-1141

`:refuse-rematch` still only surfaced (Process B print+exit) until a human
rematched. [BL-1141](BL-1141-bl1138-residual-refuse-rematch-not-executed.md)
makes refuse-rematch **execute** the same rematch recovery and clear the
standing surface.

## Related

- [BL-1141 refuse-rematch recovery](BL-1141-bl1138-residual-refuse-rematch-not-executed.md)
- [BL-1135 live rematch surface](BL-1135-bl1131-residual-live-land-no-operator-absorb.md)
- [BL-1131 rematch-then-FF](BL-1131-ticket-land-without-operator-absorb-merge.md)
- [BL-891 master-main reconcile](BL-891-master-main-reconcile-sweep.md)

Acceptance:
`specs/features/BL-1138-bl1135-residual-rematch-bookkeeping-deadlock.feature`
