Feature: BL-1616 A ticket built from a Work note counts as worked by that seat

  BL-1004 keeps a rework on the seat that holds its history: a bounce
  addressed to a two-seat stage is deferred by any seat whose sibling has
  worked the task. "Worked" is read from the git_handoff task headers in
  the seat's completed/ and in_process/ - and coder work is dispatched by
  the coordinator's Work note, whose ticket lives in its message and which
  carries no task header. A seat that builds a ticket from a Work note
  therefore holds no worked record, and the ticket's bounce is a coin
  toss between seats. On 2026-09-17 the hardender's bounce of BL-1610
  (001373) was claimed by coder@2 at 06:41Z with no deferral line although
  coder had built the ticket from Work notes 008954 and 008992; coder@2
  rebuilt it on a tree without the build. This feature is that a completed
  Work note names the ticket its message names, through the one
  attribution the claim predicate uses, and that a note completed with a
  --no-work reason names nothing.

  Background:
    Given a swarm where a parcel addresses a stage and a seat claims from that stage's queue

  # BL-1616 work-note-counts-as-worked-01
  Scenario Outline: a bounce follows the seat whose Work note built the ticket
    Given the coder stage has two seats, coder and coder@2
    And the coder seat's completed/ holds a Work note naming ticket BL-0042 and no git_handoff for it
    And that note was completed <completion>
    And the stage queue holds a git_handoff bounce for BL-0042 enqueued <age>
    When seat coder@2 asks for its next task
    Then the bounce <outcome>

    Examples:
      | completion               | age                                             | outcome                                                    |
      | without a no-work reason | moments ago                                     | stays in the stage queue and the deferral line names coder |
      | with a --no-work reason  | moments ago                                     | is claimed by coder@2                                      |
      | without a no-work reason | longer ago than the cross-seat claim deadline   | is claimed cross-seat and the claim says so                |

  # BL-1616 work-note-counts-as-worked-02
  Scenario: a note whose message names no ticket contributes no worked task
    Given the coder stage has two seats, coder and coder@2
    And the coder seat's completed/ holds a note whose message names no ticket
    And the stage queue holds a git_handoff bounce for BL-0042 enqueued moments ago
    When seat coder@2 asks for its next task
    Then the bounce is claimed by coder@2

  # BL-1616 work-note-counts-as-worked-03
  Scenario: a single-seat stage consults no worked set
    Given the coder stage has one seat, coder
    And the coder seat's completed/ holds a Work note naming ticket BL-0042 and no git_handoff for it
    And that note was completed without a no-work reason
    And the stage queue holds a git_handoff bounce for BL-0042 enqueued moments ago
    When seat coder asks for its next task
    Then the bounce is claimed and no deferral line is printed
