# BL-1758 — architect note: orphaned shared-articles/ directory

Not a defect in this parcel — a pre-existing artifact this parcel's
wholesale `swarmforge/scripts` copy now silently propagates forward.

`swarmforge/scripts/shared-articles/` (engineering.prompt, handoffs.prompt,
workflow.prompt, tracked in git, dated 2026-08-28) was populated by the OLD
`swarm` wrapper's upstream-fetch block, which BL-1758 removes entirely
(confirmed: `grep -n shared-articles swarm` now finds nothing in the live
wrapper). Nothing in the current codebase reads these three files anymore
(confirmed: the only other hits are an unrelated test's own fixture
scaffolding, `test_swarm_launcher_mutation_cost_prepass.sh`, which just
mkdirs an empty directory of the same name for its own purposes).

Their content is generic upstream boilerplate (unclebob/swarm-forge's own
engineering.prompt, e.g. "procure the latest mutate4go/crap4go from
github.com/unclebob/... on startup") - not swarmforgevc-specific prose, so
this is not the invariant-3 leak the ticket's own exclusion list guards
against (that list correctly excludes the REAL
`swarmforge/constitution/articles/engineering.prompt`, which stays out).
But since `install_starter_kit.bb` copies `swarmforge/scripts` wholesale,
this now-dead directory rides into every future starter-kit target
indefinitely, unused and, on a quick read, easy to mistake for something
that matters.

Not blocking BL-1758's own forward (it correctly implements what it was
asked to build); flagged to the specifier for a follow-up cleanup ticket
(delete `swarmforge/scripts/shared-articles/` from this checkout, or fold
its content into something that IS read, whichever the specifier judges
right) - out of this ticket's own stated scope.

By architect.
