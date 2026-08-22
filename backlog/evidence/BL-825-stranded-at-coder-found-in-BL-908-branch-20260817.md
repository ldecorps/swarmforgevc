# BL-825 — stranded at coder, discovered riding unreviewed in the BL-908 branch

**Found by:** documenter, while merging hardener's forwarded commit
`c41a079a0c` (BL-908) into the documenter worktree, 2026-08-17.

**Not a bounce of BL-908.** BL-908's own architect/hardener passes are
complete and correct (see
`backlog/evidence/BL-908-bubble-knowledge-screen-backlog-docs-panels-architect-bounce-20260817.md`
for the earlier sync-trigger bounce, now fixed and re-forwarded). This is a
separate ticket's work found commingled in the same branch, surfaced per
"An Approval Authorizes Only Its Ticket's Work" (BL-506) — surfaced, not
folded in silently or swept.

## What's stranded

`BL-825` (`backlog/active/BL-825-bubble-remote-ui-bundle-resolution.yaml`,
`required_stages: [coder, cleaner, architect, hardender, documenter, qa]`,
still `status: todo`, `assigned_to: coder` per its own YAML and per
`backlog/topics/BL-825.json`'s last message, "in progress") has exactly one
commit in the whole repo: `0f4de7bf8` "BL-825: Bubble UI bundle resolver
(slice A)", authored directly on the `coder`/`swarm/coder` branch. No
cleaner, architect, hardener, documenter, or QA commit for BL-825 exists
anywhere (`git log --all --oneline --grep="BL-825"` — checked against every
ref, not just this worktree's history).

That commit's files (`UiBundleResolver.kt`,
`extension/src/bridge/letsTalkUiBundle.ts`,
`specs/pipeline/steps/bl825BubbleUiBundleResolutionSteps.js`, and their
tests) are nonetheless present in this worktree right now, because coder's
branch tip WAS `0f4de7bf8` at the moment BL-908 work started
(`5544bc9a9`'s parent chain confirms this: `a1dcb03ad` "Merge commit
'133e37d76' into swarm/coder" has `0f4de7bf8` as its first parent). BL-908
was built on top of it and forwarded through cleaner → architect → hardener
→ documenter, carrying BL-825's files along as an ancestor the whole way,
with no separate `git_handoff` ever sent for BL-825 itself.

**Confirmed the downstream reviews never actually saw BL-825's content**,
not just that they didn't mention it: the architect's BL-908 bounce evidence
states "ran full-repo scan (parcel touches no `extension/src/**` file)" —
true only because BL-825's `extension/src/bridge/letsTalkUiBundle.ts` /
`letsTalkRoutes.ts` changes were not yet in the parcel the architect
reviewed; they entered via the next merge
(`59a35dc0d` "Merge cleaner BL-908... (49ac0cf0c0)", confirmed by `git show
--stat` showing `UiBundleResolver.kt` and `letsTalkUiBundle.ts` first
appearing there against that merge's first parent). The hardener's pass
(`c41a079a0`) is scoped, by its own commit message, to
"6 Gherkin-mutation survivors in step handler" (singular) — BL-908's step
handler, not BL-825's.

## Why this matters

- BL-825 has `required_wiring` entries (`letsTalkRoutes.ts::ui-bundle`,
  `BridgeClient.kt::resolveUiBundle`) that no architect pass has checked.
- BL-825's own gates (Article 4.1: architect design review, hardener
  coverage/CRAP) have not run. If BL-908's parcel reaches QA and QA approves
  it, BL-825's code lands on `main` having skipped two required pipeline
  gates.
- Backlog bookkeeping doesn't know this happened: BL-825's ticket still
  reads `status: todo`, `assigned_to: coder` — nothing will move it to
  `done/` when BL-908 closes, and nothing will flag that its code already
  shipped.

## Not this role's call to fix

Per role scope, documenter does not review architecture, verify test
coverage, or route parcels. Surfacing to the coordinator (Article 1.1:
"tracks parcel location in the pipeline and unblocks stalls") rather than
silently documenting BL-825 alongside BL-908 (which would imply gates it
never passed) or silently dropping the finding.

By documenter.
