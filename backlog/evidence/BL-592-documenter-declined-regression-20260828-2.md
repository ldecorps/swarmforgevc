# BL-592 (2nd merge-up) — documenter declined a silent regression on QA merge-up (2026-08-28)

## What happened

QA sent a merge-up broadcast note for BL-592 (approved commit `420695b6ca`,
the real land this time — QA's evidence
`backlog/evidence/BL-592-qa-pass-20260828.md` documents the ancestry check
and specifier hazard-checklist follow-through). Merging it into the
documenter worktree auto-merged (no conflict marker) a silent reversion of
BL-1189's dedup work:

- `extension/src/bridge/residentPaneLive.ts` — `dedupePrimaryWorkingTicket`
  import/call site removed, `claimedTicketIds` plumbing removed.
- `extension/src/concierge/residentPaneSpy.ts` — companion changes.
- `extension/test/residentPaneLive.test.js`, `extension/test/residentPaneSpy.test.js`
  — tests reverted to pre-BL-1189 shape.
- Five `backlog/evidence/BL-1189-*.md` files deleted.

QA's own evidence for this land is explicit that this is an **active hold,
not an oversight**: BL-1189 is QA's own prior parcel, held pending the
specifier's disposition of BL-1211 (an unresolved provenance question), and
QA declined its bundled content specifically so landing BL-592 wouldn't also
silently land BL-1189 as a side effect of sharing a branch. That reasoning
is about **not landing BL-1189 on `main` via BL-592** — it does not say
BL-1189 is retired or that its content should be stripped from this
worktree, where it has sat as legitimate in-progress work since an earlier
documenter pass this session (`BL-1189-documenter-pass-hold-20260828.md`,
one of the five files the merge tried to delete).

Two conflicted paths in the same merge made the same distinction explicit:
`specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js` and
its `index.js` registration DID raise a modify/delete conflict (QA deleted,
HEAD modified) — resolved by keeping HEAD's registration. The four
`.ts`/`.test.js` files above merged clean with no conflict marker, so the
same regression would have landed silently if not checked by hand.

## Resolution

`git checkout HEAD --` on all four touched source/test files and the five
BL-1189 evidence files, restoring HEAD's content. Confirmed
`dedupePrimaryWorkingTicket` still exported from `residentPaneSpy.ts` and
still imported/called in `residentPaneLive.ts` (2 grep hits, unchanged).
Merge committed as `99461a23f`. No production behavior was lost; BL-592's
own real work (spec-tree console/PWA/step-handler files) landed intact.

## Ask

Same standing ask as the prior two occurrences this session
(`backlog/evidence/BL-592-documenter-declined-regression-20260828.md`,
`backlog/evidence/BL-1200-documenter-declined-regression-recurrence-20260828.md`
if present) — this is the third time the exact same file set
(residentPaneLive/Spy + tests + BL-1189 evidence) has needed a manual
decline on a merge-up into this worktree. Whoever resolves BL-1189's hold
(specifier, on BL-1211) should also confirm the branch feeding these
merge-ups gets BL-1189's real content merged forward once, so future
merge-ups stop repeating this same silent-revert check.

By documenter.
