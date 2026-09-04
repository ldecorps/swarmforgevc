# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-04T15:31:34.256534175Z","feature_name":"BL-1389 A path an unlanded sibling owns alone never rides another ticket's land","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1389-a-path-an-unlanded-sibling-owns-alone-never-rides-another-tickets-land.feature","background_hash":"e54f3ed2de97dd49769ae648b7dcd1bb3e1ea083df608783a9b72e8ac1c35a86","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1389 A path an unlanded sibling owns alone never rides another ticket's land

  The tip-pure replay keeps every delivered path except those it can
  positively attribute to an unlanded sibling alone. Whether a sibling is
  unlanded is decided once per ticket, and a sibling with one attributed
  path already on origin/main can read landed while its code is not. Then
  every path it owns alone is kept, and the replay ships that code under the
  landing ticket's approval. This feature is that such a path is excluded
  whatever the sibling's approval reads, that landed means every attributed
  path, and that the report names the paths and the verdicts.

  Background:
    Given origin/main holds sibling "BL-9002"'s feature file
    And the tip carries "BL-9002"'s handler and a source file under commits tagged "BL-9002"
    And the tip carries landing ticket "BL-9001"'s own files

  # BL-1389 an-exclusively-owned-path-is-excluded-01
  Scenario: a path owned by an unlanded sibling alone is excluded from the replay
    When the land step replays "BL-9001"
    Then "BL-9002" reads unlanded
    And the replay excludes "BL-9002"'s handler and source file
    And the report carries EXCLUDED_SIBLING_PATH for each naming "BL-9002"
    And "BL-9001"'s own files are in the replay

  # BL-1389 approval-does-not-make-it-ride-02
  Scenario: an approved but unlanded sibling's exclusive path still does not ride
    Given "BL-9002" is approved
    When the land step replays "BL-9001"
    Then the replay excludes "BL-9002"'s handler and source file

  # BL-1389 a-shared-path-still-carries-an-approved-passenger-03
  Scenario: a path both tickets own still carries an approved sibling as a passenger
    Given "BL-9002" is approved
    And the tip carries a path both "BL-9001" and "BL-9002" changed
    When the land step replays "BL-9001"
    Then the shared path is in the replay
    And the report names "BL-9002" as a passenger
    And the tree guards ran against the replayed tree

  # BL-1389 landed-means-every-attributed-path-04
  Scenario: a sibling reads landed only when every attributed path is already on origin/main
    Given origin/main also holds "BL-9002"'s handler and source file with its own lines
    When the land step replays "BL-9001"
    Then "BL-9002" reads landed
    And the LANDED_SIBLING line for "BL-9002" names the path that decided it

  # BL-1389 the-report-names-what-a-human-had-to-diff-05
  Scenario: the replay report is enough to check the verdict without diffing the tip
    When the land step replays "BL-9001"
    Then every excluded path is named with the sibling it was credited to
    And every landed sibling is named with its deciding path
