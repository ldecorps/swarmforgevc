Feature: BL-1398 The commit-guard fixture derives its guard set from the runner

  The commit-guard property test copies the real guards into a fixture
  repository from a list written by hand. When a guard is added to the
  runner the list goes stale, the chain fails inside the fixture, and the
  test turns red without any guard being wrong. This feature is that the
  fixture reads the runner for its guard set, that a guard the runner names
  but the tree lacks fails loud, and that the fixture never runs a narrower
  chain than production.

  Background:
    Given the commit-guard property fixture built from a runner seam

  # BL-1398 the-fixture-follows-the-runner-01
  Scenario: a guard added to the runner appears in the fixture without editing the test
    Given the runner seam names an additional guard that is present on the tree
    When the fixture template is built
    Then the fixture's copied guard set includes the additional guard
    And the guard chain in the fixture runs it

  # BL-1398 a-removed-guard-leaves-the-fixture-02
  Scenario: a guard removed from the runner is no longer copied and the test stays green
    Given the runner seam omits one guard it named before
    When the fixture template is built
    Then the fixture's copied guard set omits that guard
    And the property test passes

  # BL-1398 a-missing-guard-fails-loud-03
  Scenario: a guard the runner names but the tree lacks fails the test naming it
    Given the runner seam names a guard that is absent from the tree
    When the fixture template is built
    Then the test fails naming that guard

  # BL-1398 green-on-main-with-todays-runner-04
  Scenario: the property test is green against the real runner as it stands
    Given the real runner including the handler module graph guard
    When the property test runs
    Then it passes
