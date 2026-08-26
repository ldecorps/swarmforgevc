# BL-1041 architect pass (re-fix) — 2026-08-22

**Parcel:** cleaner forward `a3f5c6aba9`, merged into architect at
`172f167c3`. Carries the coder's re-fix (`978fcbc83`, "the rescued path
set comes from the stash, not from the tree") and cleaner's own follow-up
(`a3f5c6aba9`, restoring the role-named byline my bounce revert correctly
dropped along with the rest of the feature). Ancestry confirmed: my
earlier bounce commit (`08f87ddc49`) is an ancestor of this re-fix.

**Merge note:** another `specs/pipeline/steps/index.js` conflict, this
time the opposite direction from the BL-1036 merge - my side had only the
BL-1036 registration (post-bounce), their side re-added BL-1041's
alongside it. Resolved by keeping both. Diffed the merge against both
parents: P1 diff is the re-fix's own additive work; P2 diff is only my
prior BL-1036 evidence file. Nothing unexpected either direction.

**Verdict: PASS.** Both bounced defects independently re-verified fixed,
end to end, against the real compiled CLI - not merely re-reading the
commit message.

## D1a and D1b — re-verified fixed, by hand

Re-ran my exact original reproductions from the bounce (fresh fixture
repos, not reused):

- **D1a** (pre-existing uncommitted work must not be swept): built a repo
  with an unrelated pre-existing uncommitted edit to `mine.ts`, then
  rescued a stash touching only `seat.ts`. Result: `RESCUED ... (1
  file(s))`, commit's `Files:` line names only `seat.ts`, and `mine.ts`
  remains uncommitted in the tree afterward (`status --porcelain` still
  shows ` M mine.ts`) - the fix stops the sweep.
- **D1b** (brand-new untracked file must not be missed): built a repo,
  stashed a genuinely untracked new file with `stash push -u`, ran the
  CLI. Result: `RESCUED` (not the prior false "nothing to rescue" refusal),
  and `git show HEAD:newFeature.ts` contains the rescued content.

## The fix itself

`rescue_orphaned_work.bb` now reads the path set from
`git stash show --include-untracked --name-only <ref>` - the STASH's own
content - before touching the worktree at all, replacing the old
post-apply `git diff --name-only HEAD`. This is exactly the root-cause fix
my bounce evidence recommended: deriving from the source rather than from
"whatever the tree currently looks like" cannot be contaminated by
pre-existing dirty state (D1a) and correctly includes untracked entries
the stash carries (D1b). The refusal message when a stash is genuinely
empty now says so honestly ("carries no files") instead of the previous
factually-wrong "changed no tracked file".

Worth noting: the coder's own commit message is candid that a synthetic
break attempt for this fix was NOT faithful (moving the read-vs-apply call
changed the ordering enough that the script aborted early rather than
exercising the defect) and reports no fabricated non-vacuity count for it
- relying instead on the real, pre-fix reproduction of both defects
(stronger evidence than a constructed break). Reasonable and honestly
reported; I independently re-confirmed both defects are fixed above rather
than taking the claim on faith.

## Verification re-run live

- `bash swarmforge/scripts/test/test_rescue_orphaned_work.sh` → **ALL
  CHECKS PASSED**, including the two new regression scenarios (D1a, D1b)
  and the restored scenario 06 (role-named byline).
- `bb swarmforge/scripts/test/rescue_lib_test_runner.bb` → **ALL PASS**
  (unchanged; `rescue_lib.bb` itself was not touched by this re-fix).
- `bb swarmforge/scripts/test/bl1041_rescue_durability_property_runner.bb`
  → **300 runs, ALL PROPERTIES HOLD** (same coverage numbers as my original
  pass - unaffected, as expected).
- `node specs/pipeline/cli.js specs/features/BL-1041-a-rescue-never-makes-orphaned-work-less-durable.feature`
  → **4/4**.

## Scope unchanged from original pass

No `extension/` TypeScript files touched by this re-fix - dependency-gate
and co-change remain not applicable, same as my original BL-1041 review.
Architecture conclusions from that pass (pure `swarmforge/` maintained-fork
tooling, no two-layer/webview/secrets concerns) stand unchanged.

— By architect.
