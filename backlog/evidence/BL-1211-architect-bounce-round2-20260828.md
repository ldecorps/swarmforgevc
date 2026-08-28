# BL-1211 architect bounce (round 2) — 2026-08-28

## Review pass inventory

- **D1 — invariant-unencoded.** The ticket declares three `invariants:`:
  1. "A recovery never resurrects content a revert on that same branch
     deliberately removed: whatever a restore-from-sibling brings back is
     filtered by the branch's own revert history, so recovering a collapsed
     branch cannot undo its bounces."
  2. "A quarantine lift can fail in BOTH directions - on content that went
     missing and on content that came back. An empty deletion diff against a
     sibling is necessary and never sufficient, because a branch restored
     from that sibling scores zero by construction."
  3. "Refusal turns on AUTHORSHIP, not byte-identity: content re-introduced
     by a recorded post-revert decision on that branch passes even when
     byte-identical to what the revert removed, and content with no such
     record is refused even when its content is correct."

  No property test exists for any of the three (grepped for
  `bounceResurrection`/`quarantineLift`/`recoveryFilter`/`BL1211` under
  `*.property.test.js` — zero hits), and no ticket note states a
  non-encodability reason. `extension/src/quality/bounceResurrectionVerdict.ts`
  is exactly the pure policy module this project's own established
  policy/adapter split targets for property testing (its own header comment
  draws the parallel to `bounceRevertVerdict.ts`, BL-954/BL-1208's own
  fast-check-friendly module): `isUnauthorizedResurrection`,
  `decideRecoveryFilter`, and `decideQuarantineLift` are pure functions over
  a `BounceResurrectionFact[]` with no git IO. All three invariants are
  directly encodable by generating arbitrary `BounceResurrectionFact` arrays:
  - Property 1/3 (authorship, not byte-identity): for any generated fact,
    `decideRecoveryFilter` holds a path back (`restore: false`) if and only
    if `bouncedContent !== null && candidateContent === bouncedContent &&
    authoredBackBy === null` — never on byte-identity alone, and never when
    an `authoredBackBy` record is present regardless of content match.
  - Property 2 (lift fails in both directions): for any generated fact
    array containing at least one unauthorized resurrection,
    `decideQuarantineLift` returns `granted: false` and every unauthorized
    fact's ticket/path appears in `refusedTickets`/`refusedPaths` — this
    must hold independent of whatever the (out-of-scope-here) deletion-diff
    signal would report, which is exactly the gap the incident exposed.

  Only example-based tests exist today
  (`extension/test/bounceResurrection.test.js`,
  `extension/test/bl1211OperatorCli.test.js`). A missing property test is
  itself the send-back per the Invariants Review section — I did not
  hand-verify the invariants against the example tests as a substitute.

- required_wiring entry 1 (`quarantine-lift-check.ts::quarantineLiftCheck`):
  satisfied — the CLI imports and calls `quarantineLiftCheck` from
  `bounceResurrectionGitAdapter.ts`, all decision logic staying in
  `decideQuarantineLift`. required_wiring entry 2
  (`recovery-filter-check.ts::filterRecoveryPaths`): satisfied, same shape.
- Dependency-rule gate (`extension/out/tools/dependency-gate.js` against
  `bounceResurrectionVerdict.ts`, `bounceResurrectionGitAdapter.ts`,
  `quarantine-lift-check.ts`, `recovery-filter-check.ts`): PASSED, no
  forbidden edges — confirms the policy/adapter split holds (no git IO
  leaked into `src/quality/`).
- Co-change report: the only frequency-4+ pairing is
  `bounceResurrectionGitAdapter.ts` ↔ its own test file — expected for a
  module this heavily iterated this session, not a design coupling concern.
- Correctness read: `isUnauthorizedResurrection` correctly requires BOTH
  `bouncedContent` and `candidateContent` non-null before comparing (a
  bounce that deleted the path, or a candidate that doesn't touch it,
  never false-positives as a resurrection), and checks content equality
  before authorship so a genuine re-fix with different content is never
  flagged regardless of authorship (matches invariant 3's "content that
  differs ... is never a finding regardless of authorship"). No defect
  found beyond D1.

## Remediation

Coder: add a `*.property.test.js` for `bounceResurrectionVerdict.ts` using
fast-check, encoding the three invariants above against generated
`BounceResurrectionFact[]` arrays (including edge cases: null
bounced/candidate content, matching and non-matching `authoredBackBy`,
multiple facts across tickets). Show each property fails when the invariant
is deliberately broken, then restore. Forward back through cleaner →
architect once added.

## Commit reviewed

03b18f6823 (cleaner's merge of coder's CRAP<=6 extraction round).
