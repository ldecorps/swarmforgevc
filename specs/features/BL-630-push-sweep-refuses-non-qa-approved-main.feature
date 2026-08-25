Feature: push-sweep refuses to publish a main tip that is not QA-approved

  # BL-630, BL-590 post-mortem 2026-07-25: handoffd's push-sweep! runs
  # `git push origin main` on every tick whenever local main is ahead of
  # origin/main, with no QA-ancestry check of any kind. Four un-QA'd commits
  # reached origin within 15-140 seconds of being made and could not be
  # undone. This is the publish-time gate: refuse to push a tip that is not
  # an ancestor of swarmforge-QA, except for the bookkeeping-only allowlist
  # (a tip whose non-QA commits touch only backlog/, docs/, swarmforge/).

  Background:
    Given handoffd's push-sweep tick is due

  # BL-630 non-qa-ancestor-tip-blocks-push-01
  Scenario: a main tip that is not a QA ancestor is not pushed
    Given local main is ahead of origin/main
    And the tip contains a commit that is not an ancestor of swarmforge-QA
    And that commit touches extension/src/
    When push-sweep! runs
    Then origin/main is not updated
    And the refusal is logged naming the offending commit sha

  # BL-630 refusal-distinct-from-other-outcomes-02
  Scenario: a QA-refusal is logged as its own outcome, not folded into other states
    Given a main tip was just refused for lacking QA ancestry
    When the handoffd log is inspected
    Then the refusal entry is distinguishable from up-to-date, diverged, and a failed push
    And the existing push-failure retry/backoff does not engage
    And the existing divergence alarm does not fire
    And no "check network/auth and push by hand" email is sent

  # BL-630 bookkeeping-only-tip-still-publishes-03
  Scenario: a non-QA tip touching only bookkeeping paths still publishes
    Given local main is ahead of origin/main
    And every non-QA-ancestor commit in the tip touches only backlog/, docs/, or swarmforge/
    When push-sweep! runs
    Then origin/main is updated to the local main tip

  # BL-630 qa-approved-tip-publishes-unchanged-04
  Scenario: a QA-approved tip publishes exactly as it does today
    Given local main is ahead of origin/main
    And the tip is an ancestor of swarmforge-QA
    When push-sweep! runs
    Then origin/main is updated to the local main tip
    And no added latency is introduced on this path

  # BL-630 behind-with-nothing-to-push-still-surfaces-05
  Scenario: a local main behind origin with nothing to push is not reported as silently up-to-date
    Given local main is behind origin/main
    And there is nothing ahead to push
    When push-sweep! runs
    Then the log distinguishes this behind-only state from a genuine up-to-date tip
