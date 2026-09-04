Feature: BL-1401 The BL-632 acceptance fixture derives its guard set from the runner

  The BL-632 acceptance handler copies the real commit guards into a scratch
  repository from a list written by hand. When a guard is added to the runner
  the list goes stale, the chain fails inside the fixture, and the feature it
  serves turns red without any guard being wrong. This feature is that the
  handler reads the runner for its guard set through the helper BL-1398
  shipped, that a guard the runner names but the tree lacks fails loud, and
  that the BL-632 feature is green against the runner as it stands.

  Background:
    Given the BL-632 acceptance fixture built from a runner seam

  # BL-1401 the-bl632-feature-is-green-against-todays-runner-01
  Scenario: the BL-632 feature passes every scenario against the real runner as it stands
    Given the real runner including the handler module graph guard
    When the BL-632 feature runs
    Then every scenario run passes

  # BL-1401 the-fixture-follows-the-runner-02
  Scenario: a guard added to the runner appears in the fixture without editing the handler
    Given the runner seam names an additional guard that is present on the tree
    When the acceptance fixture is built
    Then the fixture's copied guard set includes the additional guard
    And the guard chain in the fixture runs it

  # BL-1401 a-missing-guard-fails-loud-03
  Scenario: a guard the runner names but the tree lacks fails the build naming it
    Given the runner seam names a guard that is absent from the tree
    When the acceptance fixture is built
    Then the build fails naming that guard
