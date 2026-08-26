# BL-514 QA-bounce resolution — 20260815 (architect pass 3)

Commit merged: `1ba16651d1` (QA's bounce, `backlog/evidence/BL-514-bounce-20260815.md`).
Resulting merge in this worktree: `0a3569281`.

## QA's D1: BL-765's un-reverted commit rides along

QA's finding was that the commit it was asked to land for BL-514 carried
BL-765's invariant-2 violation (`fetchBubbleConfig` applying capability
flags field-by-field instead of whole-document rejection), un-reverted,
naming `fe2e4b8ad5` as the bounce commit.

**Correction to the record:** `fe2e4b8ad5` ("BL-765: dedupe BridgeClient's
GET-and-parse boilerplate") is not the bounce commit — it is the coder's
pre-bounce commit, an ancestor of the actual bounce
(`1771ff9cf`/`9ce82ec95`, `backlog/evidence/BL-765-bubble-remote-config-and-chiptune-catalog-bounce-20260815.md`).

**Root cause (verified, not assumed):** the coder's remediation
(`f40ef9bc4`, "BL-765: reject the whole bubble-config document on a
wrong-typed flag") landed and I approved it in this ticket's own
"architect pass 2 — invariant 2 remediation verified" (BL-765 ticket,
2026-08-15), forwarding to hardener. That approval line (`4964c3ada` and
its descendants) is NOT an ancestor of `ede6574276` (documenter's commit
that fed QA's review) — `git merge-base --is-ancestor 4964c3ada
ede6574276` and `...f40ef9bc4 ede6574276` both return false. Under
mono-router's shared per-role branches, the hardener->documenter->QA chain
that produced `ede6574276`/`0fec8b6329` forked from a point on the coder
branch *before* the invariant-2 fix merged forward — a branch-divergence
gap, not a missing revert. QA's remediation option (b) — "if BL-765's fix
has in the meantime landed for real, re-verify that fix is what's actually
present in the branch before re-forwarding" — is the applicable path, not
option (a) (revert).

## Re-verification performed on the merged tree (this worktree, HEAD `0a3569281`)

- `git merge-base --is-ancestor f40ef9bc4 HEAD` → true (fix is an ancestor).
- Direct content read of
  `android/app/src/main/java/com/swarmforge/floatcompanion/BridgeClient.kt`
  (not ancestry alone, which "can never go false" the same way a revert
  check can't): `parseBubbleConfig` performs whole-document rejection
  (missing/non-object `features` or any non-boolean flag → `null`),
  `fetchBubbleConfig` falls back to `BubbleConfigResult(false, ...)` on a
  null parse. Matches `f40ef9bc4`'s diff exactly; the merge took this side
  cleanly (QA's line made no further changes to this file since the common
  ancestor `fe2e4b8ad5`, so there was no conflict to resolve).
- `BridgeClientBubbleConfigPropertyTest.kt` present at
  `android/app/src/test/java/com/swarmforge/floatcompanion/`.
- `JAVA_HOME=/usr/local/opt/openjdk@17 ./gradlew :app:testDebugUnitTest
  --tests "*BubbleConfig*"` (my own run, on the merged tree): BUILD
  SUCCESSFUL.
- `cd extension && node out/tools/dependency-gate.js
  src/bridge/bridgeServer.ts` (my own run): PASSED, no forbidden edges.

## Disposition

D1 is resolved on this branch: the invariant-2 fix is genuinely present,
verified by content and by a fresh green test run, not merely by ancestry.
No revert is needed or appropriate (the code at HEAD is correct, not
defective — reverting would remove the fix). Re-forwarding BL-514 to
hardener per QA's own instruction, carrying this merge as the commit.

Filing a `rule_proposal` separately: a downstream role that re-verifies a
sibling-ticket fix under mono-router batching should confirm by content/
ancestry against the specific fix commit, not only check for an unreverted
bounce commit — a fix that lands on a diverged parallel line is invisible
to a plain revert-check.

By architect.
