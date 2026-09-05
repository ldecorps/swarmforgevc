# mutation-stamp: sha256=01604b981609bc61c61fe288d3f1afc302a111b061c2c9724ddc6dcf9fecd4aa
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T23:26:47.961612854Z","feature_name":"BL-1439 The deferred hardening gates of 2026-08-19 are run and discharged","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1439-the-deferred-hardening-gates-of-0819-are-run-and-discharged.feature","background_hash":"285cc0089e1951dba68abc96f4002d74c78ce029ff595423059d58c4f8d03469","implementation_hash":"unknown","scenarios":[{"index":0,"name":"discharging a row records the run and removes it from the outstanding debt","scenario_hash":"dd0703bc0db59ae37e6b8e9aca0d744941b8619a8d7cffe883f9350d47ebe2d6","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-05T23:26:47.961612854Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1439 The deferred hardening gates of 2026-08-19 are run and discharged

  On 2026-08-19 the hardener deferred five gates under host load and
  recorded each in backlog/hardening-debt-ledger.yaml (BL-942): Stryker
  mutation on three file sets (BL-620's front-desk trio, BL-955's
  negotiation relay pair plus the front-desk core, BL-954's bounce-revert
  trio), mutation on pipelineBoard.ts and a gherkin-mutation run on
  BL-956's feature that stalled with no verdict. The ledger's only verb is
  --defer: nothing can record that a deferred gate later ran, so a row can
  never leave. All five parcels closed. On 2026-09-05 the standing-red
  register (BL-1428) read those rows as reds whose owner is a closed
  ticket, and BL-1429 throttled intake to a cap of one, on ownership and,
  even once owned, on their seventeen-day age.

  This feature is that each of the five owed gates is run and its result
  recorded, that the ledger gains a discharge verb so a row that has been
  run leaves the outstanding debt with a pointer to its result, that the
  register no longer reports discharged rows, and that the throttle's
  standing-red signal clears once the last row is discharged. Scenarios
  01 and 02 run the ledger tooling against a fixture ledger; scenario 03
  reads the parcel's own committed ledger and register, a read-only
  live-tree read justified because they are the contract at this commit.
  A gate the host refuses (cooldown, load, a suite-wide red) is recorded
  as an attempt and its run belongs to the successor BL-1441.

  Background:
    Given a fixture ledger holding the five 2026-08-19 deferral rows

  # BL-1439 a-run-gate-is-discharged-with-its-result-01
  Scenario Outline: discharging a row records the run and removes it from the outstanding debt
    When the ledger is told that the <gate> gate for <parcel> ran with a result recorded at <evidence>
    Then the outstanding debt no longer holds that row
    And the ledger still holds the row, marked discharged with the date and the evidence pointer

    Examples:
      | parcel | gate             | evidence                                            |
      | BL-620 | mutation         | backlog/evidence/BL-1439-bl620-mutation.md          |
      | BL-956 | gherkin-mutation | backlog/evidence/BL-1439-bl956-gherkin-mutation.md  |

  # BL-1439 a-discharge-without-a-result-is-refused-02
  Scenario: a discharge that names no result is refused
    When the ledger is told that a gate ran without an evidence pointer
    Then the discharge is refused naming the missing evidence
    And the outstanding debt is unchanged

  # BL-1439 every-0819-row-is-discharged-or-owned-03
  # Amended 2026-09-06: at mint this required the live ledger to owe nothing, but three
  # of the five file sets were inside the mutation cooldown window (BL-1425 touched them
  # on 2026-09-05) and BL-954's set is stopped by the citation red (BL-1440); the runs
  # the host refuses belong to BL-1441, and this parcel must leave the debt owned.
  Scenario: every 2026-08-19 row in the parcel's own ledger is discharged or carries an attempt record, and each outstanding one is owned by the successor
    When the parcel's own hardening-debt ledger and standing-red register are read
    Then every row dated 2026-08-19 is discharged or records an attempt naming its blocker
    And every outstanding row has a register row naming BL-1441 and no discharged row has one
