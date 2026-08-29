# BL-1268 — before/after sweep of the freshness gate over the live paused pool

Coder, 2026-08-29. Evidence for `qa_e2e_procedure` step 5 and invariant 2
("every paused ticket the branch holds today is re-checked, and each is either
still held or shown to be a cross-reference to another ticket").

Method: `deprecateCheck(root, id)` run over **every** `backlog/paused/*.yaml`
in this worktree, once at the merge-base predicate and once at the narrowed
one. Live pool, not a fixture pool. The pool is 99 tickets today (the ticket
measured 114 on the morning of 2026-08-29; the pool has moved since, so the
counts below are this run's, not the ticket's).

## Counts

| | held (all branches) | held on the generic-claim branch |
|---|---|---|
| before | 27 / 99 | 20 |
| after  |  9 / 99 |  2 |

**Newly held: none.** Every ticket in the after-list was in the before-list.

## Still held on the generic-claim branch (genuine self-claims)

- **BL-692** — `status: superseded` (line 6). A structured disposition field on
  the ticket itself. Correctly held: this is the case the branch exists for.
- **BL-875** — "if the human prefers it, this ticket is superseded rather than
  amended". A direct self-claim shape. Conditional in context, but the gate is
  fail-closed by design, so it stays held for the specifier to adjudicate.

Invariant 2's second half holds: the after-list still contains the before-list's
genuine self-claims, so the predicate was narrowed rather than widened into
uselessness (`qa_e2e_procedure` step 6).

## The 18 that stopped holding — walked, not sampled

Seventeen are cross-references to another ticket's disposition; the eighteenth
is called out separately below.

| ticket | the claim words the old branch fired on | whose disposition |
|---|---|---|
| BL-1172 | "RETIRED/superseded inline with no `docs/deprecated/` registry" | the behaviour the epic governs |
| BL-1210 | "and should be retired. I did not take it..." | topicIconSync's convention |
| BL-1212 | "If BL-1209 is retired or..." | BL-1209 |
| BL-1220 | "...is retired as superseded-by-BL-1220" | BL-1189's sibling |
| BL-1229 | "collides with a retired M0 id in history" | a retired M0 id |
| BL-1254 | "asserts superseded behaviour" | behaviour a later commit superseded |
| BL-1263 | claim word inside the `acceptance:` feature-file PATH | a filename, no disposition at all |
| BL-1271 | "the retired-type guard", and `type: bug` retired by BL-1095 | BL-1095's change, and a hyphenated compound |
| BL-1272 | "It is NOT retired as superseded" | an explicit denial |
| BL-564 | "per the superseded-scenario rule" | a named rule |
| BL-659 | "RETARGETED, explicitly NOT retired" | an explicit denial |
| BL-670 | "BL-573 is retired to backlog/done/ as superseded" | BL-573 |
| BL-693 | "BL-873 is retired as superseded" | BL-873 |
| BL-836 | "cancelled, or superseded by a newer one from the same role" | a pending question |
| BL-837 | "answered/cancelled/superseded, no zombie blink" | a pending question |
| BL-838 | "the ask may have been answered, cancelled, or superseded" | a pending ask |
| BL-865 | "BL-659 is retargeted in place (NOT retired)" | BL-659, and a denial |

**BL-772 — the one drop that is not a cross-reference.** Its slice C is marked
"RETIRED as written, 2026-08-06", superseded by BL-836/837/838. That is a claim
about one SLICE of a ticket whose other slices (B, D, F) are live and are what
promotion would activate. Holding a live ticket because a slice it already
records as retired is named in its own text is the same false positive in a
narrower costume — the retirement is finished bookkeeping, not a stale premise.
It is recorded here rather than buried so a reviewer can disagree with the call
on the evidence.

## Reproduce

```
cd extension && npm run compile
node -e "const {deprecateCheck}=require('./out/tools/deprecate-check');
const fs=require('fs');const root='<repo-root>';
for (const f of fs.readdirSync(root+'/backlog/paused').filter(f=>/^BL-\d+.*\.yaml$/.test(f))) {
  const id=f.match(/^BL-\d+/)[0]; const d=deprecateCheck(root,id);
  if (d.decision==='hold') console.log(id, d.reason);
}"
```

## Invariant 2 — why there is no property test for it

Invariant 1 is encoded executably in
`extension/test/deprecateCheckSelfClaimBranch.property.test.js`. Invariant 2 is
not: it quantifies over the LIVE paused pool at a point in time, not over a
pure function's input space, and BL-1038's live-repository-derivation guard
forbids a test that derives its subject from the live repository. Encoding it
as a property over generated tickets would restate invariant 1 while dropping
the only thing invariant 2 adds — that the real, already-held tickets were each
re-checked by hand. That sweep is this file, per the coder role's "stated
reason" path for a declared invariant that admits no executable encoding.
