# BL-2044 — coder re-fix after QA bounce #2 (2026-10-07)

Inventory received: `backlog/evidence/BL-2044-QA-20261007.md`, 3 defects.
Per Article 4.4 the inventory travels: **D1 is cleared here** (blamed
coder); **D2 (hardener) and D3 (documenter) are still open and travel on**
to the stages that own them.

## D1 — CLEARED: the re-apply now follows the move's shape, not the intent keyword

QA's own diagnosis: `take-up!`'s `:move` branch gated the re-apply on
`(= :start (:intent intent))` literally. `resolve-target`'s `:take-up`
case, when the commit is a BL-1887 route (already on `origin/main`), also
calls `start-target` — the exact same "start the ticket fresh" resolution
a Work note gets — but the literal-keyword gate never saw that, so a route
whose line held the ticket's own commit plus an unlanded other ticket's
commit moved without re-applying, stranding the ticket's own work under
the backup ref exactly as the pre-hotfix defect did.

**The fix, in `swarmforge/scripts/parcel_line_lib.bb`.** `start-target` now
marks every one of its results `:start? true`; `resolve-target`'s two
non-start `:take-up` branches (already-past-target, and a plain build not
on `origin/main`) mark `:start? false` explicitly. `take-up!`'s `:move`
branch reads `(:start? resolved)` instead of `(= :start (:intent intent))`.
This covers both doors QA named (a Work note, and a BL-1887 route) with
one condition, because both now resolve through the same function - never
a second notion of "the ticket's own", matching the existing
`line-commit-ok?`/`done-ticket?` reuse rule the ticket's own "How" section
already states.

**Reproduced first, with QA's own probe** (`tmp/bl2044_probe_h.bb`, saved
verbatim from the bounce evidence, deleted again after use — scratch only):
case H-route (`:take-up` intent, commit already on `origin/main`, line =
BL-9002's own commit + unlanded BL-9003) failed exactly as QA described
before the fix (`own BL-9002 commit content on new HEAD? false`); after the
fix, both H-note and H-route report `:moved`, re-applied 1 commit, and the
own commit's content and sha are both present and reachable from the new
HEAD.

## D2 — NOT cleared here: still open, travels to the hardener

The regression cases QA's remediation pointer asks for (a case driving the
BL-1887-route-with-unlanded-other-ticket shape through the real
`take-up!`, and a mutation case that fails when the new `:start?` scope
alone is dropped) are not added to
`swarmforge/scripts/test/parcel_line_lib_test_runner.bb` in this parcel.
That file and its hand-mutant evidence are the hardener's domain
(`required_stages: [coder, hardener, documenter, qa]`, no cleaner/architect
stage); Article 4.4's "each stage clears its own items" keeps this one with
the hardener rather than the coder reaching into the hardener's own test
file.

## D3 — NOT cleared here: still open, travels to the documenter

`docs/how-to/BL-1871-parcel-line-take-up.md` and
`docs/reference/Specification.MD` still say the re-apply runs "only for a
`:start` intent" and gives a reason ("a `:take-up`'s target already is the
parcel") that is false for the BL-1887 route. Unchanged in this parcel —
documenter's domain, named explicitly by QA's remediation pointer.

## Verification at this commit

| check | result |
|---|---|
| QA's own probe (`bl2044_probe_h.bb`), re-run after the fix | both H-note and H-route: `:moved`, re-applied 1, own commit content and sha present on new HEAD |
| `bb swarmforge/scripts/test/parcel_line_lib_test_runner.bb` | ALL PASS (no regression in cases A-G, the BL-1887 route tests, or the done-ticket/merge cases) |
| `bb swarmforge/scripts/test/bl2044_seat_commits_survive_line_move_property_runner.bb` | ALL PROPERTIES HOLD (60 runs: 33 clean, 27 conflicting) |
| `node specs/pipeline/cli.js specs/features/BL-2044-....feature` | 3/3 |
| `node specs/pipeline/cli.js` on BL-1871's feature (qa_e2e 2) | 9/9, unchanged |
| `node specs/pipeline/cli.js` on BL-1887's feature (qa_e2e 2) | 4/4, unchanged |

Not re-run here (no production TS touched, nothing in this parcel's paths
reaches it): the TypeScript unit/property lanes. `swarmforge/scripts/*.bb`
is outside `extension/src` and outside any `*.property.test.js` glob, so
it is not a property-suite-drift trigger path either.

By coder.
