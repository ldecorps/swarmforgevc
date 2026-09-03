# mutation-stamp: sha256=a2c6a3b4d9b45a6fb2cacf128550cee677e9fa5b2355e640287415c059fcf73a
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T06:56:16.002034618Z","feature_name":"A shared path does not hide a landed sibling","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1354-a-shared-path-does-not-hide-a-landed-sibling.feature","background_hash":"7d11255fc5c4a006bbefbd80f2672e3f85e4b0c72106f5dc6a4de7c1ce00b476","implementation_hash":"unknown","scenarios":[{"index":2,"name":"an unanswered attribution still fails closed","scenario_hash":"cdfa7be415cb37e9ac56d1e9ceb9321516d90a0b2caf3c715410c7c44e34a8bc","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-03T06:56:16.002034618Z"}]}
# acceptance-mutation-manifest-end

Feature: A shared path does not hide a landed sibling

  BL-1332 closed the write side of shared-path entanglement: a replayed path
  is taken whole, so the land step now refuses rather than silently carrying a
  sibling's lines into main. The read side is still wrong. `sibling-landed?`
  answers "is this sibling's attributed content already on origin/main" by
  comparing each attributed path's WHOLE blob. On a file several tickets touch,
  that comparison is decided by every co-owner at once, so a sibling whose own
  lines are all landed still reads unlanded whenever any co-owner's are not.

  Observed 2026-09-03 on BL-1332's own land: six siblings were named as
  unlanded and all six are in backlog/done/, every one of them touching
  docs/reference/Specification.MD. QA hand-built the commit instead and has
  stopped trusting the tool's verdict.

  The fix must not reach for the obvious relaxation. BL-1272's invariant 1
  stands: landed is a positive finding, never an inference from silence.

  Background:
    Given the land step is classifying the siblings of a commit

  # BL-1354 a-shared-path-does-not-hide-a-landed-sibling-01
  Scenario: a landed sibling sharing a file with an unlanded one still reads landed
    Given a shared path carries lines attributed to two siblings
    And the first sibling's own lines are all present on origin/main
    And the second sibling's own lines are absent from origin/main
    When the siblings are classified
    Then the first sibling is reported landed
    And the second sibling is reported unlanded

  # BL-1354 a-shared-path-does-not-hide-a-landed-sibling-02
  Scenario: a sibling whose own lines are absent is never reported landed
    Given a shared path carries lines attributed to two siblings
    And neither sibling's own lines are present on origin/main
    When the siblings are classified
    Then both siblings are reported unlanded

  # BL-1354 a-shared-path-does-not-hide-a-landed-sibling-03
  Scenario Outline: an unanswered attribution still fails closed
    Given the attribution for a sibling is <attribution>
    When the siblings are classified
    Then that sibling is reported unlanded

    Examples:
      | attribution         |
      | a walk that failed  |
      | an empty path set   |
      | an unreadable diff  |
