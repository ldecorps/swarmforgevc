# BL-1666: the invariant-1 property flake - mechanism found, fixed

**Sighting.** QA ran `extension/test/bl1459DocumenterBriefingTipGuardInvariants.property.test.js`
seventeen times after BL-1459 landed
(`backlog/evidence/unowned-red-bl1459-property-test-flaky-not-deterministic-20260920.md`):
sixteen passed, one failed invariant 1 with `AssertionError: expected
refusal for the already-landed date 2090-01-01, got status 0:
DOCUMENTER_BRIEFING_TIP_OK` (test.js:94, the sameDate branch).

**Mechanism.** `writeCommit` in the property fixture built each commit's
message from only the changed file path(s) (`change: docs/briefings/2090-01-01.md`),
with no other varying field. `landedContent`/`tipContent` are independently
generated strings by fast-check and sometimes collide (both empty-ish,
e.g. `"#"`). When they do, on a `sameDate` draw `main`'s commit and the
documenter branch's commit write the SAME path, SAME content, from the
SAME parent, with the SAME message, SAME author/committer identity - the
resulting tree, parent, message and (second-granularity) timestamps are
identical, so git hashes both commits to the SAME object. "The documenter
branch" then silently collapses onto "main": every diff/rev-list-based
check in the guard diffs a commit against itself, resolves to no change,
and reads as a no-op - `DOCUMENTER_BRIEFING_TIP_OK` instead of a refusal.

Not a defect in `check_documenter_briefing_tip.sh` - the guard reasons
about git objects correctly. The gap was the fixture's own assumption
that two `writeCommit` calls always produce distinct commits.

**Reproduction.** Reproduced deterministically via a one-off 10,000-draw
bounded search over invariant 1's own property
(`extension/bl1666-invariant1-10k-search.js`, per the ticket's bounded-search
direction; not part of the committed suite - a diagnostic only), run
against the property file BEFORE the fixture fix: failed at draw 4911,
seed-derived inputs `dates: ["2090-01-01","2090-01-02"], landedContent:
"#", tipContent: "#", sameDate: true` - collapsed commit identity as
described above.

**Fix.** `writeCommit` (both in the committed property test file and the
diagnostic script) now embeds a monotonic `commitSequence` counter in
every commit message (`change: <path> (#<n>)`), guaranteeing distinct
commit messages and therefore distinct git objects across draws and
across the two branches, even when file content collides. A regression
test pins the exact collision shape (byte-identical content on the same
date must still refuse) so a future edit to `writeCommit` cannot
reintroduce it invisibly.

**Verification after the fix (bounded search, this parcel):**
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1459DocumenterBriefingTipGuardInvariants.property.test.js` - run
  three times, 7/7 passed each time.
- The 10,000-draw diagnostic script re-run against the fixed fixture:
  `PASS: 10000 draws, no failure found` (no timeout cap; ~9 minutes
  wall-clock for the full 10,000 draws, git-heavy per draw).

The sighting is fixed with its mechanism named, not retired - the
counts above are the closing bounded-search evidence the ticket's
qa_e2e_procedure item (4) asks for.

## Declared-invariant property tests (BL-654, coder first authorship)

BL-1666 declares two invariants. Coverage added in this parcel:

1. Pipe-safety ("no decision depends on a pipe whose consumer can exit
   before its producer has finished writing"): STATED REASON, no
   fast-check property test - encoding it would require a real git
   repository whose output exceeds the ~64 KiB pipe buffer (thousands of
   commits or hundreds of paths) on every draw, which blows the property
   lane's few-seconds budget at any useful numRuns. Encoded instead as
   two deterministic shell integration tests
   (`test_check_documenter_briefing_tip.sh` cases 13f/13g) whose fixtures
   assert their own size against the 64 KiB bound before trusting a pass.
   Comment recorded at the top of
   `bl1459DocumenterBriefingTipGuardInvariants.property.test.js`.
2. Content-equality-over-ancestry exemption: a new fast-check property
   test ("property (BL-1666 invariant): an out-of-lane path is exempt iff
   its tip blob equals the landed main blob, regardless of commit
   ancestry") generates a blob-equal/blob-differs spread over a tip
   commit whose out-of-lane path is written by a commit that shares no
   lineage with main's own write - the hand-built land-step replay shape
   - and asserts the guard's OK/refusal tracks blob equality, not
   ancestry. A paired non-vacuity test removes the content-equality block
   from a scratch copy of the guard and proves the property then fails
   (a blob-equal, non-ancestor path is wrongly refused), then discards
   the scratch copy. Both pass; full file re-run: 9/9 passed.
