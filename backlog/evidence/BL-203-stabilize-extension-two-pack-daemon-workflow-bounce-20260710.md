# BL-203 QA bounce — 2026-07-10

1. **Failing command**:
   ```
   specs/pipeline/scripts/run_acceptance.sh specs/features/BL-203-stabilize-extension-two-pack-daemon-workflow.feature
   ```

2. **Commit hash tested**: `23b751f48512dc7226498b5679577e7c4339d900`
   (QA worktree, documenter handoff `df570d8423` merged up)

3. **First error excerpt**:
   ```
   TAP version 13
   # Subtest: daemon is up after extension launch
   not ok 1 - daemon is up after extension launch
     ---
     duration_ms: 0.693339
     type: 'test'
     location: '.../specs/pipeline/generated/extension-two-pack-daemon-workflow-is-demonstrably-stable.generated.test.js:10:1'
     failureType: 'testCodeFailure'
     error: 'Scenario "daemon is up after extension launch": no step handler matched
       "Given the stabilize-two-pack profile and daemon-on launch config exist"'
     code: 'ERR_TEST_FAILURE'
   # Subtest: coordinator promotes BL-203
   not ok 2 - coordinator promotes BL-203
     error: 'Scenario "coordinator promotes BL-203": no step handler matched
       "Given the stabilize-two-pack profile and daemon-on launch config exist"'
   # Subtest: daemon routes the parcel across the swarm
   not ok 3 - ...
   # Subtest: graceful stop is clean and idempotent
   not ok 4 - ...
   1..4
   # pass 0
   # fail 4
   ```
   All 4 scenarios fail identically: zero step handlers match any Given/When/Then
   line in the feature file.

4. **Failure class**: `acceptance`

5. **Expected vs observed**: Expected `run_acceptance.sh` (QA's mandated final
   gate per `roles/QA.prompt`, BL-112) to execute BL-203's scenarios against
   real step handlers and pass/fail on actual behavior. Observed 0/4 scenarios
   have any matching step handler at all — `specs/pipeline/steps/index.js`
   registers only `backlogSteps.js`. BL-112's own scope note pre-approves a
   step-handler surface allowlist of "tmux socket discovery, .swarmforge state
   parsing, handoff protocol, backlog parsing, grid layout logic" — BL-203's
   scenarios live squarely in that allowlist (ac-01 tmux/daemon-state, ac-02
   backlog paused→active, ac-03 handoff-protocol routing, ac-04 tmux/daemon
   teardown), but no daemon/tmux/handoff-protocol step module was added and
   `index.js` was never extended to register one. The delivered work
   (`smoke_check_stabilize_two_pack.sh`, `verify_daemon_lifecycle.sh`, the
   runbook) verifies static wiring and live-daemon health via plain bash, which
   is real and passes on its own, but it substitutes for — rather than
   implements — the ticket's own declared Gherkin acceptance criteria, so the
   mandated executable acceptance gate cannot run at all for this ticket.

Note: unit suite (2001/2001, extension) and the four new/targeted shell test
suites (smoke_check, portable_stat_lib, daemon_heartbeat_portable_stat) all
pass cleanly — this bounce is scoped to the acceptance-pipeline gate only.
