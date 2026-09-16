Feature: BL-1594 A fully reverted sibling edit on a shared path is content-clear

  BL-1481 made the land step refuse a shared path only when the tip still
  carries a line attributable to a blocking sibling. Its implementation
  clears a co-owner only on a :landed verdict and folds :vacuous in with
  :unlanded, although sibling-path-verdict documents a vacuous path as
  silent, not an obstacle. A bounced sibling whose only change on the path
  was removing lines can never reach :landed once those lines are restored,
  so on 2026-09-16 BL-1589's land was refused twice on
  backlog/standing-reds.tsv after the ruled restore, and it had to be
  hand-built. This feature is that a co-owner whose every own change on a
  shared path is reverted at the tip is content-clear for that path, that a
  partly reverted change and an unreadable read still block, and that a
  vacuous path is still never evidence that a sibling has landed.

  Background:
    Given a fixture repository under a scratch root with its own origin, a lander ticket and a bounced sibling that both touched one path

  # BL-1594 a-fully-reverted-sibling-edit-on-a-shared-path-is-content-clear-01
  Scenario Outline: a sibling's removal on the shared path blocks only while one of its removed lines is still absent
    Given the bounced sibling's commit removed lines from the shared path that origin/main has and a later lander commit restored <restored> of them and changed only the lander's own line
    When the land plan is computed for the lander
    Then the plan <outcome>

    Examples:
      | restored    | outcome                                                                                    |
      | every one   | is a replay that includes the shared path and names the sibling content-clear by reversion |
      | all but one | is a refusal naming the path, the sibling and its bounce                                   |

  # BL-1594 a-fully-reverted-sibling-edit-on-a-shared-path-is-content-clear-02
  Scenario Outline: the content check's verdict table
    Given the content check is asked about a blocking co-owner whose verdict on the shared path is <verdict>
    When the still-blocking co-owners of that path are computed
    Then the co-owner <outcome>

    Examples:
      | verdict    | outcome                                |
      | landed     | is cleared                             |
      | vacuous    | is cleared                             |
      | unlanded   | still blocks                           |
      | unreadable | still blocks, the check failing closed |

  # BL-1594 a-fully-reverted-sibling-edit-on-a-shared-path-is-content-clear-03
  Scenario: a vacuous path is still never evidence that a sibling has landed
    Given a sibling whose every attributed path is vacuous at the tip
    When the landed siblings are computed
    Then that sibling is reported as unlanded
