Feature: Clearing a role's question slot announces the closure on the thread that asked
  A role's clarifying question is posted into that role's own Telegram topic with
  tappable options and a free-text fallback. When the slot is later cleared by
  role_ask.bb's resolve leg, the live marker is removed and a preserved record is
  written - and nothing at all is said on the thread. The human is left looking at
  a question that reads as live, on a topic that gives no sign it has been closed.

  Two things follow, both observed rather than supposed. An answer typed after the
  clear is recorded against a question that no longer has a marker, so the next
  deliver-role-answer.js run reports mismatch and the answer is discarded without
  the human ever learning it went nowhere. And the human has no way to tell a
  question still waiting on them from one already settled, which is the exact
  ambiguity this epic exists to remove.

  The fix is one message on the same thread. It is deliberately not a new channel,
  a new store, or a second decision system: the closure rides the outbox and the
  synthetic threadId the ask itself already uses.

  Background:
    Given a project root with a role-awaiting store and a reply outbox

  # BL-1355 clearing-announces-closure-01
  Scenario: clearing a pending question announces it, naming the question and the reason
    Given role "specifier" has a pending question "which surface did you mean?"
    When the role resolves its pending question with reason "answered out of band"
    Then a closure message for role "specifier" is appended to the reply outbox
    And the closure message carries the question "which surface did you mean?" and the reason "answered out of band"

  # BL-1355 clearing-announces-closure-02
  Scenario: the closure rides the same thread the question was asked on
    Given role "specifier" has a pending question "which surface did you mean?"
    When the role resolves its pending question with reason "answered out of band"
    Then the closure message carries the same threadId the ask for role "specifier" used

  # BL-1355 clearing-announces-closure-03
  Scenario: a refused clear announces nothing
    Given role "specifier" has a pending question "which surface did you mean?"
    When the role resolves its pending question with reason ""
    Then no closure message is appended to the reply outbox
    And role "specifier" still has a pending question

  # BL-1355 clearing-announces-closure-04
  Scenario: clearing when nothing is pending announces nothing
    Given role "specifier" has no pending question
    When the role resolves its pending question with reason "housekeeping"
    Then no closure message is appended to the reply outbox

  # BL-1355 clearing-announces-closure-05
  Scenario: an unwritable outbox never holds the slot shut
    Given role "specifier" has a pending question "which surface did you mean?"
    And the reply outbox cannot be written
    When the role resolves its pending question with reason "answered out of band"
    Then the clear still succeeds and reports that the closure could not be announced
    And role "specifier" has no pending question
