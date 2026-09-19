Feature: BL-1649 The claim-idle ladder reads a per-role timeout, logs every reclaim, and never counts a dead agent as idle

  The claim-without-progress ladder judges every role by one flat twenty
  minute HEAD clock with a single built-in exception for the hardender,
  counts a role as idle whenever its pane is not busy, and logs nothing per
  increment. On 2026-09-19 QA's eighty-minute land crossed the window, its
  agent process died, six reclaims accrued in minutes, and the daemon
  bounced QA on top of its own respawn, four reclaims short of halting the
  swarm. After this parcel the window per role comes from swarmforge.conf
  with the built-in entries as fallback, an absent or freshly respawned
  agent is never idle, and every increment leaves one explanatory log line.

  Background:
    Given a fixture root with a daemon-shaped .swarmforge, a swarmforge.conf, and a QA claim sidecar whose commit HEAD has not moved past

  # BL-1649 a-conf-window-keeps-a-long-land-unarmed-01
  Scenario: a per-role window from the conf keeps a legitimate long land below the ladder
    Given swarmforge.conf sets claim_idle_timeout_role_minutes QA 90
    And a QA claim 45 minutes old with no busy footer and a clean worktree
    When the claim-idle signal is evaluated for QA
    Then the outcome is not-yet-overdue

  # BL-1649 no-entry-means-the-base-window-02
  Scenario: a role with no conf entry and no built-in entry keeps the base window
    Given swarmforge.conf sets no claim_idle_timeout_role_minutes line
    And a coder claim 25 minutes old with no busy footer and a clean worktree
    When the claim-idle signal is evaluated for coder
    Then the outcome is claimed-idle

  # BL-1649 the-built-in-entry-is-the-fallback-03
  Scenario: the hardender's built-in ninety minutes still applies with no conf entry
    Given swarmforge.conf sets no claim_idle_timeout_role_minutes line
    And a hardender claim 45 minutes old with no busy footer and a clean worktree
    When the claim-idle signal is evaluated for hardender
    Then the outcome is not-yet-overdue

  # BL-1649 an-unusable-value-is-dropped-never-tightened-04
  Scenario Outline: an unusable conf value is dropped and the role keeps its built-in or base window
    Given swarmforge.conf sets claim_idle_timeout_role_minutes <role> <value>
    And a <role> claim 45 minutes old with no busy footer and a clean worktree
    When the claim-idle signal is evaluated for <role>
    Then the outcome is <outcome>

    Examples:
      | role      | value | outcome         |
      | QA        | 0     | claimed-idle    |
      | QA        | -5    | claimed-idle    |
      | hardender | x     | not-yet-overdue |

  # BL-1649 an-absent-or-freshly-respawned-agent-is-not-idle-05
  Scenario Outline: a role whose agent process is absent or was respawned within the cooldown is never counted idle
    Given swarmforge.conf sets no claim_idle_timeout_role_minutes line
    And a QA claim 45 minutes old with no busy footer and a clean worktree
    And the QA agent <state>
    When the claim-idle signal is evaluated for QA
    Then the outcome is paused-agent-absent
    And the reclaim count is unchanged

    Examples:
      | state                                              |
      | process is absent under a live pane                |
      | was respawned by the chase sweep 60 seconds ago    |

  # BL-1649 every-increment-leaves-one-log-line-06
  Scenario: one daemon sweep that increments writes one log line with the readings it decided on
    Given swarmforge.conf sets no claim_idle_timeout_role_minutes line
    And a QA claim 25 minutes old with no busy footer, a clean worktree and a present agent
    When the daemon's claim-progress sweep runs once on the fixture root
    Then the reclaim count becomes 1
    And the daemon log carries exactly one claim-idle-reclaim line naming QA, the count 1, the busy, dirty, recent and present readings, and the elapsed and timeout minutes
