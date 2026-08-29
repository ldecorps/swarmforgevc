# BL-1237-reference-freshness-guard-is-direction-aware — architect bounce, 2026-08-29

## Review scope
- Task: BL-1237-reference-freshness-guard-is-direction-aware
- Commit reviewed: `e82aac52f4` (cleaner's merge of coder `fbeaf35b91`)
- Architecture (module boundaries, dependency direction), invariants, and
  correctness all reviewed. One item found; inventory is complete, one
  bounce.

## D1 — dangling require breaks acceptance run for this ticket's own feature file (and every other consumer of index.js)

**Class:** behavior (correctness defect, not architecture)

**What's wrong:** `specs/pipeline/steps/index.js` line 845 still contains
`require('./bl1247ReconcileSweepKillSwitchSteps'),` but that file does not
exist in this worktree (retired — `git log` shows it deleted at `4103c2cbb`,
"Retire BL-1247-reconcile-sweep-kill-switch: superseded by shipped BL-1248").

**Repro:**
```
node specs/pipeline/steps/cli.js specs/features/BL-1237-reference-freshness-guard-is-direction-aware.feature
```
fails immediately with:
```
Error: Cannot find module './bl1247ReconcileSweepKillSwitchSteps'
Require stack:
- specs/pipeline/steps/index.js
- specs/pipeline/generated/the-reference-freshness-guard-refuses-only-for-amendments-the-worktree-is-missing.generated.test.js
```

**Root cause, verified from history:** the coder's own commit `fbeaf35b91`
already fixed this exact line — its commit message says so explicitly
("Also fixes a stale require... left over from my own earlier merge-conflict
resolution") and the commit diff confirms the line was removed. But the
cleaner's merge into `e82aac52f4` brought this worktree's own prior branch
tip (which independently still carried the same stale require line, verified
at `b9b83552c:specs/pipeline/steps/index.js:845`) back together with the
coder's fix, and the merge outcome (`e82aac52f4:specs/pipeline/steps/index.js`)
has the line again. The fix that already landed once was silently reverted by
a merge — same class as the guardrail "A merge can silently revert
already-landed work — diff every merge against BOTH parents."

**Blast radius:** not scoped to this ticket. `index.js` is `require`d by
every generated acceptance test in the repo (`specs/pipeline/generated/*`),
so this breaks the acceptance run for ALL tickets, not only BL-1237's own —
confirmed no other require in `index.js` is dangling (`node -e` sweep of
every `require('./...')` against the filesystem, only this one path missing).

**Not separately ticketed:** grepped `backlog/` for
`bl1247ReconcileSweepKillSwitchSteps` and for `MODULE_NOT_FOUND`/"stale
require" — the only hits are BL-1258 (a different failure mode: retired
FILES resurrecting as a one-sided add) and unrelated tickets. Nothing covers
a fix's own deletion being reverted by a later merge.

**Remediation:** re-delete `specs/pipeline/steps/index.js:845`
(`require('./bl1247ReconcileSweepKillSwitchSteps'),`) and re-verify with
`node specs/pipeline/steps/cli.js specs/features/BL-1237-reference-freshness-guard-is-direction-aware.feature`
before re-forwarding. Recommend committing this fix as its own small commit
separate from any further merge, so a future merge from a branch that still
carries the stale line doesn't silently reintroduce it a third time.

## Everything else reviewed clean
- Dependency gate (`node extension/out/tools/dependency-gate.js`, full-repo,
  no args): PASSED, no forbidden edges. (A subset-scan naming only this
  ticket's changed JS files produced a false `acyclic` report against
  `bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js` — a known artifact
  of scanning a partial file set; the full-repo scan is authoritative and is
  clean.)
- Co-change report: no pair at/above threshold (frequency 3) among this
  ticket's changed files.
- Two-layer / IO boundary: `reference_freshness_lib.bb` stays pure (no `sh`
  calls added to the lib); `ready_for_next.bb` does the git IO and passes
  plain data in — matches the ticket's own out_of_scope/design direction.
- Declared invariants (both): backed by a non-vacuous fast-check property
  test (`extension/test/bl1237ReferenceFreshnessGuardIsDirectionAware.property.test.js`,
  drives the real `.bb` lib via `bb -e`, ran green: 3/3) plus a bb unit-test
  runner (`swarmforge/scripts/test/reference_freshness_lib_test_runner.bb`,
  ran green: ALL PASS) plus 6 real-git acceptance scenarios in the feature
  file (blocked from running end-to-end only by D1 above — the step handlers
  themselves are sound, the failure is the unrelated dangling require).
- No violation of the fail-closed default (absent/false ancestry answer
  still refuses); scenario 03 (behind case) logic unchanged.
