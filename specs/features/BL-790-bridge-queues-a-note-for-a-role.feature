Feature: The bridge queues a short note into a chosen role's mailbox
  The phone has no way to steer a swarm role without going to Telegram or the
  laptop. This slice puts the send path on the bridge: an authenticated caller
  names a declared role and a short message, and a real `type: note` parcel is
  queued for that role through swarm_handoff.bb. The Bubble page that calls it
  is the next slice; this half is Node-testable today and does not wait on the
  Android test seam.
  Source: backlog/INTAKE-bubble-send-notes-swipe-screen.md and
  backlog/GH-29-bubble-screen.yaml (GitHub issue 29).

  Background:
    Given a caller authenticated to the bridge

  # GH-29 bridge-queues-a-note-01
  Scenario: a note for a declared role is queued into that role's mailbox
    When the caller sends a short note to a declared role
    Then a note parcel is queued for that role at priority 00
    And the response confirms the note was queued

  # GH-29 bridge-queues-a-note-02
  Scenario: a dormant role is a valid recipient
    Given the declared role the caller will name has no running session
    When the caller sends a short note to a declared role
    Then a note parcel is queued for that role at priority 00

  # GH-29 bridge-queues-a-note-03
  Scenario: the queued note is attributable to the operator
    When the caller sends a short note to a declared role
    Then the queued parcel is distinguishable from a note the coordinator wrote

  # GH-29 bridge-queues-a-note-04
  Scenario Outline: a message the handoff format cannot carry is refused
    When the caller sends <message> to a declared role
    Then the bridge refuses it stating <reason>
    And no note parcel is queued

    Examples:
      | message                                | reason                       |
      | a message longer than the stated limit | the one-line character limit |
      | a message containing a line break      | the single-line requirement  |
      | an empty message                       | that a note needs a message  |

  # GH-29 bridge-queues-a-note-05
  Scenario: a role the swarm does not declare is refused
    When the caller sends a short note to a role the swarm does not declare
    Then the bridge refuses it stating that the role is not declared
    And no note parcel is queued

  # GH-29 bridge-queues-a-note-06
  Scenario: an unauthenticated caller cannot queue a note
    Given a caller with no valid token
    When the caller sends a short note to a declared role
    Then the request is rejected
    And no note parcel is queued
