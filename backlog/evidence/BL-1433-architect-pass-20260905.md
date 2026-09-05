# BL-1433 — architect pass, 2026-09-05

Ticket: BL-1433-a-branch-that-holds-the-landed-commit-is-not-behind
Role: architect
Commit reviewed: c97ac59dcc (cleaner)

## Result: NONE — no architecture, invariant, or correctness defect found

This is the fix for the repeating merge-up notification pattern I flagged
live earlier today (10+ identical "branch behind" notes to my own inbox,
~50s apart) and which the specifier minted directly from that report.

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to the new step handler
  (`specs/pipeline/steps/bl1433BranchHoldsLandedCommitSteps.js`) and
  full-repo: `Dependency-rule gate PASSED: no forbidden edges.` in both.
  The change is Babashka daemon/lib code
  (`post_qa_branch_sweep_lib.bb`, `handoffd.bb`) plus test/step files — no
  webview, no VS Code API, no secrets, no browser storage.
- **Co-change report**: expected sibling family coupling
  (`post_qa_branch_sweep*`, `handoffd.bb`) — nothing new or suspicious.

## Invariants Review (BL-633/654) — traced by hand and re-run live

1. **A HEAD containing the landed commit is never told, whatever else the
   worktree holds.** Read `decide-role`: `contains-landed?` is checked
   right after `already-settled` and BEFORE `in-process?`/`dirty?` —
   structurally guarantees invariant 1 regardless of worktree state.
   Confirmed via the property runner (P1, 500 runs, non-vacuous: removing
   the branch fails every generated case) and via my own independent run
   of all 3 examples in acceptance scenario 01 (clean/dirty/in-process
   worktree, all told nothing).
2. **`divergent-branch` means exactly HEAD lacks the landed commit and
   cannot fast-forward; BL-1421's standing surfacing holds unchanged for
   it.** Confirmed: `post_qa_branch_sweep_lib_test_runner.bb` (17
   pre-existing fixtures + 9 new assertions) all pass, and the sibling
   `bl1421_one_standing_surfacing_property_runner.bb` re-run by me (500
   runs) is unaffected — BL-1421's own contract is untouched for the
   genuinely-divergent case, only reachable now for its correct definition.
3. **An unanswerable containment fact never produces a note.** The pure
   `decide-role` branch (`nil? contains-landed?` → skip, logged) is
   correctly implemented and independently property-tested (P3, non-
   vacuous). One observation, not a defect: the live daemon supplier
   (`(and head landed (git-is-ancestor? wt landed head))`) can in practice
   never actually produce `nil` once `head`/`landed` are non-nil, since
   `git-is-ancestor?` always resolves to a plain boolean
   (`zero? exit-code`) — a genuine git-command error collapses to `false`,
   not `nil`, identically to the PRE-EXISTING `can-ff?` primitive's own
   shape (confirmed by reading `git-is-ancestor?`'s definition). This means
   the `:unknown-containment` skip is exercised today only by the pure
   unit/property tests (synthetic `nil` input), never by the live wiring.
   This is not a regression BL-1433 introduces — it inherits an existing,
   accepted sharp edge in a shared primitive (`git-is-ancestor?`) that
   `can-ff?` already has and nobody has flagged. Redesigning that shared
   primitive to distinguish "definitely not an ancestor" from "could not
   determine" is a larger change than this ticket's own scope (one fact,
   one branch in `decide-role`) — noting it here rather than treating it
   as a blocking defect, since it neither regresses existing behavior nor
   violates anything this ticket specifically promised.

## Independently re-verified the substance

- `bb post_qa_branch_sweep_lib_test_runner.bb` → `ALL PASS`
- `bb bl1433_branch_holds_landed_commit_property_runner.bb` → 500 runs
  each, `ALL PROPERTIES HOLD`, wide coverage on dirty/in-process/can-ff
  combinations
- `bb bl1433_supplier_git_facts_runner.bb` → real git fixture (bare
  origin, role branch = origin/main + 1 own commit) reports
  `can-ff?: false, contains-landed?: true` — correct, and confirms the
  argument-order bug the coder's own evidence says this exact fixture
  caught during authoring (an early draft had the two ancestor-check
  argument orders swapped) is fixed.
- `bb bl1421_one_standing_surfacing_property_runner.bb` (regression) →
  500 runs, `ALL PROPERTIES HOLD`, unaffected by the fixture updates.

## Acceptance wiring — driven end-to-end myself

Feature declares 4 scenarios / 6 scenario runs. Independently drove
`bl1433BranchHoldsLandedCommitSteps.js::registerSteps` against all 6 —
all passed, including scenario 03 (the real git-fixture supplier proof)
and scenario 04 (the exact 20-cycle replay of the 2026-09-05 flood
pattern, producing zero notes for the ahead-only role — the direct
regression test for the bug I personally observed and flagged).
`registerSteps` export present per the ticket's `required_wiring` anchor
(BL-1371); `grep -n contains-landed? handoffd.bb` matches at the live
supplier call site (the other anchor).

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to hardener.
