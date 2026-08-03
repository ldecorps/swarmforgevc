Feature: Bubble composes and queues a note to a chosen swarm role
  Bubble can reach the swarm today only through Let's Talk. This slice adds a
  note composer: a role picker fed by the roster the bridge already publishes,
  a one-line message the handoff format can actually carry, and a send that
  queues a real `note` handoff through swarm_handoff.bb. Sending only — amend
  and withdraw of a still-queued note are later slices of the same epic.
  Source: backlog/GH-29-bubble-screen.yaml (GitHub issue 29).

  Background:
    Given Bubble is paired with a reachable bridge

  # GH-29 bubble-note-composer-01
  Scenario: the note composer is reachable from Bubble's main navigation
    When the human opens the note composer from the main navigation
    Then the note composer is shown

  # GH-29 bubble-note-composer-02
  Scenario: the role picker offers exactly the roles the swarm reports
    When the human opens the note composer from the main navigation
    Then the role picker lists every role the bridge reports
    And the role picker lists no role the bridge did not report

  # GH-29 bubble-note-composer-03
  Scenario: a note addressed to a chosen role is queued for that role
    Given the human has opened the note composer
    When the human picks a role and sends a message within the stated limit
    Then a note carrying that message is queued for the picked role
    And the composer confirms the note was queued

  # GH-29 bubble-note-composer-04
  Scenario Outline: a message the handoff format cannot carry is refused before any send
    Given the human has opened the note composer
    When the human enters <message>
    Then the composer refuses to send it
    And the composer states <reason>
    And no note is queued

    Examples:
      | message                                     | reason                             |
      | a message longer than the stated limit      | the one-line character limit       |
      | a message containing a line break           | the single-line requirement        |
      | an empty message                            | that a note needs a message        |

  # GH-29 bubble-note-composer-05
  Scenario Outline: a send the bridge refuses shows the reason the server gave
    Given the human has opened the note composer
    When a send fails with <failure>
    Then the composer shows the reason for <failure>
    And the composer does not show a bare HTTP status code alone
    And the composer does not report the note as queued

    Examples:
      | failure                  |
      | an unreachable host      |
      | a rejected token         |
      | a refused queue write    |

  # GH-29 bubble-note-composer-06
  Scenario Outline: this slice sends only
    When the human opens the note composer from the main navigation
    Then no <control> control is offered on the note composer

    Examples:
      | control  |
      | amend    |
      | withdraw |
