Feature: A dead remote-control session is detected and repaired without the human noticing it first

  Background:
    Given a swarm whose roles are launched with remote control enabled

  # BL-898 rc-session-dead-01
  Scenario Outline: only a persistently failed session on a live, correctly-flagged agent is repaired here
    Given the role's remote-control state is <state>
    When the remote-control health of that role is classified
    Then the role is reported as <status>
    And dead-session repair <repair>

    Examples:
      | state                                                      | status               | repair           |
      | a failed session footer seen on consecutive observations   | session-dead         | is triggered     |
      | a failed session footer seen once                          | not yet session-dead | is not triggered |
      | a working session footer                                   | healthy              | is not triggered |
      | a working session footer since a repair on the last sweep  | healthy              | is not triggered |
      | the expected remote-control flag missing from a live agent | degraded             | is not triggered |
      | no agent process running                                   | down                 | is not triggered |

  # BL-898 rc-session-dead-02
  Scenario Outline: repair never interrupts an agent mid-turn
    Given a role reported as session-dead whose agent is busy
    And that agent <idles>
    When dead-session repair runs
    Then the agent is never interrupted mid-turn
    And the role is <outcome>

    Examples:
      | idles                               | outcome                              |
      | becomes idle within the wait budget | respawned                            |
      | stays busy past the wait budget     | left running and reported unrepaired |

  # BL-898 rc-session-dead-03
  Scenario Outline: the human is told the outcome of every repair
    Given a role reported as session-dead whose agent has been respawned
    And the new session address is <address>
    When the repair completes
    Then the human is notified that the role's remote control was repaired
    And the notification carries <carried>

    Examples:
      | address      | carried                                   |
      | readable     | the new session address                   |
      | not readable | a statement that the address was not read |
