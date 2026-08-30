# BL-1240 — the unregistered-test file fails the ticket that adds it

Coder, 2026-08-30.

## What was built

`swarmforge/scripts/unregistered_test_gate_lib.bb`, wired into
`swarm_handoff.bb` beside the gates already there (BL-953, BL-806, BL-1213,
BL-1205, BL-1192), in the send-time family the approval_context leans toward.

A `git_handoff` whose own parcel adds a file under `swarmforge/scripts/test/`
with no row in `suite-manifest.tsv` is refused, naming the file and quoting
the row it needs.

## Parcel-scoped, which is the whole design

Scenario 03 is the load-bearing one and it drove the shape. The question the
gate asks is only ever "does THIS parcel add an unregistered test file", never
"is the tree clean". A tree-scoped copy would refuse every parcel on drift its
author did not create — relocating the problem rather than ending it, and
blocking everyone until BL-1239 lands.

The parcel's own paths come from `task_scope_gate_lib`'s already-shipped walk:
the commits since this task's last recorded handoff whose own subject names
this task's ticket. That walk was private; it is now one public seam,
`parcel-own-changed-paths`, with `findings-for-git-handoff` refactored to call
it. Two notions of "what this parcel changed" on the same send path would
disagree exactly where it matters, so there is one.

`required_wiring` row 1 asks the same of registration, and it holds the same
way: what counts as a test file (`test-file?`) and what a row says
(`parse-manifest`) are both asked of `suite_inventory_lib.bb` — the code
`suite_inventory_cli.bb` runs. The unit runner asserts the agreement per name
rather than trusting it, so a future divergence is a red rather than a drift.

## Fail-open is absolute

An unreadable commit range, an unresolvable task id, an unreadable manifest:
each warns on stderr and sends. Same posture as every gate beside it. A gate
on the send path that fails closed on its own blindness stops the pipeline
over its own bugs — and this one is being added precisely because a gate that
fires in the wrong place is worse than the drift it measures.

## The silent-row half

Invariant 2 — "a manifest row that registers no existing file is reported as
an error" — is **already true**, shipped in BL-1239's own
`suite_inventory_lib/check`: a first column that is not a test file name at
all is reported as MALFORMED, and one naming a test file absent from the tree
as missing. I did not reimplement it. What I added is the assertion that it
stays true, in two places: the unit runner and the property runner both check
it against the shipped code, because BL-1240's own gate is satisfiable by a
row, and a regression there would make this gate satisfiable by a row that
does nothing. Scenario 04 drives the real `suite_inventory_cli.bb`.

**What I deliberately did NOT do:** extend the send-time gate to validate rows
too. A parcel that touches the manifest would then be refused for inherited
malformed rows, which is scenario 03's failure in the other direction. The
tree-wide check owns the manifest; the send-time check owns the parcel.

## The invariants (BL-654)

`swarmforge/scripts/test/bl1240_unregistered_test_gate_property_runner.bb`,
seeded LCG, 400 runs each.

**Generator reach is constructed, not hoped for.** Every parcel is built from
an explicit shape — adds an unregistered test file, adds a registered one,
"adds" a deleted one, or adds no test file at all — with a floor of 60 on each
(measured: 89 / 104 / 109 / 98). Drawing paths independently and hoping a
parcel happens to add exactly an unregistered test file is the lottery that
made BL-1235's floor a 13%-flaky coin toss, three days ago and by me.

Every draw carries another parcel's unregistered file in the tree, so scenario
03's claim is asserted on every run of P1, not in one example.

Invariant 1 is stated as an EQUIVALENCE, so both directions are checked each
draw: a gate that blocked everything would satisfy the refusal half and stop
the pipeline. P1b adds the half a refusal is worthless without — it names the
file, names the manifest, and quotes a row that, parsed back through
`parse-manifest`, actually registers the file. A suggestion that would not
satisfy the check is worse than no suggestion.

Invariant 2's two empty-row shapes are each constructed and floored (measured:
150 not-a-test-name, 136 absent-file, 114 real).

**Non-vacuity, by breaking the code and running:**

| break | result |
|---|---|
| the registration check is dropped (accept everything) | P1 FAILS, 89 draws |
| the refusal stops quoting the row | P1b FAILS, 89 draws |
| the inventory accepts rows that register nothing | P2 FAILS, 286 draws |

Restored; ALL PASS.

## Runs

| what | result |
|---|---|
| BL-1240 acceptance | **4/4** |
| `unregistered_test_gate_lib_test_runner.bb` | ALL PASS |
| `bl1240_unregistered_test_gate_property_runner.bb` | ALL PASS, 400 runs each |
| `task_scope_gate_lib_test_runner.bb` (refactored) | ALL PASS |
| `suite_inventory_lib_test_runner.bb` | ALL PASS |
| `test_swarm_handoff_sync_deliver.sh` | pass |
| `test_swarm_handoff_daemon_backup.sh` | pass |
| `bl1277UnscopedStepCollisionGuard.test.js` | 6/6 |
| suite inventory | ok — 439 files |

The acceptance driver runs the REAL `swarm_handoff.sh` over a real git
fixture for scenarios 01–03, and the REAL `suite_inventory_cli.bb` for 04.
Nothing here calls the decision function directly: a gate that decides
correctly and is not wired in refuses nothing, and a scenario that drove the
decision would report green for exactly that — the shape BL-1235's architect
bounce caught, three days ago and also by me.

## Sequencing

The ticket's own note is right and worth repeating for whoever lands this:
`depends_on: BL-1239` is a sequencing constraint. BL-1239 has landed (the
inventory reports ok over 439 files on this branch), so the inherited drift is
already clear and this gate has nothing to refuse retroactively.

## Out of scope, untouched

The TypeScript and Gherkin lanes; the lane vocabulary and exclusion rules; and
`run_bb_suite.sh`'s own tree-wide check, which is unchanged and still runs —
this ticket adds a gate, it does not replace one.
