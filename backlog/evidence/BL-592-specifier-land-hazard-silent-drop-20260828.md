# BL-592 — landing the queued parcel silently drops its entire deliverable

**For QA, before it processes `82e422a910`.** Read-only analysis; no merge was
performed and no branch was touched.

## Summary

The BL-592 parcel now sitting in QA's `inbox/new`
(`00_20260828T004012Z_000867_from_documenter_to_QA`, `git_handoff`, commit
`82e422a910`) is complete and correctly lineaged. **But merging it into current
`main` with a plain `git merge` produces a tree that contains none of BL-592's
implementation — with no conflict raised and no gate turning red.**

Simulated read-only with
`git merge-tree --write-tree --name-only main 82e422a910` → result tree
`34527aaa69783b1969154e00b43aacc63dc30b73`.

## Why it happens (BL-571 / BL-958 shape)

`main` and `82e422a910` have **two** merge bases:

```
34a57c8385955f2dc1d70a5dcf4b396256216c53
d474c423e57ad8f2a8216a6a01e066531b10e38e
```

so the recursive strategy builds a *virtual* base. That virtual base carries
BL-592's files (they descend from `e5cf2a3af`, an ancestor of `main`), `main`'s
side no longer has them after the reset/rematch churn, and the parcel side has
not modified them *since that virtual base*. Git therefore resolves the pair as
"deleted on one side, unchanged on the other" and **takes the delete silently**.
It is not reported as a modify/delete conflict, so the merge looks clean.

This is exactly the hazard the constitution names: *a merge can silently revert
already-LANDED work the sender never had — diff every merge against BOTH
parents and read the deletions.*

## What disappears — MUST be restored on land

| Path | What it is |
|---|---|
| `extension/src/bridge/specTreeUiHtml.ts` | BL-592's implementation, 254 lines |
| `specs/pipeline/steps/bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` | its acceptance step handler |
| `extension/test/bl592SpecTreeEpicTierInvariants.property.test.js` | its property test |
| `extension/test/bl1188PipelineGridLiveStageParityInvariants.property.test.js` | BL-1188 property test |
| `extension/test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js` | BL-1189 property test |
| `extension/test/pipelineGridLive.test.js` | BL-1188 unit test |
| `backlog/evidence/BL-592-coder-pass-20260827.md` | evidence |
| `backlog/evidence/BL-592-coder-bounce-fix-20260827.md` | evidence |
| `backlog/evidence/BL-1188-coder-pass-20260827.md` | evidence |
| `backlog/evidence/BL-1188-cleaner-branch-corruption-property-suite-20260827.md` | evidence |
| `backlog/evidence/BL-1189-coder-pass-20260827.md` | evidence |
| `backlog/evidence/BL-428-coder-dispatch-investigation-20260827.md` | evidence |
| `backlog/evidence/BL-1124-property-fixture-git-env-leak-20260827.md` | evidence |
| `backlog/evidence/architect-vitest-node-test-no-suite-found-20260827.md` | evidence |

### The sharpest consequence

`specs/features/BL-592-spec-tree-on-live-console-with-epic-tier.feature`
**does** land, while its step handler does **not**, and the merged
`specs/pipeline/steps/index.js` carries **zero** `bl592SpecTree` references.
The acceptance runner throws on a scenario with no registered handler
(BL-233), so this lands a red acceptance gate that will also block the next
unrelated parcel through the hardener/QA gates.

## What must NOT be restored — legitimate pool moves

These six also read as "dropped" against the parcel, but the merged tree is
**correct** and the parcel's copy is the stale one. Restoring them would
regress QA-approved closes (the BL-954 trap):

| Path in parcel | Correct location in merged tree |
|---|---|
| `backlog/active/BL-1184-briefing-shift-velocity.yaml` | `done/` |
| `backlog/active/BL-428-decrap-preexisting-high-crap-on-touch.yaml` | `done/` |
| `backlog/active/BL-644-what-not-to-do-when-tweaking-the-swarm.yaml` | `done/` |
| `backlog/hold/BL-751-bl646-pilot-missed-severity-asymmetry.yaml` | `done/` |
| `backlog/hold/BL-1200-shell-test-…-git-dir-redirect.yaml` | `done/` |
| `backlog/paused/BL-1186-deprecator-identify-unused-notify.yaml` | `active/` |

## Recommended land procedure

1. `git merge --no-ff --no-commit 82e422a910`.
2. Diff the staged result against **both** parents and read the deletions —
   do not trust a clean merge.
3. `git checkout 82e422a910 -- <each of the 14 regression paths above>`.
4. Confirm `specs/pipeline/steps/index.js` registers the BL-592 handler; if the
   content merge dropped the registration line, restore it.
5. Leave the six pool-move paths at the merged tree's location.
6. Re-run compile + the acceptance feature before landing.

## Also resolved by this parcel

`d474c423e5` (BL-1200's documenter commit) is one of the two merge bases, so
this parcel's lineage already carries BL-1200's `hold/ → done/` pool move.
That closes the BL-1200 mis-pooling flagged separately today — no coordinator
action needed once this lands, though note that a BL-1200 parcel is
simultaneously `in_process` at QA, so the two must not both land the move.

## Disposition

No spec defect; BL-592's spec is current and needs no amendment. This is a
land-mechanics hazard, reported to QA before the fact rather than diagnosed
after. No new ticket minted — the underlying gap (a merge silently reverting
work the sender never had) is already owned by BL-1216's family and by the
BL-571/BL-958 rule.

By specifier.
