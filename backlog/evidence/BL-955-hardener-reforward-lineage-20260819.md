# BL-955 re-forward — lineage fix — 2026-08-19

## What QA reported
QA note: "BL-955 held - re-forward from post-96882d743 tip, not
94a3481eb".

## Root cause
My original BL-955 forward cited `814812883` (hardener evidence
commit). Documenter built `94a3481eb` on top of that commit and
forwarded it toward QA. `814812883` predates my later BL-956 scoped
revert (`96882d743`, "scoped revert of bounced content out of hardener
HEAD, BL-490/BL-495") — at the time I forwarded BL-955, BL-956's
defect (invariant 3 violated in `renderParkedSectionHtml`) had not yet
been found or reverted on the hardener branch.

Consequence: `94a3481eb`'s tree still carries BL-956's original,
unreverted, defective `pipelineBoard.ts` — not because BL-955's own
diff touches that file (it doesn't), but because that was simply the
file state on the branch documenter forked from. This is the BL-536/
BL-952 shape: known-defective content riding forward disguised as part
of an unrelated, otherwise-clean ticket.

## Verification at current HEAD (`7b48eff9a9`)
- `git merge-base --is-ancestor 96882d743 HEAD` → true: the revert is
  now an ancestor, so `pipelineBoard.ts` is back at its pre-BL-956
  (clean) state.
- `renderParkedSectionHtml` grep confirms no `epicsOverflowLine`
  leftover from BL-956's defective hotfix.
- BL-955's own content (`annotateNegotiationRelayText` in
  `negotiationTelegramRouting.ts`) confirmed still present and
  unaffected.

## Action
Re-issuing the `git_handoff` for BL-955 to documenter citing current
HEAD `7b48eff9a9` (descendant of `96882d743`), so the re-forward to QA
carries the clean `pipelineBoard.ts` state instead of the stale
pre-revert one. No change to BL-955's own hardening verdict (see
`BL-955-hardener-pass-20260819.md` — still valid, unchanged).

By hardener.
