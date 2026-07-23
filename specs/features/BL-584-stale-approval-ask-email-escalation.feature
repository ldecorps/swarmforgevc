Feature: An unanswered approval ask escalates to email with a link into the Approvals topic

  An ApprovalRequested ask posts into the standing Telegram Approvals topic and waits
  for a tap or a typed reply. If the human misses it — away from the phone, buried in
  notifications — nothing else happens: the ticket keeps human_approval pending and
  silently blocks everything downstream of it, with no second channel and no upper
  bound on how long it sits.

  The front desk therefore sweeps for asks nobody has engaged with past a tunable
  threshold and emails the human one digest naming each of them, every line carrying a
  Telegram deep link that opens that exact ask so the escalation is actionable from the
  email itself.

  Two properties keep it quiet rather than nagging. Only HUMAN activity resets an ask's
  clock, so the swarm's own posts into the topic can never suppress an escalation, and
  a human reply can never trigger a redundant one. And the sweep fails closed: an ask
  whose post time cannot be established, or a front desk with no email configured,
  sends nothing at all rather than guessing — while a recipient configured with no API
  key is reported, never silently dropped.

  Background:
    Given the standing Approvals topic is 1785
    And the approval-ask stale threshold is 2 hours and the escalation cooldown is 4 hours
    And escalation email is configured with a recipient and an API key

  # BL-584 stale-approval-escalation-01
  Scenario Outline: an ask escalates only once it has gone unanswered for longer than the threshold
    Given BL-100 is awaiting approval and its ask was posted <ask_age> ago
    When the stale-approval sweep runs
    Then an escalation email is <outcome>

    Examples:
      | ask_age    | outcome  |
      | 3 hours    | sent     |
      | 30 minutes | not sent |

  # BL-584 stale-approval-escalation-02
  Scenario Outline: only a ticket still awaiting a human decision escalates
    Given BL-100 has human_approval <state> and its ask was posted 3 hours ago
    When the stale-approval sweep runs
    Then an escalation email is <outcome>

    Examples:
      | state    | outcome  |
      | pending  | sent     |
      | amending | sent     |
      | approved | not sent |
      | rejected | not sent |
      | absent   | not sent |

  # BL-584 stale-approval-escalation-03
  Scenario Outline: only human activity resets the clock, never the swarm's own posts
    Given BL-100 is awaiting approval and its ask was posted 5 hours ago
    And the newest <direction> message in its topic record is 10 minutes old
    When the stale-approval sweep runs
    Then an escalation email is <outcome>

    Examples:
      | direction | outcome  |
      | inbound   | not sent |
      | outbound  | sent     |

  # BL-584 stale-approval-escalation-04
  Scenario: several stale asks become one digest email, oldest first
    Given BL-100 is awaiting approval and its ask was posted 5 hours ago
    And BL-200 is awaiting approval and its ask was posted 3 hours ago
    When the stale-approval sweep runs
    Then exactly one escalation email is sent
    And its body lists BL-100 before BL-200

  # BL-584 stale-approval-escalation-05
  Scenario Outline: each listed ask carries a deep link to that exact Telegram message
    Given the Telegram chat id is <chat_id>
    And BL-100 is awaiting approval for 3 hours with recorded ask message id <message_id>
    When the stale-approval sweep runs
    Then the email body links BL-100 to "<link>"

    Examples:
      | chat_id        | message_id | link                               |
      | -1004415865297 | 6719       | https://t.me/c/4415865297/1785/6719 |
      | -1004415865297 | absent     | https://t.me/c/4415865297/1785      |
      | 4415865297     | 6719       | https://t.me/c/4415865297/1785/6719 |
      | not-a-number   | 6719       | (no link)                          |

  # BL-584 stale-approval-escalation-06
  Scenario Outline: a still-unanswered ask re-escalates only after the cooldown
    Given BL-100 is awaiting approval and its ask was posted 9 hours ago
    And the previous escalation email was sent <since_last> ago
    When the stale-approval sweep runs
    Then an escalation email is <outcome>

    Examples:
      | since_last | outcome  |
      | 1 hour     | not sent |
      | 5 hours    | sent     |

  # BL-584 stale-approval-escalation-07
  Scenario Outline: the sweep fails closed rather than guessing
    Given BL-100 is awaiting approval and <condition>
    When the stale-approval sweep runs
    Then an escalation email is not sent
    And the sweep completes without error

    Examples:
      | condition                                      |
      | its topic record holds no approval-ask message |
      | its topic record is missing entirely           |
      | the escalation recipient is unset              |

  # BL-584 stale-approval-escalation-08
  Scenario: a configured recipient with no API key is reported, never silently dropped
    Given BL-100 is awaiting approval and its ask was posted 3 hours ago
    And the Resend API key is absent from the environment
    When the stale-approval sweep runs
    Then an escalation email is not sent
    And the sweep warns that escalation email cannot send
