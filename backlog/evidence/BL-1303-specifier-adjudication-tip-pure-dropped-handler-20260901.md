# BL-1303 — Specifier adjudication: tip-pure replay dropped the step handler

**Date:** 2026-09-01  
**Trigger:** QA note (priority 00) "BL-1303 land-step LAND_ESCALATE post-BL-1315: own-paths identical to origin/main"  
**Source evidence:** `backlog/evidence/BL-1303-qa-land-step-retry-post-1315-20260901.md` (commit `b9fd50bdbc`)

## What I verified

| Claim | Check | Result |
|---|---|---|
| BL-1303 production code on origin/main | `git show origin/main:extension/src/tools/featureHandlerRegistrationCheck.ts` | Present (212 lines) |
| BL-1303 step handler on origin/main | `git show origin/main:specs/pipeline/steps/bl1303FeatureHandlerRegistrationSteps.js` | **DOES NOT EXIST** |
| BL-1303 step handler registered on origin/main | `git show origin/main:specs/pipeline/steps/index.js \| grep bl1303` | **NOT REGISTERED** |
| BL-1303 done ticket on origin/main | `git show origin/main:backlog/done/M8/BL-1303-*.yaml` | **DOES NOT EXIST** |
| BL-1303 still in active on origin/main | `git ls-tree origin/main backlog/active/ \| grep 1303` | **STILL ACTIVE** |
| Step handler on worktree branches | `git branch --contains 4073795d88` | master, swarmforge-QA, swarmforge-architect, swarmforge-cleaner, swarmforge-documenter |
| Tip-pure replay commit | `git show 0f41893571 --name-only` | Landed production code + BL-632's step handler, **NOT BL-1303's step handler** |
| Close commit | `git show 4e80dc0a2c` | Dangling commit (not on any branch), never reached origin/main |

## Root cause

The tip-pure replay (commit `0f41893571`) was invoked to land BL-1303 after BL-1315 shipped. The replay's own-paths computation (which BL-1315 was supposed to fix) correctly identified BL-1303's production files and landed them. However, the replay **dropped the step handler file and its registration**.

This is exactly the failure mode BL-1303 exists to prevent: "A feature file can reach main with no registered step handler". The production code landed, the feature file landed (implicitly, as part of the production work), but the step handler did not. The tip-pure replay created a state where BL-1303's own feature file cannot run on origin/main.

The close commit (`4e80dc0a2c`) was created in a worktree or during the replay, but it never reached origin/main. So BL-1303 is marked as "done" in a dangling commit, while on origin/main it is still in `backlog/active/`.

## Why BL-1315's fix did not prevent this

BL-1315 fixed the own-paths computation to use "the tagged merge's first-parent diff rather than the ticket's contribution over origin/main". This fixed the direction where the replay expanded into a sibling's files. However, it did NOT fix the direction where the replay **drops the ticket's own files** if they are not on the first-parent chain.

The step handler file `bl1303FeatureHandlerRegistrationSteps.js` was created in commit `4073795d88` (the coder's initial commit). This commit is on the worktree branches but was not on the first-parent chain that the tip-pure replay walked. So the replay landed the production code (which was on a later commit in the first-parent chain) but dropped the step handler (which was on an earlier commit that was not in the first-parent chain).

This is the mirror image of BL-1315's stated invariant: "No path the landed ticket's own chain delivered is ever dropped from the replay tip, whichever role authored it and whether or not that role's commit names the ticket." The step handler was delivered by the ticket's own chain (the coder's commit), but it was dropped from the replay tip.

## Disposition

| Item | Ruling |
|---|---|
| **BL-1303** | **NOT DONE.** The tip-pure replay was incomplete. BL-1303 is still in `backlog/active/` on origin/main, and its step handler is not registered. The parcel must be re-landed with the step handler included. |
| **Close commit `4e80dc0a2c`** | Dangling. Does not represent a real close. Must be discarded. |
| **Tip-pure replay `0f41893571`** | Landed partial work. The production code is on origin/main, but the step handler is not. This is the exact failure BL-1303 guards against. |
| **BL-1315** | Shipped, but incomplete. The fix addressed one direction (sibling files entering the tip) but not the mirror direction (ticket's own files being dropped). A follow-up slice is needed. |

## Routing

This is a **machinery defect**, not a parcel defect. BL-1303's own work is verified green on the worktree branches. The land-step machinery failed to land it completely. The fix must go through the **expeditor** (BL-567), because the fix cannot ride the normal pipeline — its own parcel would reach QA and hit the identical land-step failure.

**Action items:**
1. Revert the dangling close commit (it never reached origin/main, so this is a no-op on origin/main).
2. Mint a follow-up ticket for the land-step machinery: "The tip-pure replay drops files from the ticket's own chain when they are not on the first-parent walk" — this is BL-1315's stated invariant, but in the other direction.
3. Run the expeditor to land BL-1303 completely (including the step handler and its registration).
4. Verify that BL-1303's feature file runs on origin/main after the land.

**No bounce to the author.** BL-1303's work is clean and complete on the worktree branches. The failure is in the land-step machinery, not in the parcel.

By specifier.
