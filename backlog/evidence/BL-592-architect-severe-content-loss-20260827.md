# BL-592 — severe content loss on swarmforge-architect, cannot review (2026-08-27)

## Summary

BL-592's actual implementation has never successfully landed on the
`swarmforge-architect` branch's tracked history, across THREE coder/cleaner
delivery rounds and two architect merge attempts this session. This is not
a coder defect — the coder's own commits are clean and correct (verified
directly, see below). The branch's git tracking itself is silently missing
most of this ticket's files. I cannot complete an architecture review
without a real tree to review, and I am not attempting to reconstruct one
myself (outside my role, and too large/risky a git-surgery operation to
guess at, per the same posture the prior architect pass took — see
`backlog/evidence/BL-592-architect-worktree-anomaly-20260827.md`).

## What I found

Original coder commit `e5cf2a3af` ("BL-592: live spec tree on Mini App
console with epic tier (schema v2)") is a real ancestor of my current HEAD
(`git merge-base --is-ancestor e5cf2a3af HEAD` → true) and its own diff is
clean and complete: adds `extension/src/bridge/specTreeUiHtml.ts` (new,
254 lines), wires 3 routes into `bridgeServer.ts` (+22 lines), bumps
`docsTree.ts`'s `DOCS_TREE_SCHEMA_VERSION` to 2 with epic-grouping logic,
updates 3 test files, adds a property test, updates `pwa/app.js`, and adds
the acceptance step file + feature file.

None of that is actually present in my tree right now:

| File | State |
|---|---|
| `extension/src/bridge/specTreeUiHtml.ts` | **does not exist on disk at all** |
| `extension/test/bl592SpecTreeEpicTierInvariants.property.test.js` | **does not exist on disk at all** |
| `extension/src/bridge/bridgeServer.ts` | exists, **untracked**, zero `spec-tree`/`BL-592` references (pre-BL-592 content) |
| `extension/src/docs/docsTree.ts` | exists, tracked, **pre-BL-592 content** (no `DOCS_TREE_SCHEMA_VERSION`, no `NO_EPIC_KEY`) |
| `extension/test/docsTree.test.js` | exists, tracked, **pre-BL-592 content** |
| `extension/test/pwaDocsExplorer.test.js` | exists, tracked, **pre-BL-592 content** (`schemaVersion: 1` not `2`) |
| `extension/test/pwaLocale.test.js` | exists, tracked, **pre-BL-592 content** (`schemaVersion: 1` not `2`) |
| `pwa/app.js` | exists, tracked, **pre-BL-592 content** (no `milestoneEpics` helper) |
| `extension/src/bridge/consoleMenuUiHtml.ts` | exists, tracked, **pre-BL-592 content** (no spec-tree link) |
| `specs/features/BL-592-...feature` | was untracked; I committed it myself this pass (byte-identical to specifier's `1215724dd`) |
| `specs/pipeline/steps/bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` | tracked, present, **has the D1 afterEach fix** — this is the ONLY BL-592 file that survived intact |

Every "differs" row above was diffed directly against `git show
e5cf2a3af:<path>` — not inferred.

## Consequence I actually hit

Running the acceptance feature directly: 1/8 scenarios pass. The one that
passes ("the spec tree is not served from the static PWA artifact") is a
negative assertion that happens to hold on the OLD code too. The other 7
fail with `401`/`assertion mismatch`/schema-version errors — entirely
consistent with the bridge never having the `/spec-tree` route at all.

## Why I'm not just re-adding these files myself

I already did this once, safely, for two much smaller cases this session
(the acceptance feature files for BL-1188/BL-1189/BL-592 — a single
pre-existing, verified-identical file each). This is categorically
different: 8 files, including a **from-scratch 254-line file that doesn't
exist on disk anywhere in this worktree** (not even untracked) and several
files whose CURRENT tracked content actively conflicts with what BL-592
needs (docsTree.ts, pwa/app.js, etc. would need real 3-way merges, not a
mechanical `git checkout <old-sha> -- <path>`, since other tickets may have
also touched these files in between — I have not audited that, and I am
not the role that should be doing a from-scratch reimplementation-by-git-
archaeology of another role's already-completed work).

## Root cause hypothesis (not confirmed, flagging not asserting)

Consistent with the prior architect's `BL-592-architect-worktree-anomaly-20260827.md`
finding ("HEAD tree collapsed to 3 paths", `git revert -n e5cf2a3af4`
blocked by untracked-file conflicts on all 8 pre-existing files it
touches — the exact same 8 files listed above). That finding's "I did not
force-clear... not willing to guess at destructive tree surgery" decision
was correct then and I'm making the same call now, with more evidence:
whatever collapsed this worktree's tree that day appears to have partially
"healed" (most of the repo's other ~40+ files are back, unrelated tickets
merge and compile cleanly - see BL-1188/BL-1189 reviews this session,
both compiled and tested clean) but BL-592's specific 8 files were never
actually restored to their post-e5cf2a3af state - they either reverted to
pre-BL-592 content or never rejoined tracking at all.

## Disposition

- **Not bouncing to coder.** Their commits (`e5cf2a3af`, `308f21bca`) are
  both clean, complete, and address exactly what they claim to. Re-asking
  coder to redo this work would very likely reproduce the identical
  problem, since the loss is happening on MY branch's tracking, after
  their commits land cleanly.
- **Not forwarding to hardener.** There is nothing real to harden.
- Flagging via `note` (priority `00`) to specifier + coordinator — this
  needs someone with authority over worktree/branch health, not another
  architecture pass. Recommending: verify whether `swarmforge-architect`'s
  branch needs a from-scratch re-clone/re-checkout from a known-good
  ref, or whether `e5cf2a3af`'s tree can be cherry-picked wholesale onto
  current HEAD by someone with time to properly 3-way-merge the handful of
  files that have since diverged (`docsTree.ts`, `pwa/app.js`,
  `consoleMenuUiHtml.ts`).
- Completing my own inbound task without forwarding a parcel (same
  disposal shape as a spec-gap finding: note out, no bounce, no forward).
