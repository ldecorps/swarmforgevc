# BL-1339 hardener pass — 2026-09-03

Merged architect commit `3a9c2165ab` (clean sweep, no defect) onto this
worktree as `bab5d526fc` (one trivial additive conflict in
`specs/pipeline/steps/index.js`, same shape as this session's other
merges — resolved keeping both requires; confirmed no BL-1345 remnants
reappeared, matching the architect's deliberate revert).

## Human ruling followed (option 2)
Writer (`land_step_lib.bb`) resolves the shared target root via the
pre-existing `git-common-dir` resolver; reader (`is_qa_ancestor.sh`)
resolves the land-approval store the same way, falling back to the old
relative path only when git cannot answer. The bounce stores stay on
the caller's directory (option 3 correctly out of scope) — confirmed by
reading both diffs, not just trusting the architect's evidence.

## Babashka/shell, no-tooling posture (engineering.prompt, Startup Tools)
All production code is `.bb`/`.sh`
(`land_step_lib.bb`, `is_qa_ancestor.sh`) — no Stryker/CRAP/DRY wired.
Gated by its own suite, re-run here:
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- `test_land_step_records_approval.sh`,
  `test_is_qa_ancestor_land_replay_store.sh`,
  `test_is_qa_ancestor_expedite_store.sh`,
  `test_is_qa_ancestor_yaml_store.sh`,
  `test_build_freshness_land_replay_approved.sh` — all ALL PASS/ALL
  CHECKS PASSED, confirming the three named daemon consumers (handoffd's
  push sweep, the babysitter sweep, the deploy freshness gate) and the
  BL-952 bounce veto union all still hold.
- `bash -n swarmforge/scripts/is_qa_ancestor.sh` — clean.
- `bb -e '(load-file ".../land_step_lib.bb")'` — loads clean.

## Acceptance
`node specs/pipeline/cli.js
specs/features/BL-1339-a-land-approval-record-lands-where-the-predicate-reads.feature`
— 7/7 pass.

## BL-113 Gherkin soft mutation
One `Scenario Outline:` (checkout: main checkout | linked worktree — the
actual axis of the defect). Ran fresh (`mktemp -d`, deleted after):
**2/2 killed, 0 survived, 0 errors** — mutation-tight.

## Property test
`bl1339LandApprovalRootInvariants` — re-run 5 consecutive times, 3/3
each. Matches the architect's finding that the reach floors are
enumerated by the enclosing loop over the checkout axis (main vs.
worktree), not drawn — no BL-1345-style D1 risk here.

## Standing whole-tree guards
Parcel touches `specs/pipeline/steps/` and adds an `extension/test/`
property test file. Ran all 17 `test/*Guard*.test.js` (excluding
`.property.` siblings). Same 3 pre-existing, already-ticketed failures
as this session's earlier passes (BL-1289/1290/1291) — confirmed by grep
that none names `bl1339LandApprovalSharedRootSteps.js`,
`bl1339LandApprovalRootInvariants.property.test.js`,
`land_step_lib.bb`, or `is_qa_ancestor.sh`.

## Other checks
- `node out/tools/dependency-gate.js` — PASSED.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean.

## Verdict
No defect found; nothing beyond what the architect already verified.
Forwarding to documenter.
