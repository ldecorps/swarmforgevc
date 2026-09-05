# mutation-stamp: sha256=8ab187f9a16fa63696c5ac458ae7ddb5b3ee0e3394f522f54879c184185c8b8e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T15:26:57.058121825Z","feature_name":"Widening the pilot land-gate deps contract cannot silently strand its test stubs","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1229-pilot-gate-deps-contract-cannot-silently-outgrow-its-test-stubs.feature","background_hash":"78b4032fad8920783057e6e510c5ba08fafe713a4d3377c5ab0d06d8b06fc180","implementation_hash":"unknown","scenarios":[{"index":4,"name":"A stub supplying the whole contract drives the gate to a real verdict","scenario_hash":"e8f1bcdb0cb090820f0017c62acb5ee933afd29ffee0b23541e68ad495fb3ef8","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-05T15:26:57.058121825Z"}]}
# acceptance-mutation-manifest-end

Feature: Widening the pilot land-gate deps contract cannot silently strand its test stubs

  landPilotedTicket takes its collaborators as a plain deps object. Because the
  test files are JavaScript, a stub that omits a member type-checks nowhere and
  fails only when the production code reaches the missing key at runtime — as
  "deps.<name> is not a function", inside whichever assertion happened to get
  there first.

  BL-757 added checkOrphanedAuthoredDocs to that contract and landed. Ten test
  files build their own deps stub by hand and none was updated, so on
  2026-08-28 twenty-two assertions across those files were crashing rather than
  asserting. Nobody had to be careless for that: nothing anywhere connects
  widening the contract to the stubs that implement it.

  The fix is that the connection exists. A stub that does not satisfy the
  contract is refused in one place, at one cost, however many files build one.
  A missing member is never quietly filled in with a default — that trades a
  loud crash for a test that passes while exercising nothing.

  Background:
    Given the pilot land-gate deps contract

  # BL-1229 pilot-gate-deps-contract-stubs-01
  Scenario: Every test-built deps stub satisfies the contract
    When the pilot land-gate test files run under their own runner
    Then no assertion fails with "is not a function" for a deps member
    And every assertion that was crashing on a missing deps member now reports a real verdict

  # BL-1229 pilot-gate-deps-contract-stubs-02
  Scenario: Widening the contract costs one failure, not one per test file
    Given a new member is added to the pilot land-gate deps contract
    And no test stub supplies it
    When the pilot land-gate test files run under their own runner
    Then the omission is reported once
    And the report names the missing member

  # BL-1229 pilot-gate-deps-contract-stubs-03
  Scenario: A missing deps member is never silently defaulted
    Given a test builds a deps stub omitting "checkOrphanedAuthoredDocs"
    When the pilot land-gate runs against that stub
    Then the run fails
    And the run does not report a land verdict

  # BL-1229 pilot-gate-deps-contract-stubs-05
  Scenario: The production contract is not weakened to accommodate the stubs
    When the pilot land-gate deps contract is inspected
    Then "checkOrphanedAuthoredDocs" is still a required member
    And the land path calls it without guarding on its presence

  # BL-1229 pilot-gate-deps-contract-stubs-04
  Scenario Outline: A stub supplying the whole contract drives the gate to a real verdict
    Given a test builds a complete deps stub whose orphan-docs check returns <orphan outcome>
    When the pilot land-gate runs against that stub
    Then the gate reports "<verdict>"

    Examples:
      | orphan outcome     | verdict |
      | no orphaned docs   | land    |
      | an orphaned doc    | refuse  |
