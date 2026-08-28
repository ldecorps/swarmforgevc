# BL-1208 — architect pass, 2026-08-28

Commit reviewed: 0ffb7bd054 (cleaner, verifying coder fix e558d68c9).

## Architecture
`src/quality/bounceRevertVerdict.ts` gains no new I/O — it only consumes
the new optional `restoredFromEarlierHistory` fact computed in
`src/metrics/bounceRevertGitAdapter.ts` (the IO/adapter layer). Dependency
gate: PASSED, no forbidden edges (no-io-from-policy respected, per the
ticket's explicit constraint and the prior architect finding on this exact
file pair).

## Invariants (declared)
1. "A destructive remedy is never emitted on evidence that cannot tell a
   defect introduction from a restoration ..." — Encoded:
   `bounceRevertRestoration.test.js` (7 cases, TDD) covers both the pure
   verdict layer and the real-fixture gathering layer; acceptance feature
   scenario "a commit that restores content it did not author is never
   answered with a revert instruction". Non-vacuity independently checked
   via the test suite's own "different bytes" case (a restore with altered
   content still earns the remedy) and the "edit, not re-add" guard (a
   file present in the parent is never a restoration candidate).
2. "Withholding the remedy never becomes a clean verdict ..." — Encoded:
   first unit test asserts `verdict === 'violation'` (not `'clean'`) with
   `remedy === null` and `liveFiles` still naming the path when restoration
   is established.

## Scenario 03 guard (false-clean via sibling-branch coincidence) — the trap named in the ticket
Verified deliberately scoped to the BOUNCED BRANCH'S OWN history: test
"a genuinely NEW file coincidentally matching a sibling branch still earns
the remedy" and acceptance scenario "content appearing elsewhere by
coincidence does not clear a real bounce" both construct a sibling branch
holding byte-identical content and confirm the remedy still fires. Read
`existedIdenticallyBeforeLoss` directly: it queries only
`git log ... <commit>^ -- <path>` (the commit's own branch ancestry), never
a sibling ref. Correct.

## Regression discipline (ticket's explicit constraint)
`git diff` of `bounceRevertCheck.test.js` and
`bl954BounceRevertCheckInvariants.property.test.js` against pre-BL-1202
HEAD is empty — byte-for-byte unedited, as required. Both still pass
(16/16 and 3/3 via `vitest.properties.config.mjs`, run directly per the
project's property-suite-guard hazard, not through the full guarded
`test:properties`).

## qa_e2e_procedure step 1 (real historical repro)
Re-ran `bounceRevertCheck({commit:'0bf05774a', by:'architect'})` against
the current checkout: now returns `verdict: 'breach-report', remedy: null`
rather than the ticket's originally-quoted `violation`/13-liveFiles output.
This is EXPECTED, not a gap — `0bf05774a` has since landed on `main`
(branch history advanced since the ticket was minted), so the pre-existing
`ancestorOfMain` check now short-circuits before reaching BL-1208's new
code path at all. The acceptance feature's synthetic fixtures reproduce
the exact original incident shape (byte-identical content lost then
restored from the branch's own earlier history) and are the operative
proof.

## Verification run
- `npm run compile`: clean.
- `bounceRevertRestoration.test.js` + `bounceRevertCheck.test.js`: 23/23 pass.
- `bl954BounceRevertCheckInvariants.property.test.js` (direct, not via guard): 3/3 pass.
- BL-1208 acceptance feature: 4/4 pass.

NONE outstanding. Forwarding to hardener.

By architect.
