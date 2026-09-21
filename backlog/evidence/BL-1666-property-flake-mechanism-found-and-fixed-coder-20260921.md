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
