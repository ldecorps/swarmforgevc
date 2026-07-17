# BL-490 QA bounce evidence — 2026-07-17

## 1. Failing command
```
git merge-base --is-ancestor e57a237ba7a07a56f88ce6bc78eb62435cac578d 7c2c7002db4069914b5a43ecfdd5317183e7cc4a
```
Exit code: `1` (not an ancestor).

## 2. Commit hash tested
`7c2c7002db4069914b5a43ecfdd5317183e7cc4a` — "Document BL-490: Telegram approval ask
gains Expedite (approve + force-promote + dispatch now)", the documenter's `git_handoff`
to QA (task `BL-490-expedite-approval-button`).

## 3. First error excerpt
The architect already bounced this ticket once, for exactly the DURABILITY/COMMIT
hazard the spec itself flagged as a hazard to resolve:

```
c30fced0 Merge architect bounce a1d89aeed2 (BL-490-VIOLATION) into swarmforge-coder
e57a237b Fix BL-490-VIOLATION: durably commit the Expedite verb's approve+promote writes
```

The coder's fix commit `e57a237b` (still sitting, unforwarded, at the tip of
`refs/heads/swarmforge-coder`) routes `recordExpediteDecisionAndClose` through the
existing `commit_integrity_cli.bb` mechanism after promote and before dispatch. But the
commit handed to QA, `7c2c7002db`, descends from `a1d89aee` — the cleaner's PRE-fix,
PRE-bounce merge that the architect rejected — not from `e57a237b`. Confirmed by
`git log --oneline --all --children | grep e57a237b`: `e57a237b` has zero children on
any branch; it was never merged forward into cleaner/architect/hardener/documenter.

The live tree at `7c2c7002db` still has the plain uncommitted write path:

```ts
export async function recordExpediteDecisionAndClose(
  adapters: PollAdapters,
  backlogId: string,
  nowMs: number = Date.now()
): Promise<{ changed: boolean; collision?: string }> {
  const changed = await adapters.recordApprovalReply(backlogId);
  if (!changed) {
    return { changed: false };
  }
  await adapters.promoteTicketIfPaused?.(backlogId);
  const collision = await adapters.checkExpediteFileCollision?.(backlogId);
  ...
```

— no `commit_integrity_cli.bb` call anywhere in `telegramFrontDeskBotCore.ts` at this
commit (`grep -n "commit_integrity" extension/src/tools/telegramFrontDeskBotCore.ts`
returns nothing), versus the fix commit which adds it.

## 4. Failure class
`behavior` — the delivered parcel does not satisfy the ticket's own DURABILITY/COMMIT
hazard requirement (spec's "DESIGN HAZARDS FOR THE ARCHITECT" section), which the
architect already reviewed, flagged, and bounced once. This is not a compile/unit/
acceptance test failure; the code that shipped to QA is provably the pre-bounce version.

## 5. Expected vs observed
Expected: the documenter's commit has the coder's BL-490-VIOLATION fix (`e57a237b`) as
an ancestor, so the durability fix ships with the rest of the parcel. Observed: it does
not — `e57a237b` was committed on `swarmforge-coder` but never forwarded via
`git_handoff` to `cleaner`, so cleaner/architect/hardener/documenter all continued
working from the stale, violation-containing `a1d89aee` lineage instead.
