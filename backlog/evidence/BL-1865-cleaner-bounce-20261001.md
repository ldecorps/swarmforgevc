# BL-1865 — cleaner send-back, 2026-10-01

## D1 — scenario 01's step text changed under the held parcel (spec-gap, blamed: specifier)

While this parcel sat in_process with the cleaner, the specifier amended
`specs/features/BL-1865-bl1343s-property-tests-finish-well-inside-their-budget.feature`
(`af48ba62ac`) per its own evidence
`backlog/evidence/BL-1865-bounce-20261001.md`: scenario 01's bound (8000 ms
fastest-of-three) was a projection never measured on a fixed build
(BL-1658 D2), and the coder's own measurement of the fixed build (340-530
ms/draw, fastest-of-three 7840-12694 ms) confirmed the bound as minted
could not be reliably met. The amendment replaces the wall-clock
assertion with a mechanism gate: a solo run passes both tests and loads
`land_step_lib.bb` exactly 2 times (once per test), counted at run time.

`specs/pipeline/steps/bl1865Bl1343PropertyBudgetSteps.js`'s scenario-01
handler (coder, `5de866d698`) still binds the retired step text
("the bl1343 property file is run alone three times" /
"each of its 2 tests finishes in under 8000 ms in its fastest run") and
asserts the retired 8000 ms bound. The runner throws on a missing handler
for the new step text (BL-233), so the handler must be rewritten to match
the amended feature exactly. This is a rewrite of the mechanism-counting
assertion the coder's own implementation already supports
(`landStepLibSession` starts exactly one `bb` per test) — coder-domain
test-authoring work, not cleaner-domain cleanup, so merged into this
cleaner pass without carrying it forward would also be wrong (BL-1865 is
still mid-pipeline, scenario 01 still red against the amended feature at
this parcel per my own live run: `node specs/pipeline/cli.js
specs/features/BL-1865-bl1343s-property-tests-finish-well-inside-their-budget.feature`
failed scenario 01 at 8336.6 ms against the retired bound, confirming the
amendment's own rationale).

Merged main (`af48ba62ac`) into this worktree before this bounce so the
amendment and its evidence travel with the parcel.

## Routing

Per the specifier's own routing note in `backlog/evidence/BL-1865-bounce-20261001.md`:
the cleaner (holding the parcel) sends it back to the coder, who merges
main, rewrites the scenario-01 handler to the amended step text and
mechanism gate, and keeps the fix commits. Recorded with `--role
specifier` (producing role for the defect is the specifier's own
pre-amendment feature text), `--by cleaner`.

By cleaner.
