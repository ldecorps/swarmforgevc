# BL-1340 — LAND SUCCESS, 20260902

Follows `BL-1340-qa-approval-20260902.md` (full independent verification,
APPROVE, `9b33daac46`). Per BL-1241's escalation ladder:

1. `bb swarmforge/scripts/land_step_cli.bb BL-1340-promotion-refuses-a-draft-the-ticket-itself-converts 1a2985b4fc`
   returned `LAND_REPLAY land-replay/BL-1340-1a2985b4fc c8934782326892bc688e5447719d551c2f336485`
   with 17 `ENTANGLED_SIBLING` lines.
2. Checked the replay's own claim before trusting it: `git diff origin/main
   c893478232` showed content that is NOT BL-1340's own work — BL-1317's
   ticket yaml added then churned, a `swarmforge/roles/coordinator.prompt`
   deletion, other tickets' test files
   (`activePoolFreshnessAudit.test.js`, `bl1300HeadroomProofIsPinned.test.js`,
   `handoff_lib_test_runner.bb`), BL-1341-related backlog entries. This is
   the same BL-1343 attribution-walk defect already tracked (per the active
   watch memory on inflated `LAND_ESCALATE`/replay sibling lists) —
   `LAND_REPLAY` succeeding is not itself proof of a tip-pure result; I
   verified rather than trusted it.
3. Hand-built the tip-pure commit instead, from BL-1340's own pipeline
   commits (coder `9d298f070d`, cleaner `e5dc8849ea`, architect
   `de23548030`, hardener `e7b64b98a5`, documenter `b34779b23d` plus the
   separate untagged-subject BL-626 how-to cross-link commit `f278a2830b`,
   QA `1a2985b4fc`), each path checked out individually and diffed against
   `origin/main` to confirm no unrelated content.
4. One self-caught mistake during the build: checking out the whole
   `docs/index.md` off `swarmforge-QA` pulled in BL-1056's unrelated line
   too — refixed to `origin/main`'s copy plus only BL-1340's own insertion.
5. A second mistake, caught only after landing: that same `docs/index.md`
   edit was never actually staged into the commit that landed
   (`f973197a81`) despite the commit message claiming it was — re-running
   `test/docsStructureRealTree.test.js` against the landed tree caught the
   orphaned how-to page. Fixed in a follow-up commit (`bc2350c086`) and
   re-verified green before pushing.

## Verification (against the final landed tree)

- Compile: clean.
- `bb swarmforge/scripts/{promotion_gates_lib,acceptance_contract_gate_lib,
  acceptance_pointer_gate_lib,pre_qa_gate_gather_lib(x2),
  promotion_gates_cli}_test_runner.bb` — ALL PASS.
- Acceptance (`specs/features/BL-626-...feature`): 10/10, including all
  four new BL-1340 scenarios — against `origin/main`'s own
  `specs/pipeline/steps/index.js` (already had the require line
  registered; no change needed there).
- `test/docsStructureRealTree.test.js`: 5/5 green post-fix.

## Landed

- Tip-pure commit `f973197a81` pushed to `origin/main` (`2c8cf99b0f..f973197a81`).
- Follow-up fix commit `bc2350c086` pushed (`f973197a81..bc2350c086`) —
  the dropped `docs/index.md` link.
- `swarmforge-QA` merged up to `bc2350c086` at `9d54e189cd`. No conflicts.
- `abandoned_commits: [1a2985b4fc]` recorded on the ticket YAML — the
  originally QA-approved commit is superseded by this tip-pure replay.

By QA.
