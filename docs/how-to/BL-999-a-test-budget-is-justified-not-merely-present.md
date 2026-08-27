# Test budgets justified by measurement (BL-999)

BL-969 raised one `renderBriefingBurndownCli` real-repo timeout to 90000ms
from a recorded worst-case run (~1.6× margin). Its **siblings** on the same
derive+render path kept older budgets; one 45000ms sibling later failed at
48926ms under load. The standing presence-only guard stayed green.

## Rule

A budget is **justified by a measurement**, not merely present:

1. Every explicit timeout traces to a recorded worst-case run and the margin
   applied (`budgetMs >= ceil(worstMs * 1.6)` in the shared table).
2. Structurally identical tests (same derive+render path) share the same
   budget.
3. Leaving a test on the suite default is a **recorded decision** with a
   stated margin — never an unexamined omission.

Shared table: `extension/test/renderBriefingBurndownCli.budgets.js`.
Invariant test: `extension/test/bl999BudgetJustificationInvariant.test.js`.

## Related

- BL-969 (presence guard / one measured raise)
- [Unit-lane budgets vs contention](BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention.md)

Acceptance:
`specs/features/BL-999-a-test-budget-is-justified-not-merely-present.feature`
