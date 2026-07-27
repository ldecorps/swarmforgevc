Feature: A supervisor conversation is not a front-desk topic

  The concierge serialises every Telegram topic it touches into a git-tracked record
  under `backlog/topics/`, and it makes no distinction between a ticket's topic and
  the private thread the human uses to supervise the swarm. So the supervisor's own
  conversation acquires a committed record in the project repository, with a commit
  message announcing it. The human read one of those commits as the swarm reaching
  into a thread that was theirs, and said so.

  Measured before speccing, so the scope is the real exposure and not the feared one:
  nine such records exist and every one of them holds an id and an icon marker with
  an empty message list. No conversation text has been committed. What is missing is
  not a repair but a BOUNDARY — nothing in the store distinguishes the two kinds of
  thread, so the day a supervisor thread takes the ordinary message path, its text is
  committed to a tracked repository and nobody decided that.

  The boundary has to survive one trap. The icon marker in those records is what tells
  the swarm it has already set a topic's icon; delete the record and give it nothing
  in its place and the swarm re-sets the icon on every restart, which the human sees
  as flicker. Exempting a thread from the tracked record must not exempt it from
  remembering what it already did.

  This slice draws the line where the serialisation happens. Whether the supervisor
  conversation should live in a separate Telegram group entirely — the structural
  answer, and the one the multi-swarm work already argues for — is a larger question
  left open on the ticket for the human to rule on.

  Background:
    Given a Telegram forum carrying both ticket topics and the human's supervisor thread

  # BL-695 supervisor-thread-boundary-01
  Scenario Outline: a supervisor thread gets no git-tracked record
    Given a thread whose subject is a supervisor conversation
    When <concierge action> occurs on that thread
    Then no record for it is written under the tracked topics directory
    And no commit is made naming that thread

    Examples:
      | concierge action                  |
      | the swarm sets the topic's icon   |
      | a message is sent to the thread   |
      | a message is received from it     |

  # BL-695 supervisor-thread-boundary-02
  Scenario: a ticket topic is still recorded exactly as before
    Given a thread bound to a ticket
    When a message is sent to that thread
    Then its record is written under the tracked topics directory
    And the record contains that message

  # BL-695 supervisor-thread-boundary-03
  Scenario: the swarm still remembers an icon it already set on a supervisor thread
    Given the swarm has set the icon on a supervisor thread
    When the front desk restarts and reconsiders that thread's icon
    Then it does not set the icon again
    And it never consulted a tracked record to decide that

  # BL-695 supervisor-thread-boundary-04
  Scenario: the records already committed for supervisor threads are removed
    Given tracked records exist for supervisor threads from before the boundary
    When the boundary lands
    Then those records are gone from the working tree
    And the icons on those threads are unchanged

  # BL-695 supervisor-thread-boundary-05
  Scenario: the boundary fails closed on a thread it cannot bind to a ticket
    Given a thread that is not bound to any ticket
    When the concierge decides whether to record it
    Then it writes no record
    And it reports the thread it could not bind
