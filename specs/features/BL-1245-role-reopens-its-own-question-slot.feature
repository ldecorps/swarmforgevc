Feature: A role reopens its own question slot when no answer ever reached the store
  BL-1244 covers the ordinary case, where an answer WAS recorded and the slot
  should free itself. This is the case where nothing was recorded at all: the
  human answered while the swarm was down, so no bot ran, and
  deliver-role-answer.js has nothing to pair and reports no-answer. The marker
  then holds the role's single pending slot shut on a question already
  answered, with no expiry and no override - which happened on 2026-08-28 and
  cost a role its clarifying-question channel for five hours.

  The role must be able to reopen its own slot, on the record, without
  destroying the evidence of what it asked.

  Background:
    Given a project root with a role-awaiting store

  # BL-1245 role-reopens-own-slot-01
  Scenario: a resolved slot accepts the next question
    Given role "specifier" has a pending question "old question"
    When the role resolves its pending question with reason "answered out of band"
    And role "specifier" asks "new question"
    Then the ask is accepted

  # BL-1245 role-reopens-own-slot-02
  Scenario: resolving preserves what was asked
    Given role "specifier" has a pending question "old question"
    When the role resolves its pending question with reason "answered out of band"
    Then the question "old question", its asked_at_ms, and the reason "answered out of band" are all still readable

  # BL-1245 role-reopens-own-slot-03
  Scenario: a resolve with no reason is refused
    Given role "specifier" has a pending question "old question"
    When the role resolves its pending question with reason ""
    Then the resolve is refused

  # BL-1245 role-reopens-own-slot-04
  Scenario: an unresolved pending question still blocks a second one
    Given role "specifier" has a pending question "old question"
    When role "specifier" asks "new question"
    Then the ask is refused as already-pending

  # BL-1245 role-reopens-own-slot-05
  Scenario: resolving when nothing is pending is not an error
    Given role "specifier" has no pending question
    When the role resolves its pending question with reason "housekeeping"
    Then the resolve reports that nothing was pending

  # BL-1245 role-reopens-own-slot-06
  Scenario: preserved evidence is never read back as a pending question
    Given role "specifier" has a pending question "old question"
    And the role resolves its pending question with reason "answered out of band"
    When role "specifier" asks "new question"
    Then the ask is accepted
    And the only pending question for role "specifier" is "new question"
