# BL-946 — architect review pass: BOUNCE to cleaner (merge-integrity defect)

- **Ticket**: BL-946 — EPIC_ICON_POOL holds 10 musical/performance glyphs against
  39 distinct epics (`type: defect`, `severity: medium`, M8). Already bounced
  once (cleaner → coder, D1/D2, `bounce_count: 1`).
- **Received**: `git_handoff` from cleaner, `931629bc8c` ("Merge coder
  8ed3a62934 (BL-946 bounce D1-D2 re-fix) into swarmforge-cleaner"), task
  `BL-946-epic-icon-pool-draws-from-whole-stock-set`.
- **Reviewer**: architect, 2026-08-20.
- **Verdict**: **BOUNCE to cleaner — 1 defect (D1, merge-integrity).**

The coder's D1/D2 re-fix at `8ed3a62934` is itself correct (verified below).
The defect is entirely in cleaner's merge of it: the merge silently dropped
BL-946's own core deliverable — the whole reason this ticket exists — while
correctly keeping the D1/D2 bugfix. The parcel as received is broken and
unshippable, not merely incomplete.

---

## D1 — cleaner's merge silently re-applied its own bounce-revert's deletions

**Class**: `behavior` (merge-integrity) · **Blamed**: cleaner · **Commit**:
`931629bc8c`

Cleaner's *original* bounce (`727c4f9c8`, 2026-08-20 07:38) was itself a
correct, properly-scoped revert of BL-946's full diff, in response to a real
D1/D2 defect in `resolveEpicIcon`. The coder's re-fix (`8ed3a62934`) was built
on the coder's OWN branch, which was never reverted — so on the coder's side,
BL-946's pool-widening work sat untouched underneath the D1/D2 fix the whole
time. When cleaner then merged `8ed3a62934` back into their own (reverted)
branch to produce `931629bc8c`, the 3-way merge (base `395c8c7a4`, ours =
cleaner's reverted tip, theirs = coder's `8ed3a62934`) resolved region-by-region:

| Region | Base | Ours (cleaner, reverted) | Theirs (coder, re-fix) | Merge result |
|---|---|---|---|---|
| `epicIcon.ts` pool derivation (top of file) | wide/derived | reverted to old 10-glyph literal | untouched (= base) | **ours wins — SILENTLY reverts to old pool** |
| `epicIcon.ts` `resolveEpicIcon` body | D1-buggy | untouched (= base) | fixed (isKnownEpic guard) | theirs wins — fix survives |
| `forumTopicIconStickerSet.ts` | present | deleted | untouched (= base, present) | **ours wins — SILENTLY deleted again** |
| `specs/pipeline/steps/bl946EpicIconPoolSteps.js` + its `index.js` line | present | deleted | untouched (= base, present) | **ours wins — SILENTLY deleted again** |
| `bl946EpicIconPoolInvariants.property.test.js` | present | deleted | modified (D2 fix added) | **modify/delete conflict — resolved by hand, correctly kept** |

The pattern: wherever cleaner's revert touched a region the coder's re-fix
commit did NOT separately touch, git auto-resolves in cleaner's favor with
**no conflict marker** — because from git's view, only one side changed
anything there. Only the property-test file forced an actual conflict
(modify/delete), which was resolved correctly by hand. Everything that merged
*silently* went the wrong way. This is the exact shape the engineering
guardrail names: *"diff every merge against BOTH parents and read the
deletions"* (BL-571/BL-958) — this merge was not diffed against the coder's
parent before committing.

**Net effect measured on the received commit:**
- `EPIC_ICON_POOL.length` is **10**, not the derived ~98 — the ticket's own
  title defect ("10 glyphs against 39 distinct epics") is **fully
  unfixed**. The pool-widening is BL-946's entire reason to exist; none of it
  survived.
- `extension/src/concierge/forumTopicIconStickerSet.ts` does not exist.
  `bl946EpicIconPoolInvariants.property.test.js` imports it anyway (line 6:
  `require('../out/concierge/forumTopicIconStickerSet')`) — running the
  property lane throws `Cannot find module`, not a clean red, a crash.
- `specs/pipeline/steps/bl946EpicIconPoolSteps.js` does not exist and
  `index.js` has no `bl946` registration — **all 8 acceptance scenarios for
  `specs/features/BL-946-epic-icon-pool-wider-stock-set.feature` fail**
  (reproduced: `node specs/pipeline/cli.js
  specs/features/BL-946-epic-icon-pool-wider-stock-set.feature` → 0/8 pass,
  every scenario errors on an unregistered step).
- The D1/D2 fix that DID survive (`isKnownEpic` guard in `resolveEpicIcon`,
  the deterministic prototype-id unit test, the property generator's
  `constantFrom` arm) is correct in isolation but sits on top of the wrong
  base — it guards access to the old 10-icon pool, not the derived one the
  ticket requires.

**What is NOT wrong**: the coder's `8ed3a62934` is complete and correct as
authored — verified directly against that commit: `EPIC_ICON_POOL` there is
the full derived pool, `forumTopicIconStickerSet.ts` and the acceptance steps
file are both present, and the D1/D2 fix is exactly as its own commit message
describes. Nothing needs to change in the coder's code; the fix is a correct
merge, not new code.

**Remediation**: cleaner re-merges `8ed3a62934` into a byte-for-byte
reconstruction of the pool-widening (or more simply, re-applies their own
original bounce-revert's INVERSE on top of `8ed3a62934` directly, since that
commit already carries every file the revert removed, correctly updated).
Whichever mechanism, verify by content afterward: `EPIC_ICON_POOL.length`
must be the derived count (~98, per `dae4d1006`'s own measurement), not 10;
`forumTopicIconStickerSet.ts` and `bl946EpicIconPoolSteps.js` must both exist;
the BL-946 acceptance feature must be 8/8; the property lane must run without
a missing-module crash. Diff the resulting merge against BOTH parents before
committing (BL-571/BL-958) — that check alone would have caught every silent
region in the table above.

---

## Everything else — assessed on the coder's `8ed3a62934` directly

Since the received parcel is unshippable as merged, architecture/invariant
review was performed against the coder's actual re-fix commit rather than the
broken merge, to confirm there is nothing ELSE to bounce once the merge is
redone:

| Check | Result |
|---|---|
| D1 fix (own-property guard via `isKnownEpic`) | **CORRECT** — verified by direct read; `isKnownEpic` uses `Object.prototype.hasOwnProperty.call`, `resolveEpicIcon` now branches on it |
| D2 fix (deterministic prototype-id coverage) | **CORRECT** — exhaustive unit test over 8 prototype names in `epicIcon.test.js`, plus a `constantFrom` arm with an asserted reach floor (>=20/300) in the property generator |
| Declared invariants 1–3 | Not independently re-verified this pass (already reviewed once, unchanged by D1/D2); will be re-checked in full once the redone merge lands |
| Dependency-rule gate | Not run against the broken tree — `epicIcon.ts`'s import surface is unchanged by D1/D2, no new risk expected once the merge is fixed |

No new defect found in the coder's own work. The sole blocker is the merge.

---

## Revert disposition

Reverted `40c054795` (my own merge of cleaner's `931629bc8c` into
`swarmforge-architect`) at `946eb3ef9`, via plain `git revert -m 1` — safe and
unscoped-revert-worthy here because, unlike the earlier BL-948/962/963/964/965
batch tip, this cleaner commit carries ONLY BL-946 (verified: `git diff
931629bc8c..HEAD` before the revert showed no other ticket's files touched).
Verified by content and by tree-identity: `git diff d6f1174616..HEAD` (my
prior tip, BL-591) is empty — the architect branch is back to exactly its
pre-BL-946 state, no partial residue.
