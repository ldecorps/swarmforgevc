# BL-1211 cleaner bounce — 2026-08-28

## D1: quarantine-lift check fails OPEN (grants) when a bounce record's
commit is unresolvable — and the new regression test flakily produces
exactly that condition (correctness + test-reliability)

`bounceResurrectionGitAdapter.ts`'s `gatherBounceResurrectionFacts` skips
a bounce record whose `commit` cannot be resolved in the repo ("fails
open per this repo's own send-time-gate posture... never wedging a
recovery or a lift on unrelated git corruption"). With zero facts,
`decideQuarantineLift([])` returns `{ granted: true, ... }`. That is the
WRONG side to fail open on for this specific check: an unresolvable
bounce record is exactly the shape an unauthorized-resurrection incident
would produce if the bounce store or git history were disturbed, and
"nothing to check against" here means "nothing stops the resurrection,"
not "nothing to worry about."

**Confirmed reproducible in the new test itself**, not just a
theoretical concern: `bounceResurrection.test.js`'s scenario 05
non-vacuity check builds a SECOND fixture repo (`rootUnauthorized`) via a
fresh call to `mkIncidentFixture()`, then reuses the `bounced` commit SHA
from the FIRST fixture's `mkIncidentFixture()` call in the bounce record
it appends to the second repo:

```js
const { root, bounced } = mkIncidentFixture();
...
const rootUnauthorized = mkIncidentFixture().root;
commitFile(rootUnauthorized, 'src/thing.ts', 'bounced content\n', 'recovery: restore', 'coordinator');
appendBounceRecordIfNew(rootUnauthorized, { ..., commit: bounced, ... });
const verdictUnauthorized = quarantineLiftCheck(rootUnauthorized, 'architect');
assert.equal(verdictUnauthorized.granted, false);   // fails intermittently
```

This only works when the two separately-created repos happen to produce
a BYTE-IDENTICAL commit hash for their own (distinct) `mkIncidentFixture`
commit sequence — git's commit hash includes author/committer timestamp
at SECOND granularity, and neither `mkIncidentFixture` nor
`sharedRepoFixture.js`'s `copySeededRepoInto` pins `GIT_AUTHOR_DATE`/
`GIT_COMMITTER_DATE`. When the two calls straddle a wall-clock second
boundary, the SHA differs, `rootUnauthorized` never had a commit matching
`bounced`, the bounce record's commit is unresolvable, and the check
fails open — `granted: true` instead of the expected `false`.

**Reproduced directly**: ran `npx vitest run bounceResurrection` in a
loop, 8 iterations — failed 3/8 times, always the same assertion
(`verdictUnauthorized.granted` expected `false`, got `true`). Isolated
the mechanism with a minimal repro (unresolvable `commit: 'deadbeef00'`
in an otherwise-identical fixture): `quarantineLiftCheck` returns
`{"granted":true,...}` — confirms the fail-open path is the root cause,
not test-runner flakiness.

**Two things need fixing, one root cause**:
1. The test fixture must not depend on cross-repo commit-hash
   coincidence — build the bounce record from a commit SHA that actually
   exists in `rootUnauthorized`'s own history (e.g. give
   `mkIncidentFixture` an optional pinned author/committer date, or have
   the "unauthorized" scenario construct its own bounced-then-reverted
   pair in `rootUnauthorized` directly rather than borrowing another
   repo's SHA).
2. Whether `gatherBounceResurrectionFacts` failing open on an
   unresolvable bounce commit is the right posture for THIS check at all
   is worth the ticket owner's explicit call — an architecture-level
   decision, not a cleaner-side fix. Every other send-time gate in this
   codebase fails open because refusing due to an unrelated git hiccup
   would wedge the pipeline; this check runs at quarantine-lift time, a
   much lower-frequency, higher-stakes decision, where failing CLOSED
   (refuse until the fact can be read) may be the correct posture instead.

## Complete inventory
No other defects found. `tsc --noEmit` clean. Acceptance feature
(`BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature`)
run 3 times via `run_acceptance.sh`: 5/5 pass every time, zero fixture
leaks — the acceptance fixtures apparently don't hit this same cross-repo
SHA-reuse pattern, so this is confirmed scoped to the one unit test file.

By cleaner.
