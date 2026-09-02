# BL-1321 — hardener pass, 2026-09-02

Reviewed commit `680b097753` (architect clean sweep), merged into hardender.
Review-only BL-848 stamp-off parcel for landed hotfix `3d70c0f4ec`: no
hotfix source touched by this parcel's own chain — only the acceptance step
handler `bl1321SeatedPreferredYieldStampSteps.js`, its Babashka
decision-driver CLI `bl1321ChaseRotateDecisionCli.bb`, and the `index.js`
registration.

## Load / process hygiene
- `uptime`: load average ~2.8-4.2 on 20 cores — quiet.
- `pgrep -fl 'node --test|stryker'`: no strays before starting.

## Checks run (independent re-run)
- `bb swarmforge/scripts/test/mono_router_lib_test_runner.bb` — ok.
- `bash swarmforge/scripts/test/test_handoffd_rule_proposal_rotate_wiring.sh`
  — ALL PASS (BL-795 redirect regression intact).
- `node specs/pipeline/cli.js
  specs/features/BL-1321-swarm-stamp-seated-preferred-yield-3d70c0f4ec.feature`
  — 9/9 pass, matching architect's evidence.
- `git diff 3d70c0f4ec HEAD -- swarmforge/scripts/mono_router_lib.bb
  swarmforge/scripts/test/mono_router_lib_test_runner.bb` — empty, confirming
  byte-identical to what landed. (Note: an initial broader diff that also
  included `handoffd.bb` showed substantial unrelated changes — that file
  has evolved through many other commits since 3d70c0f4ec, e.g. BL-1310's
  ahead-count gate and the 2026-09-02 redundant-overlap hotfix; scoping the
  check to only the two files the ticket names, as architect did, is what
  makes the byte-identical claim meaningful.)
- `required_wiring` re-verified by hand: `handoffd.bb:1518` calls
  `mono-router-lib/chase-rotate-decision` from `chase-rotate-to!` (1 match);
  `specs/pipeline/steps/index.js` registers
  `bl1321SeatedPreferredYieldStampSteps` (1 match).
- Confirmed the "six asserts / five distinct cases" finding by reading
  `mono_router_lib_test_runner.bb:901-928` directly: the first assert
  (`"seated preferred yields..."`) and the sixth
  (`"marker-active preferred yields even when live identity would be
  unreadable"`) pass byte-identical argument maps
  (`{:preferred "QA" :poked-role "specifier" :active-role "QA"
  :poked-actionable? true}`) and assert the identical expected result.
  Matches the ticket's own approval_context and architect's finding exactly.
- Confirmed the CRLF→LF claim: `file` reports both
  `swarmforge/scripts/mono_router_lib.bb` and
  `swarmforge/scripts/test/mono_router_lib_test_runner.bb` as plain UTF-8
  text with 0 carriage-return characters (`grep -c $'\r'` returns 0 for
  both) — consistent with a completed LF normalisation.
- Ledger row for `3d70c0f4ec`: `state: stamp-open`, `human_decision: null`
  — unmodified by this pass.

## Mutation / CRAP / DRY
Same posture as BL-1283/BL-1254/BL-1324 (this session's other stamp-off
reviews): no hotfix `.bb` source is touched by this parcel, and the one new
JS file is an acceptance step handler asserting against already-landed,
already-unit-tested production code (`mono_router_lib_test_runner.bb`'s own
6-assert suite covers the actual `chase-rotate-decision` behavior).
Mutating the step handler would test the review apparatus, not the hotfix.
Recorded explicitly as the applicable degraded-fallback case rather than
implied.

## Invariants (independently re-checked)
1. Never reimplements — confirmed via the empty byte-identical diff above.
2. Green never certifies — ledger row unmodified, confirmed above.
3. BL-795 redirect still fires wherever preferred is not the seated role —
   `test_handoffd_rule_proposal_rotate_wiring.sh` (case B, C) and acceptance
   scenario 03 both re-confirmed green.

## Whole-tree acceptance guard sweep
Same 3 pre-existing failures as every other pass today
(`tempDirTrapGuard`/`socketFixtureShortRootGuard`/`liveRepoDerivationGuard`,
tracked BL-1289/1290/1291) — none name any BL-1321 file.

## Merge-up bookkeeping (this batch pass)
Also handled in this session: merged QA's BL-1040 approved commit
`0df1c85cd2` (merge-only, no forward — see the separate merge commit
`f9c657232a` "Pre-drain four intakes..." required first, since
`check_merge_deletion.sh` refuses a merge that silently removes a path this
branch introduced when the introducing commit carries no ticket id in its
own subject; those four `backlog/INTAKE-*.md` files were already
legitimately drained upstream on main by BL-1056/BL-1327/BL-1336, confirmed
by content, and the pre-drain commit replicates that already-landed archive
move as a plain commit ahead of the merge, matching the same pattern the
architect used earlier today for the same reason).

## Lessons
No new `rule_proposal` — the merge-deletion pre-drain pattern is already
documented (seen twice today, once on the architect branch for BL-1321's
own merge, once here for QA's BL-1040 merge-up); no new failure mode found.

## Verdict
Clean sweep — no defect found. Forwarding to documenter.
