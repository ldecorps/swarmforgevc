# BL-998 QA approval, 2026-08-21

**Reviewer**: QA. **Reviewed at**: documenter tip `3c60798cb0`, merged into
QA at `dabeb1987`. Ancestry confirmed: coder D1 refix `0153d2257`, cleaner
DRY hoist `19e0ad093f`, architect review `a55c1b68d`, hardener pass
`a673b2e94`, all ancestors of the QA tip.

## Verification order (Article 4.4, qa_e2e_procedure)

**Judgement call (per the ticket's own `approval_context`)**: step 2 asks to
seed a synthetic parcel into a real role's live `inbox/new/` and run the
unfixed test against the live tree to demonstrate the theft. This swarm is
actively live right now (coder/cleaner/architect all busy this session,
confirmed by `skip-busy` deliveries on my own handoffs today) - seeding a
synthetic parcel into a real role's inbox, even synthetic, risks colliding
with genuine in-flight work if anything about the demonstration goes
sideways. Took the ticket's explicitly offered alternative: reproduced the
mechanism in an isolated clone instead of the live tree.

1. **Snapshot**: `shasum` of every file under `.swarmforge/handoffs/` in my
   own QA worktree, before running anything (788 files).
2. **Mechanism reproduced safely, in a throwaway clone** (never the live
   tree): cloned this worktree to a scratch dir, checked out the pre-fix
   commit (`f1ecc141a`, before any BL-998 work), seeded a fake
   `.swarmforge/roles.tsv` naming role QA at the clone's own root (standing
   in for "the real repo" the bug would escape into), then invoked the
   clone's own real (unfixed) `ready_for_next.sh` wrapper from an unrelated
   `mktemp` fixture directory with no `.swarmforge/` of its own. Result: the
   wrapper's own log line read
   `backlog_depth_lib: no swarm-identity for .../bl998-clone/swarmforge/scripts/../.. -
   falling back to...` and printed `NO_TASK` - proving it resolved and
   queried the CLONE's real state, not the fixture, exactly the escape the
   ticket describes. Clone deleted after. This corroborates, independently,
   both the hardener's original BL-983 finding that spawned this ticket and
   the severity rationale in the ticket itself.
3. **At the parcel commit**, ran all 6 affected/control shell suites
   individually (batching was unreliable under today's load, matching
   architect's/hardener's own notes): `test_compliance_battery_cli.sh` 8/8,
   `test_dispatch_lib_receive_mode.sh` 5/5,
   `test_handoff_state_dir_worktree_root.sh` 7/7,
   `test_reference_freshness_guard.sh` 4/4, `test_idle_clear_respawn.sh`
   4/4, `test_sidecar_tolerant_completion.sh` 5/5 - all exit 0, counts match
   coder's own. Re-snapshotted `.swarmforge/handoffs/` after: **byte-
   identical to the before-snapshot** (`diff` empty across all 788 files) -
   invariant 1 independently confirmed, not merely trusted from the
   coder's own (more thorough, 8-worktree) sweep.
4. **The tests still mean something**: for `test_idle_clear_respawn.sh`,
   flipped the fixture's own `onrole` flag from `on` to `off` (breaking the
   guarded idle-clear-respawn behavior inside the fixture) - the test
   correctly went red (`FAIL: 01: expected a respawn-pane call for the
   enabled role`). Restored; confirmed green again (`git diff` empty on the
   file).
5. **Guard non-vacuity, my own throwaway**: added a shell file that
   genuinely EXECUTES `bb "$DONE_TASK"` (not merely mentions it) with no
   `install_scripts` - guard failed and named it exactly
   (`test_bl998_qa_throwaway_offender.sh:$DONE_TASK -> done_with_current_task.bb`).
   An earlier attempt that only echoed the command as a string was correctly
   ignored by the guard - confirms it detects real invocation, not mention
   (the exact "counting mentions, not call sites" trap this ticket's own
   constraints call out). Removed after; guard passes clean again.
6. **`test_handoff_state_dir_worktree_root.sh`'s safe-leaf calls preserved**:
   grepped the current file (original line numbers 86/94 shifted by the
   43-line diff) - `READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"` is
   still called directly (`bb "$READY_TASK"`) with an explicit `cd`/role
   context, the correct safe shape, NOT converted. `DONE_TASK` now points at
   the fixture worktree's own copy - the actual fix.
7. Acceptance: `specs/features/BL-998-a-shell-test-never-dispatches-into-the-real-repo.feature`
   - **5/5 PASS**. `required_wiring` confirmed: `bl998ShellFixtureDispatchIsolationSteps`
   is registered in `specs/pipeline/steps/index.js:558`.
8. **Revert-and-restore proof, my own**: commented out
   `test_idle_clear_respawn.sh`'s `install_scripts "$ONROLE_WT"` call and
   pointed `ONROLE_DONE_TASK` back at the real scripts dir - the guard
   failed, naming exactly that file
   (`test_idle_clear_respawn.sh:$ONROLE_DONE_TASK -> done_with_current_task.bb`).
   Restored (`git diff` empty); guard passes clean again.
9. `bl998_guard_membership_property_runner.bb`: **96/96 PASS** (invariant 2,
   the closure logic, generator reach over all 12 kind×anchor×executed
   combinations).

## Not re-run: the full `npm test` extension suite

This parcel's diff (`git diff --stat 89ae8bc69..dabeb1987 -- extension/`)
is **empty** - zero TypeScript touched, 5 shell/`.bb` files plus one shared
lib under `swarmforge/scripts/test/` only. The coder already ran the full
suite themselves this parcel (457/457 files, 8070/8070 tests, recorded
`"result":"pass"` in `.test-durations.jsonl`) - a fourth ~15-25 minute
full-suite run today, on a parcel that cannot touch anything the suite
exercises, is not proportionate. Compile is a no-op here (no `.ts` changed).

## Scope / design

Architecture (transitive closure over sibling `process/exec` invocations,
`load-file` correctly excluded from the edge set) already independently
reviewed by architect and hardener, both of whom read the closure logic
directly rather than trusting the result; I did the same via steps 4/5/8
above rather than re-deriving the whole implementation from scratch.

## Outcome

**APPROVED.** Every qa_e2e_procedure item is satisfied, several with my own
independent (not merely re-read) proof. Landing on `main`.
