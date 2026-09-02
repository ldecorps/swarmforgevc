Feature: An unanswered-question escalation whose transport cannot deliver is a visible fault

  GH-25 shipped the escalation that tells the human a role question has gone
  unanswered past its threshold. It runs on every operator tick and it is
  wired into the live tick. It has never once delivered, because its ops
  issue number ships commented out in swarmforge.conf and a missing value was
  specced to degrade to a status.json key plus an operator-log warning. No
  surface reads that key, so the degradation is invisible by construction:
  between 2026-08-30T06:36Z and 2026-09-03 the operator log took 7027
  identical refusals while two role slots sat wedged and a backlog-root
  intake stayed blocked for four days.

  This slice does not decide which transport ultimately carries the
  escalation - that is BL-1347's question. It makes an escalation that cannot
  deliver say so on a surface a human already reads, and stops it shouting
  the same line into a log nobody reads.

  Background:
    Given the operator runtime tick is running

  # BL-1352 escalation-transport-fault-01
  Scenario Outline: the status surface distinguishes healthy, latent and losing
    Given the ask escalation transport is <transport>
    And <questions> role question outstanding past the escalation threshold
    When the human reads the swarm status surface
    Then the ask escalation row reads <state>

    Examples:
      | transport    | questions | state             |
      | configured   | one       | ok                |
      | configured   | none      | ok                |
      | unconfigured | none      | warn-unconfigured |
      | unconfigured | one       | fault             |

  # BL-1352 escalation-transport-fault-02
  Scenario: a fault names the role whose question is going undelivered
    Given the ask escalation transport is unconfigured
    And one role question outstanding past the escalation threshold
    When the human reads the swarm status surface
    Then the ask escalation row names the waiting role

  # BL-1352 escalation-transport-fault-03
  Scenario Outline: the transport line is logged on change, never once per tick
    Given the ask escalation transport is unconfigured
    And one role question outstanding past the escalation threshold
    When the operator runtime ticks ten times and the transport <change>
    Then the operator log carries <lines> ask escalation transport lines

    Examples:
      | change             | lines |
      | holds its state    | one   |
      | becomes configured | two   |
