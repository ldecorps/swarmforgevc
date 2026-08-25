# Live land rematch must not ops-page absorb (BL-1135)

BL-1131 put rematch-then-FF **policy** in `master_main_reconcile_lib.bb`,
but the live absorb sweep still mapped `:rematch-bookkeeping` to
`conflict` and escalated Operator with "needs a human" /
`Complete origin/main merge…` (seen after BL-533/534/695 lands the same
day BL-1131 closed).

## Live-path fix

1. `master-main-reconcile-merge!` keeps `:rematch-bookkeeping` and
   `:refuse-rematch` as distinct outcomes (not folded into `conflict`).
2. First tick surfaces once:
   `BL-1135: rematch bookkeeping onto origin/main…` (or rematch-owner
   Telegram wording) — designed recovery is rematch lander/bookkeeping
   owner.
3. Rematch-owner reasons **never** run the BL-920 "needs a human" absorb
   escalate path. Dirty / true conflict / human-merge-in-progress
   escalation is unchanged.
4. BL-1130 (no editor `MERGE_HEAD`) and BL-1120 (foreign merge skip) hold.

Helpers: `merge-failure-reason`, `rematch-owner-recovery?`,
`handle-merge-failure!` in `master_main_reconcile_lib.bb`; handoffd
`absorb-dispatch` comments the live `:replay-bookkeeping` → rematch
surface.

## Related

- [BL-1131 rematch-then-FF](BL-1131-ticket-land-without-operator-absorb-merge.md)
- [BL-1130 clean-refuse absorb](BL-1130-land-on-main-without-external-conflict-resolution.md)
- [BL-891 master-main reconcile](BL-891-master-main-reconcile-sweep.md)

Acceptance:
`specs/features/BL-1135-bl1131-residual-live-land-no-operator-absorb.feature`
