# mutation-stamp: sha256=1567cbf41d21ac7bffca4f7a3b5a28eb58ab8afbfe25a0ab6ae29ca01c899c42
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T08:50:20.195773423Z","feature_name":"A stamp-off invariant watches what the run writes, not what the ledger currently says","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1356-stamp-off-invariant-watches-the-run-not-the-row.feature","background_hash":"8ab52d8b932ec842f4a57fc2dbb47aa67101f92683d517d5a598403ba7dae50c","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a row that legitimately advanced is not a violation","scenario_hash":"6aeaf0d2b1c6c5576703155c7a54ca06d9ef3f50b9efbf8ba099bfadab480437","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-03T08:50:20.195773423Z"}]}
# acceptance-mutation-manifest-end

Feature: A stamp-off invariant watches what the run writes, not what the ledger currently says
  BL-654 stamp-off property tests defend a real invariant - a green suite must
  never write a decision into backlog/hotfix-ledger.yaml. They encode it by
  pinning the CURRENT state literal of their own row: bl1323 asserts
  /state: stamp-open/, bl1116 and bl1117 assert /state: pending/.

  That row advancing is the workflow, not a violation. So each such test is
  guaranteed to go red as its row moves on - and because the property lane's
  commit guard refuses every commit touching extension/src/ or a property file
  repo-wide on any non-allowlisted red, the whole swarm's commit gate jams until
  somebody adds a standing-allowlist row. Five stamp-off files already carry one
  for exactly this reason; the sixth jammed four unrelated commits on 2026-09-02.

  The invariant is intact. The assertion is the defect. It must fail when, and
  only when, the run that executes it changed the row.

  Background:
    Given a hotfix ledger row that a stamp-off invariant watches

  # BL-1356 stamp-off-watches-the-run-01
  Scenario Outline: a row that legitimately advanced is not a violation
    Given the row's state is "<state>"
    When the property suite runs without writing to the ledger
    Then the stamp-off invariant passes

    Examples:
      | state          |
      | stamp-open     |
      | pending        |
      | awaiting-human |

  # BL-1356 stamp-off-watches-the-run-02
  Scenario: a decision written during the run is still a violation
    Given the row's state is "stamp-open"
    When the property suite run writes "certified" into the row's state
    Then the stamp-off invariant fails

  # BL-1356 stamp-off-watches-the-run-03
  Scenario: a human_decision written during the run is still a violation
    Given the row's human_decision is null
    When the property suite run writes a human_decision into the row
    Then the stamp-off invariant fails

  # BL-1356 stamp-off-watches-the-run-04
  Scenario: no stamp-off file needs a standing-allowlist row to keep the gate green
    Given every stamp-off property file in the property lane
    When the lane runs against a ledger whose watched rows have all advanced
    Then no stamp-off file is reported as a failing suite
    And the standing allowlist carries no stamp-off entry
