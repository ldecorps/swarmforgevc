# BL-549 second review: prior bounce is FIXED; parcel carries an unrelated silent merge regression

**Stage:** architect · **Date:** 2026-07-23 · **Ticket:** BL-549 (backlog/active/)
**Reviewed commit:** 9246bb0de5 (from cleaner) · **Supersedes:** c329dfdbef
**Prior bounce:** BL-549-acceptance-does-not-guard-1mib-boundary-20260723-architect.md

## My previous bounce is fully remediated — do not rework any of it

The rework took the stronger of the two options I offered and it is correct.
Verified this pass, by measurement, not inspection:

- `buildOversizedTestRepo` / `addOversizePaddingCommit` build a repo whose
  full-history `--name-status` output **genuinely exceeds 1 MiB**, and both the
  unit fixture and the acceptance Background **hard-fail if it does not**
  (`Buffer.byteLength(rawOutput) > ONE_MIB`). The Gherkin Background text is now
  a true statement rather than a false precondition.
- Scenario 1 and the new unit test call `runGitLog(dir, '.')` with **no
  maxBuffer override**, so they exercise the default — the actual regression
  boundary.
- **Non-vacuity proven both levels.** With the default reverted to
  `1024 * 1024`:
  - unit: `1 failed | 22 passed` — exactly the new test fails;
  - acceptance: `not ok 1 - a whole-repo history over the default buffer cap
    still yields co-changers`, scenario 2 still ok.
  Restored to `64 * 1024 * 1024`: both green.
- Padding lives in its own commit, so it adds history bytes without becoming a
  co-changer of `A.ts`; `B.ts: 3 co-change(s)` still holds.
- **Suite stays fast.** New unit test 148 ms; BL-549 acceptance 0.52 s for both
  scenarios. Full unit suite green: **341 files / 5701 tests in 8.62 s**.
- Dependency-rule gate **PASSED** on the changed files and on a full-repo scan.
- `co-change-report.js` returns real co-changers live (this review used it).

Keep all of the above exactly as it is.

## Property testing (architect-owned phase)

**No property test is warranted for this parcel, and I am not manufacturing a
vacuous one.** The only production change is to `runGitLog`, which is impure —
it shells out to `git`. The pure module in this file, `parseGitLog`, is
untouched by the parcel and already has direct example coverage. No pure module
with a new broad-input invariant was touched.

## The defect — out-of-scope content silently dropped by a merge

`extension/src/bridge/contextTelemetryGate.ts` is not a BL-549 file. BL-549
touches `runGitLog` in `gitHistoryAdapter.ts`; `contextTelemetryGate.ts` shells
out to `bb` and has no relationship to it. The parcel nevertheless **deletes
five lines** from it:

```
-// GH-23 architect bounce: a missing `bb` install or a non-zero/corrupt CLI
-// exit must degrade this one dashboard to its own empty state, not throw
-// inside the bridge server's request handler — see bridgeServer.ts's
-// computePausedPagerState / swarmMetrics.ts's gitFollowHistory for the same
-// guarded-shell-out convention this mirrors.
```

Traced:

| commit | comment present |
|---|---|
| `595c06a91` (GH-23 fix that added it) | yes |
| `c329dfdbef` (cleaner merge) | **no** |
| `9246bb0de5` (this parcel) | **no** |
| `main` | yes |

`595c06a91` is an ancestor of `9246bb0de5`, and the removal appears in **no
ordinary commit** — `git log -S` finds only the commit that ADDED it. It shows
up only with `--diff-merges=first-parent`, inside
`c329dfdbef "Merge commit '66e174d981' into swarmforge-cleaner"`. So this was
not an edit anyone made: **a merge resolution silently discarded content that
was already in its own ancestry.**

The guard itself (`try { … } catch { return null; }`) survives — only its
rationale was lost.

## Why this is a send-back and not a note

1. **It will land.** The deletion is a real change relative to
   `merge-base(main, 9246bb0de5)`, so when QA merges this parcel, those five
   lines come off `main`. Nothing downstream would catch it: mutation runs over
   `out/**` and does not see comments, and QA reviews against the BL-549 ticket,
   which this file has nothing to do with.
2. **BL-506.** Un-ticketed content riding a parcel into an approval is exactly
   what review stages are required to reject. An approval authorizes only its
   ticket's work.
3. **It erases a previous architect bounce's reasoning.** That comment exists
   precisely so a later refactor does not strip the `try/catch` and re-open
   GH-23. Deleting it removes the guard's only defence.
4. **The mechanism is the real risk.** A merge that drops content from its own
   ancestry without a conflict will do it again — next time to functional code,
   just as invisibly. This one is cheap to catch because it is only a comment.

## Remediation — small, and nothing else

1. Restore the five-line `// GH-23 architect bounce: …` comment block above
   `runCli` in `extension/src/bridge/contextTelemetryGate.ts`, so the file
   matches `main` (`git show main:extension/src/bridge/contextTelemetryGate.ts`
   is the reference). The parcel must contain **no** net change to that file.
2. Re-check before forwarding that the parcel's diff against
   `merge-base(main, HEAD)` touches only BL-549 files:
   `gitHistoryAdapter.ts`, `gitHistoryAdapter.test.js`,
   `coChangeMaxBufferSteps.js`, `specs/pipeline/steps/index.js`, the BL-549
   feature file, and the two `backlog/evidence/` notes.
3. **Change nothing else.** The maxBuffer default, the stderr diagnostic, both
   scenarios, both fixtures and every test above are approved as they stand.

## Bounce hygiene

Per BL-490/BL-495 I reverted my review-merge of `9246bb0de5`
(`b6387c4f9`) out of `swarmforge-architect` in the same step as this
send-back, so un-approved content is not an ancestor of my next review.

## Note on the two `backlog/evidence/BL-548 / BL-557` files

Unchanged from my first review: non-functional coder findings about other
tickets' promotion state, not code. Not a scope violation; not bounced on.
