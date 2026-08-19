# BL-953 hardener pass — 2026-08-19

## Reviewed commit
`acc8e7fae5` ("BL-953: architect pass - clean, forwarding to hardener"),
merged into hardener as this parcel. No bounce.

## Merge note (own worktree hygiene)
This merge hit both hazards this session's earlier passes have now
established discipline for: an `index.js` conflict (my side had
`bl952BouncedParcelNeverApprovedSteps` registered TWICE — once cleanly,
once inside the conflict block, a leftover artifact from an earlier
merge — resolved by keeping the single clean registration and adding
`bl953TaskCommitCoherenceSteps` in its place) and an add/add conflict on
my own `test_is_qa_ancestor_yaml_store.sh` (confirmed byte-identical
between both sides via `diff` before resolving — a false conflict from
two independent lineages carrying the same already-landed content, not a
real divergence). Independently re-verified after resolving: `is_qa_-
ancestor.sh` and `push_sweep_lib.bb` (this session's own prior
revert-of-a-revert casualties) both still carry their bounce-store logic
intact — no repeat of that hazard here.

## Why this pass got extra scrutiny
This ticket adds a fourth send-time guard to `swarm_handoff.bb`'s
`validate` — the same function BL-950 and BL-951 already hardened
components of this session. Read the core gate logic in full rather than
relying on suite re-runs alone.

## Scope, precisely
`git show --stat 8f5b530f8` (coder) + `2aa0df2b6a` (cleaner's portability
fix) — 6 files total: the new step handler, `index.js`'s registry line,
`swarm_handoff.bb`'s wiring, the new pure gate lib, and its two test
runners. No `extension/` file touched. Stryker/CRAP/DRY inapplicable.

## Checks run (complete inventory, not first-failure-stop)

1. **Independent re-run of both bb suites**:
   - `bb swarmforge/scripts/test/task_commit_coherence_gate_lib_test_runner.bb`
     — ALL PASS.
   - `bb swarmforge/scripts/test/bl953_task_commit_coherence_property_runner.bb`
     — ok, 2000 runs, 583 refusing shapes, 387 constructed collisions
     (matching the architect's report).
2. **Acceptance, independently re-run** (backgrounded given host load
   15–28 on 4 cores): 8/8 PASS, matching the architect's 8/8.
3. **Own full read of the core decision logic**:
   - `task_commit_coherence_gate_lib.bb`'s `blocked?` requires all three:
     a resolved task ticket id, at least one commit ticket id, and exact
     non-membership between them — matches invariant 1 (fail-open
     absolute) and invariant 2 (exact equality) precisely.
   - Independently verified invariant 2's exact-match claim by reading
     `pipeline_stage_lib.bb`'s `ticket-id-pattern` regex directly: the
     `\b(prefix)-?(\d+)\b` shape's greedy `\d+` plus trailing `\b` means
     "BL-93" can never match inside "BL-935" — the greedy digit group
     consumes all contiguous digits before the boundary check runs, so
     there is no partial-digit-string collision risk. Confirmed by
     reading the regex mechanics, not just trusting the test suite.
   - Traced the wiring in `swarm_handoff.bb` (lines 305-319): the
     coherence check only computes when `type = git_handoff` AND a
     canonical commit resolved AND task-name is non-blank; on a failed
     `git log` (unreadable commit) it prints a loud warning and returns
     nil (fail-open); on success it defers entirely to `blocked?`'s pure
     verdict. No path that could silently swallow a positive
     contradiction.
4. **Required wiring**: `bl953TaskCommitCoherenceSteps` confirmed
   registered in `specs/pipeline/steps/index.js` (grepped directly,
   post-merge-conflict-resolution).
5. **Leak/process check**: `git status --short` clean; no stray tmux
   servers.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling. Both bb suites
and the acceptance feature reconfirmed green under my own hand.
Independently traced the exact-match regex mechanics and the send-path
wiring rather than trusting the architect's report alone, given this
gate's position in the same critical send path BL-950 and BL-951 already
hardened this session. Corrected a duplicate-registration artifact and a
false add/add conflict during the merge itself, with no repeat of the
earlier revert-of-a-revert hazard.

Forwarding to documenter.

By hardener.
