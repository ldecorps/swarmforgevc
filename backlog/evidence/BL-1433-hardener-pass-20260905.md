# BL-1433 — hardener pass, 2026-09-05

Ticket: BL-1433-a-branch-that-holds-the-landed-commit-is-not-behind
Commit reviewed: c97ac59dcc (cleaner) / 4b23057a07 (architect, NONE pass)

## Result: NONE — no defect found

This is the fix for the exact duplicate-note flood I flagged repeatedly
myself throughout this session (~30 near-identical "branch behind
<sha>: branch cannot fast-forward to landed commit - merge up" notes for
the same already-merged commit, over roughly 45 minutes) — reviewed with
the same care given to every other daemon-safety-machinery fix this
session (BL-1421, BL-1431, BL-1427).

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bb post_qa_branch_sweep_lib_test_runner.bb` | ALL PASS |
| `bb bl1433_branch_holds_landed_commit_property_runner.bb` | ALL PROPERTIES HOLD, 500/500, coverage `{:dirty-true 272, :dirty-false 228, :in-process-true 263, :in-process-false 237, :can-ff-true 259, :can-ff-false 241}` |
| `bb bl1433_supplier_git_facts_runner.bb` | `{"can-ff?":false,"contains-landed?":true,...}` — the exact ahead-only shape, confirmed against a real git fixture |
| `bb bl1421_one_standing_surfacing_property_runner.bb` (regression) | ALL PROPERTIES HOLD, 500/500, unaffected |
| `node specs/pipeline/cli.js specs/features/BL-1433-...feature` | 6/6 scenario runs, including scenario 04 (the direct 20-cycle replay of the exact 2026-09-05 flood pattern) |
| BL-668 / BL-1361 / BL-1421 features (regression) | 5/5, 6/6, 6/6 |
| `bash check_bb_scripts_load.sh --all` | 1 failure — the same already-known, already-owned (BL-1426) `post_qa_branch_sweep.bb` parse error confirmed by 3 prior roles this session and by my own BL-1427/BL-1428 hardening passes earlier |
| `bash check_standing_red_register.sh` | exit 0 |
| `grep -n contains-landed? handoffd.bb` | present at the live supplier call site, correct argument order (required_wiring) |
| `bl1433BranchHoldsLandedCommitSteps.js::registerSteps` present | yes (required_wiring) |

No leaked processes/fixture roots after any run (checked via `pgrep` and a
fresh-mtime `/tmp` scan before/after).

## BL-113 soft gherkin mutation (one Scenario Outline, 3 examples)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1433-a-branch-that-holds-the-landed-commit-is-not-behind.feature
<fresh mktemp under ./tmp> specs/pipeline/steps/index.js soft` (all 4
positionals explicit, workdir removed after). Result: **3 mutants, 3
killed, 0 survived** (the `<shape>` example cells, single-letter case
flips) — clean.

## Read `decide-role` and `sweep-one-role` directly

Confirmed the precedence order by hand:
`missing-ref → already-settled → unknown-containment(nil) →
holds-landed(true) → in-process → dirty → can-ff → divergent` — exactly
matching all three declared invariants structurally, not merely by test
coverage. Confirmed `sweep-one-role`'s `:holds-landed` and `:skip
:unknown-containment` branches both return `[state nil]` (no state
change, no tell, no wake) with only a log line — the correct shape for
"never surfaced, never told, never woken."

## Noted, not chased: architect's own live observation about
   `:unknown-containment` reachability

The architect's own evidence correctly observes that the live daemon's
`git-is-ancestor?` primitive always collapses to a plain boolean (a git
error reads as `false`, never `nil`), so `:unknown-containment` is
exercised today only by the pure unit/property tests' synthetic `nil`
input, never by live wiring. Independently confirmed by reading
`git-is-ancestor?`'s definition (`zero? exit-code`) — this is a
pre-existing characteristic of a SHARED primitive `can-ff?` already had,
not something this ticket introduces or regresses, and redesigning that
primitive to distinguish "definitely not" from "could not determine" is
larger than this ticket's own scope. Agreeing with the architect's own
disposition: recorded, not a defect, not chased here.

## Design/CRAP/DRY

No production code changed by this pass. Babashka has no mutation/CRAP/DRY
tooling wired (BL-472 deferred, cleaner already recorded this fallback);
gated by the unit/property/acceptance suites above plus the clean BL-113
gherkin-mutation pass.

## Verdict

No defect. Forwarding unchanged to documenter.
