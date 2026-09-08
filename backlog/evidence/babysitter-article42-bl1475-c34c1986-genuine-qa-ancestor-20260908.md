# Article 4.2 finding waived - BL-1475 c34c1986159f is a genuine QA-approved ancestor, 2026-09-08

Babysitter health sweep flagged commit c34c1986159f26f5040336149abe3cca574f31f4
("BL-1475: hand-built tip-pure replay onto origin/main (BL-1241 recipe)") as
pipeline code landed on main outside QA.

Verified:
- `bash swarmforge/scripts/is_qa_ancestor.sh c34c1986159f26f5040336149abe3cca574f31f4`
  exits 0, with no bounce/expedite/land-record match printed - the verdict
  falls through to plain ancestry.
- Unlike the usual BL-1334 replay case (a NEW sha standing in for an
  approved source at a different sha), here the SAME sha
  (`c34c198615...`) is present verbatim on both `swarmforge-QA`
  (`git log swarmforge-QA --oneline`) and `origin/main` - QA committed this
  directly on its own branch during review (evidence
  `backlog/evidence/BL-1475-QA-*.md`, commits `8cce3c601f` review pass,
  `3773873538` abandoned_commits record, `c1b81d8ea1` land-escalate
  record all sit on `swarmforge-QA` alongside it) and then pushed that
  identical commit to `origin/main` per the BL-1241 hand-built recipe.
  There is no distinct "source" sha for `record_land_approval.bb` to point
  at - the replay and the approved commit are one and the same object.
- QA's own bookkeep note ("BL-1475 QA-approved, landed c34c198615 on
  origin/main") was in flight to the coordinator at the time of this
  check, confirming QA's own accounting agrees.

Disposition: false positive from the predicate's own stated closure
criterion (is_qa_ancestor.sh exits 0) - no land-approval record is needed
or possible here since there is no separate source sha. Waived, one key,
per BL-1344.

By coordinator.
