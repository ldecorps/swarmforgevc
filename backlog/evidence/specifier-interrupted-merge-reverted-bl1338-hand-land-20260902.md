# An interrupted merge silently reverted BL-1338's hand-land — 2026-09-02

## What happened

Routine specifier sync: `git fetch` then `git merge --no-edit origin/main`
in the master checkout. It failed with:

```
error: Unable to write index.
Automatic merge failed; fix conflicts and then commit the result.
```

There were **no conflicts** (`git diff --diff-filter=U` empty). The failure
was a concurrent git process in this shared checkout, the same class of race
already logged as "2nd coordinator races git -> transient add-failed". Git's
own message says to complete the merge with `git commit`, so I did — and that
wrote the **partially-written index** as the merge result.

Result: the merge commit dropped **eleven paths** that origin/main carries and
that were absent from BOTH the merge base and my side. A correct merge must
ADD such paths. In effect it reverted the entire BL-1338 hand-land
(`95e96ef217`, `a1450efaa3`) that QA/coordinator had just made:

```
backlog/active/BL-1338-a-routing-stamp-does-not-invalidate-an-adjudication.yaml
backlog/evidence/BL-1338-{architect,cleaner,documenter,hardener}-*.md
backlog/topics/BL-1338.json
extension/src/tools/deprecate-check.ts
extension/test/deprecateAdjudication.test.js
extension/test/deprecateRoutingStampFingerprint.property.test.js
specs/pipeline/steps/bl1338RoutingStampFingerprintSteps.js
specs/pipeline/steps/index.js
```

## What caught it

Diffing the merge against **both** parents before pushing — the standing rule
from BL-571/BL-958/BL-954. Nothing else would have: the merge reported
success, both commit guards pass on the resulting tree, and the working tree
looked clean. It was never pushed; `origin/main` is intact.

## Two findings worth acting on

1. **`git merge` refusing at pre-merge-commit does not stop the merge.** The
   first attempt was refused by `check_pipeline_code_on_main.sh` and
   `check_feature_handler_registration.sh` — and git's own advice, "use `git
   commit` to complete the merge", routes the next attempt through
   **pre-commit** instead, where those guards evaluate a different (and here,
   corrupted) state. The refusal is advisory on that path. That is a gate that
   can be walked past without intending to.
2. **An interrupted index write is not a conflict and does not announce
   itself.** "Unable to write index" left no conflict markers, no `UU` entries
   and no other signal. Completing the merge is the natural next step and it
   is silently wrong.

Both belong to the same family as BL-1341 (merge-deletion guard blind to the
incoming side) and are worth a slice; not minted here because the
delivery-machinery queue already has BL-1343 (critical, three parcels held)
and BL-1341 in front of them, and adding a fourth without a human's ordering
call would be noise.

## Correction to my earlier BL-1338 adjudication

`backlog/evidence/BL-1338-specifier-land-escalate-adjudication-20260902.md`
says "Nothing enumerates `specs/features/*`". That is **wrong**, and I found
it by tripping over the thing itself: `check_feature_handler_registration.sh`
(BL-1303) enumerates every feature file in the tree and refuses a commit or
merge-commit on `main` that would leave one with no runnable handler.

The adjudication's conclusion still holds — the *acceptance runner* takes one
feature file at a time, `specs/pipeline/generated/` is gitignored, and a
newly-minted feature with no handler does not make `main` red for other
parcels; the guard confirms it passes on this tree. But the reason I gave was
too strong and the coordinator's finding 3 deserved better than "overstated".

## State left behind, and what QA must do

- `origin/main` — correct and untouched.
- local `main` — carries the revert of **five** QA-exclusive paths and **must
  not be pushed** until they are restored.
- I restored the six backlog paths myself (`d2dd2d7ac2`). The other five are
  `extension/src/`, `extension/test/` and `specs/pipeline/steps/`, which
  `check_pipeline_code_on_main.sh` (BL-632) reserves to QA; it refused my
  commit twice while they were staged. Left un-restored and self-consistent
  (handler absent AND registration absent), never half-restored (BL-1303).

**QA:** `git checkout a1450efaa3 -- extension/src/tools/deprecate-check.ts
extension/test/deprecateAdjudication.test.js
extension/test/deprecateRoutingStampFingerprint.property.test.js
specs/pipeline/steps/bl1338RoutingStampFingerprintSteps.js
specs/pipeline/steps/index.js` on master main, verify
`git diff --name-status a1450efaa3 HEAD` then shows only BL-1344's three
files, and commit. Do not cherry-pick the whole merge.

By specifier.

## Update 18:36 UTC — the five paths are RESTORED IN THE WORKTREE, uncommitted

`origin/main` re-verified intact (`origin/main:specs/pipeline/steps/bl1338RoutingStampFingerprintSteps.js`
resolves). Local `main` is **14 commits ahead** and pushing it as-is would
revert BL-1338's five QA-exclusive paths on origin.

I restored all five from `a1450efaa3` and they are sitting in the master
worktree now, unstaged and untracked:

```
 M extension/src/tools/deprecate-check.ts
 M extension/test/deprecateAdjudication.test.js
 M specs/pipeline/steps/index.js
?? extension/test/deprecateRoutingStampFingerprint.property.test.js
?? specs/pipeline/steps/bl1338RoutingStampFingerprintSteps.js
```

They are deliberately NOT staged. `check_pipeline_code_on_main.sh` refuses ANY
commit while they are in the index — it reads the whole staged set, not the
commit's intent — so leaving them staged blocks every role's commits to main,
not just mine. It already refused two of my commits that had nothing to do
with them.

**QA, the whole remedy:** `git add` those five paths in the master checkout
and commit. No `git checkout` needed, the content is already correct. Then
`git diff --name-status a1450efaa3 HEAD` should list only files added by local
commits since, and main becomes pushable.

Do not `git stash` to tidy first — it is repo-wide and would take these five
with it.

By specifier.
