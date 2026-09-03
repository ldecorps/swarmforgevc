# BL-1345 — architect bounce (2026-09-03)

## Review pass completed before this bounce (Article 4.4 — complete inventory)

- Merged cleaner `a8d00f5a68` (coder `7ed58805ff`) into architect worktree.
  Two trivial `require(...)`-list conflicts in `specs/pipeline/steps/index.js`
  and `swarmforge/scripts/test/suite-manifest.tsv` (both branches added a
  different line to the same list) — resolved by keeping both.
- Scope check: commit `7ed58805ff` touches exactly the files it declares
  (two production fixes, its own step/property/bb test files, manifest
  registration). No unrelated scope creep.
- `required_wiring` (`specs/pipeline/steps/index.js::bl1345StaleRouterMarkerStaffingSteps`):
  confirmed registered.
- Read both production diffs (`babysitter_check.bb`'s routing through
  `mono-router-lib/resolve-resident-role`, `remote_control_health_lib.bb`'s
  `assigned-role-mismatch` plus its `swarm_ensure.bb` call site placed after
  `actionable?`): logic matches the ticket's `invariants`, `constraints`
  (BL-1020/BL-648 untouched, no hardcoded per-role list per BL-804), and the
  human's approval_context. No correctness defect found in the production
  code itself.
- `bb swarmforge/scripts/test/bl1345_stale_marker_test_runner.bb` — ALL PASS.
- `run_acceptance.sh specs/features/BL-1345-…feature` — 7/7 pass.
- `bash swarmforge/scripts/test/test_swarm_ensure.sh` — ALL PASS (51 tests,
  the hotfix baseline the ticket names), independently re-run.
- Dependency-rule gate (BL-259), scoped and full-repo: PASSED, no forbidden
  edges, both times.
- Co-change report (BL-255): all reported co-changes at frequency 1 — no
  suspected coupling.
- Invariants 1 and 3's reach floors are structurally guaranteed (the marker
  states/rotation values are chosen by the enclosing `for` loop, not left to
  a `fc` draw to happen to produce them) — confirmed by reading the test,
  not just trusting its own "GENERATOR REACH (by construction)" header
  comment.

## D1 — invariant 2's reach floor is drawn by luck, not by construction

- **File**: `extension/test/bl1345StaleMarkerInvariants.property.test.js`,
  test `BL-1345/BL-654 invariant 2: a wrong-role pane is never healthy, and
  a right-role pane never cries wolf` (lines 124–170).
- **Class**: test-flakiness / non-vacuity gap — the identical shape to
  BL-1352's D1 bounce (`backlog/evidence/BL-1352-cleaner-bounce-20260903.md`),
  which this same coder's rework on BL-1352 fixed correctly just one ticket
  ago by enumerating the arm instead of drawing it.
- **Blamed role**: coder (BL-654: property authorship rests with the coder,
  first pass; property tests are outside cleaner's and architect's domain to
  author or fix).
- **Failure scenario**: for `rotationRouter = false`, the property draws
  `assigned` and `observed` independently from `fc.constantFrom(...ROLES)`
  (5 roles) at `numRuns: 12`. `reach.match` is only incremented when a draw
  happens to produce `assigned === observed` (probability 1/5 per draw).
  `P(no match in 12 draws) = (4/5)^12 ≈ 6.9%`. When no draw matches,
  `reach.match` stays `0` and the closing
  `assert.ok(reach.match > 0, 'never exercised a correctly staffed pane')`
  fails.
- **Reproduction**: ran `npx vitest run --config vitest.properties.config.mjs
  bl1345StaleMarkerInvariants` in a loop, 50 total runs — **5/50 failed**
  (10%), all on the same `never exercised a correctly staffed pane` assertion
  in invariant 2. Invariants 1 and 3 were stable across all 50 runs (their
  reach floors are chosen by the enclosing loop, not drawn).
- **Consequence if forwarded unfixed**: `npm run test:properties` is a real
  gate the hardener and QA will both run; this ships them a ~1-in-10
  intermittent red on a file they don't own fixing (same "Does Not Own"
  boundary that applies to every downstream pipeline role until it's back
  with the coder).
- **Remediation pointer**: the same fix BL-1352's D1 used — choose whether
  this draw is the matching or mismatching arm as an enclosing-loop CASE
  (e.g. `for (const same of [true, false])`, with `observed = same ? assigned
  : <a different role drawn or picked deterministically>`), so `reach.match`
  and `reach.mismatch` are both guaranteed to be exercised by construction
  rather than by chance. `reach.router` has no such risk (it is incremented
  unconditionally whenever `rotationRouter` is `true`, and that value is
  already chosen by the outer `for` loop).

## Nothing else found

No other item is outstanding from this pass; D1 is the sole defect. The
production code (both fixes), invariants 1 and 3, the bb runner, the
acceptance feature, and the `test_swarm_ensure.sh` baseline are all clean
and do not need to be re-run once D1 is fixed, but the coder should re-run
`npm run test:properties` several times (not once — the failure is
probabilistic, ~10% per run) before forwarding again, the same discipline
BL-1352's own re-review used.

## Action taken

Recorded via `record-bounce.js` and sending `git_handoff` back to coder,
naming this evidence file and the failure class.
