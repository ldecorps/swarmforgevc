# BL-1241 — hardener follow-up findings, 2026-08-29

Both findings are independently verified, non-blocking observations from the
hardening pass. Neither violates BL-1241's own invariants or acceptance
contract; recorded here rather than turned into a bounce, per the parcel's
own scope (QA.prompt wording is explicitly the specifier's, not required_wiring).

## 1. QA.prompt's BL-1241 section never names `land_step_cli.bb`

The coder's implementation notes and `land_step_cli.bb`'s own header comment
both claim "QA.prompt's own BL-1241 section now names" the CLI wrapper. Grepped
`swarmforge/roles/QA.prompt` for `land_step_cli` and `land_step_lib`: zero
matches. The BL-1241 section (around line 137) describes the remedy
procedurally ("rebuild tip-pure YOURSELF: replay only this ticket's own
paths...") but never tells QA which script to actually run. A QA seat
following the prose literally would hand-replay paths with `git checkout`
rather than invoking the tested, fixture-covered `land_step_cli.bb`.

Not a defect in this ticket — QA.prompt is deliberately outside
`required_wiring` (a parcel-pinned check would false-block the documenter's
handoff whenever the branch has not merged `main`, per the ticket's own
notes). Worth a small specifier follow-up: name `land_step_cli.bb` explicitly
in the QA.prompt section so the tested mechanism is actually what gets used.

## 2. `ENTANGLED_SIBLING` over-names a sibling already landed via its own replay

Verified by hand (three real tickets, one linear branch, real bare origin,
each cited at the SAME original tip — the literal 2026-08-28 shape):

1. `land_step_cli.bb` for ticket A against the shared tip: `LAND_REPLAY`,
   correctly naming B and C as entangled siblings. Landed A's replay commit
   onto `origin/main`.
2. `land_step_cli.bb` for ticket B against the SAME original tip:
   `LAND_REPLAY`, produces a genuinely tip-pure commit (parent is A's replay,
   contains ONLY B's own path — confirmed via `git show --stat`) — but still
   prints `ENTANGLED_SIBLING BL-91101` (A), even though A is already safely
   landed.
3. Same pattern for C: correctly tip-pure content, but names both A and B as
   entangled, though both are already landed.

Root cause: `entangled-siblings` walks `origin/main..commit` and collects
commits whose OWN subject names a different ticket — a positive,
subject-based match over the ORIGINAL cited commit's ancestry. A's replay is
a NEW commit object (different SHA, built on the then-current origin/main),
so landing it does not remove A's ORIGINAL commit from the range when B/C
are computed against the same original tip. Content-wise the mechanism is
completely correct (each replay commit is genuinely tip-pure, confirmed by
`git show --stat` on all three, and the final origin/main tree is byte-exact:
exactly the three expected files, nothing duplicated or lost) — the
termination invariant this ticket's qa_e2e_procedure step 5 requires DOES
hold. Only the informational `ENTANGLED_SIBLING` naming is stale for a
sibling resolved earlier in the same sequence.

Consequence: whoever reads QA's note (per QA.prompt's "Name every entangled
sibling ticket in whatever you send") may see a sibling ticket named as still
entangled when it has, in fact, already landed — a false-stale signal, not a
functional defect. Low severity; worth a follow-up ticket if it proves
confusing in practice, not blocking this one.

Fixture used: `tmp/bl1241-fixture` (removed after verification, not committed).
