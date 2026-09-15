# BL-1483 — declared invariants: stated reasons, not property tests (BL-654)

Both of BL-1483's invariants take the stated-reason path — neither has a
pure, testable module to quantify over. Reasons and verification below.

- **Author**: coder, 2026-09-15.

## Invariant 1 — "no scenario in BL-418's feature asserts a glyph for the operator standing topic"

**Stated reason: it quantifies over one feature file's static text, not a
runtime module.** There is nothing to generate inputs against — the claim is
"this specific document, after this specific edit, no longer contains this
specific assertion." A property test would need to construct arbitrary
feature-file content to vary over, which is exactly the "no generator to
speak of" case BL-654 excludes. The acceptance run plus a grep is the correct
verification shape, and it is also the ticket's own `qa_e2e_procedure` step 3.

**Verification performed:**

- `grep -n '🏛' specs/features/BL-418-standing-topic-icons.feature` matches
  only the `RETIRE-WITH: BL-1483` comment left where the row stood — no
  Examples row, no step line.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-418-standing-topic-icons.feature`
  → `ok 1..3`, `# fail 0` (one Examples row plus scenarios 02/03).
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-453-concierge-front-desk-icon-label.feature`
  → `ok 1..3`, `# fail 0` — BL-453's own feature (concierge-icon-01) is the
  sole remaining assertion of the bell, unedited by this parcel.

## Invariant 2 — "no living reference or how-to page under docs/ states the opera house as CURRENT"

**Stated reason: it quantifies over documentation prose, not a pure,
testable module, and the fix is out of the coder's domain by the ticket's
own "How" section** ("Documenter: correct the icon-system.md line to the
bell, citing BL-453..."). Authoring a doc-prose check here would also
duplicate the documenter's own gate for the same parcel.

**State at this stage, for the documenter to act on:**

- `grep -n '🏛' docs/branding/icon-system.md` still matches line 317
  (`standing Operator topic → 🏛 (opera house — ...)`), unfixed — expected,
  this coder parcel does not touch docs/. Left for the documenter stage per
  the ticket's constraints (no doc edits assigned to coder).

## Scope confirmation

- No production code touched: `extension/src/concierge/topicIcon.ts`,
  `conciergeTick.ts`, and the backfill tool are unedited (`git diff --stat`
  shows only the feature file and this evidence file).
- Handler `bl418StandingTopicIconsSteps.js`: unedited — no assertion changes,
  per constraints.
- BL-453's feature file: unedited.
