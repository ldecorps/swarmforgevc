# BL-630 QA bounce — 2026-07-30 (round 5, at QA)

## D1: Documenter's own doc pass introduces a residual "facilitator" word regression

**Failing command**:
```
cd extension && npx vitest run test/onboarderRenameNoResidualFacilitator.test.js
```

**Commit hash**: `544460a71` ("Document BL-630 push-sweep QA-ancestry gate + BL-714
hardening-gate fixes", the documenter's fix for round 4's "documenter pass
missing entirely" bounce), forwarded to QA via `bae6a9694`.

**First error excerpt**:
```
FAIL  test/onboarderRenameNoResidualFacilitator.test.js > no live git-tracked
file still says "facilitator" outside the dated record and the named
naming-decision citations
AssertionError: unexpected residual "facilitator" mentions (BL-684):
["docs/reference/Specification.MD"]
+ actual - expected
+ [
+   "docs/reference/Specification.MD",
+ ]
- []
```

`docs/reference/Specification.MD` is not on `onboarderResidualAllowlist.js`'s
`ALLOWED_EXACT_PATHS` and does not match any `EXEMPT_PREFIXES`
(`backlog/evidence/`, `backlog/done/`, `docs/briefings/`). The documenter's
new prose uses the literal retired word twice while narrating the BL-714 fix:
the "Last Updated" banner line ("...tripping the **facilitator** residual
scan...") and the BL-714 body entry ("...happened to contain the literal
substring "**facilitator**", failing
`extension/test/onboarderRenameNoResidualFacilitator.test.js`'s...").
Confirmed new to this round: `git show 32d36ad4d -- docs/reference/Specification.MD`
is empty (the prior bounced merge had zero documenter content at all, per
round 4's own D1), so this is the first time this file gained any BL-630/
BL-714 doc content — the regression is entirely this commit's own.

**Failure class**: `unit`

**Expected vs observed**: Expected the new BL-630/BL-714 documentation prose
to describe the fixed defects without re-triggering the BL-684 rename guard
it is itself narrating. Observed: the prose spells out the retired word
verbatim in two places, which the guard test (rightly) flags as a live
residual mention outside its allowlist.

## Everything else checked — no other defects

Full inventory run after independently restoring content this branch's own
prior bounce-hygiene revert (`910d2a4e8`) had silently dropped from the same
merge (see remediation note below — a QA-side issue, not chargeable to the
documenter):
- `npm run compile` (extension/): clean.
- Full unit suite (`npx vitest run`, `cursorBridgeAgentSession.test.js`
  excluded per the known pre-existing flake —
  `cursor-api-key-test-leak-cascading-flake-20260730`): with D1 fixed by
  reverting the documenter's two commits out of this branch, 389/389 files,
  6758/6758 tests pass.
- `npm run test:properties`: 30/30 files, 92/92 tests pass.
- Acceptance: BL-630 5/5 pass, BL-714 3/3 pass.
- Wiring: `push-decision`'s QA-ancestry gate is called from the real daemon
  tick (`swarmforge/scripts/handoffd.bb:1927-1955`).
- Ancestry: this ticket's own coder/architect/hardener merges
  (`92a213127`, `80c8520a5`, `b92688ede`, `32d36ad4d`) are all ancestors of
  the commit under review.

## Remediation pointer

Owning role: **documenter**. Rewrite the two BL-714/BL-630 Specification.MD
sentences to describe the fix without using the literal retired word (e.g.
"the residual-word rename guard" / "the BL-684 scan" instead of "the
facilitator residual scan"; describe the tracked blob's offending content
without quoting it verbatim, or add the exact quoted form to
`onboarderResidualAllowlist.js`'s allowlist only if a literal-word citation is
judged necessary — rewording is the lighter fix and is recommended). Re-run
`test/onboarderRenameNoResidualFacilitator.test.js` before resubmitting.

Separately, noted here for the record and NOT part of this bounce (a QA-side
process defect, not a rework item): merging the documenter's parcel into this
branch a second time hit the same silent-drop trap as the merge that
triggered round 4's evidence file — this branch's own bounce-hygiene revert
(`910d2a4e8`) had touched 15 files' worth of BL-630/BL-714 fix content plus
the tracked vitest-cache blob, and because the documenter's branch never
re-touched those exact hunks, a plain 3-way merge silently kept the reverted
(broken) versions instead of raising a conflict. QA caught this only by
diffing the full tree against the incoming commit and has restored the
correct content in this branch directly; no rework is needed from any
upstream role for that part.
