Feature: BL-1843 A note about a ticket is claimed under the same seat rules as the ticket's own parcels

  A stage with two seats hands a queued parcel to whichever seat asks
  first (BL-983). Two rules temper that race, and both skip notes. The
  tier filter (BL-1001) prices a parcel by its ticket's mutation_cost, but
  sees a ticket in a note only when the message reads "Work BL-...". The
  affinity rule (BL-1004) defers a rework to the seat that worked the
  task, but only for a git_handoff. On 2026-09-30 the coordinator's
  reminders "BL-1816 still todo - build+forward BEFORE completing this
  note" and "BL-1830 still todo - ..." were claimed by the easy-only local
  seat coder@iq3, while the primary coder held both tickets and BL-1830 is
  medium. The seat spent about forty minutes on the first and the
  coordinator cleared both by hand. A note that names a ticket, in either
  wording, is now claimed under the tier filter and the affinity rule
  exactly as a git_handoff for that ticket would be.

  Background:
    Given the coder stage has two seats, coder declared for hard work and coder@iq3 declared easy-only

  # BL-1843 an-easy-seat-never-claims-a-note-about-a-harder-ticket-01
  Scenario Outline: the easy-only seat leaves a note about a medium ticket in the stage queue
    Given ticket BL-9001's mutation_cost is medium
    And the stage queue holds the note "<message>"
    When seat coder@iq3 asks for its next task
    Then the note stays in the stage queue

    Examples:
      | message                                                         |
      | Work BL-9001: merge main first, then read backlog/active        |
      | BL-9001 still todo - build+forward BEFORE completing this note  |

  # BL-1843 a-note-waits-for-the-seat-that-worked-its-ticket-02
  Scenario Outline: a note about a ticket the other seat worked waits for that seat
    Given ticket BL-9002's mutation_cost is low
    And seat coder has worked BL-9002
    And the stage queue holds the note "<message>"
    When seat <asking> asks for its next task
    Then the note <outcome>

    Examples:
      | message                                                         | asking    | outcome                  |
      | BL-9002 still todo - build+forward BEFORE completing this note  | coder@iq3 | stays in the stage queue |
      | BL-9002 still todo - build+forward BEFORE completing this note  | coder     | is claimed by that seat  |
      | Work BL-9002: merge main first, then read backlog/active        | coder@iq3 | stays in the stage queue |

  # BL-1843 the-wait-is-bounded-03
  Scenario: a note that has waited past the cross-seat deadline is claimed by the seat that asks
    Given ticket BL-9002's mutation_cost is low
    And seat coder has worked BL-9002
    And the stage queue holds the note "BL-9002 still todo - build+forward BEFORE completing this note"
    And that note has waited past the cross-seat claim deadline
    When seat coder@iq3 asks for its next task
    Then the note is claimed by that seat

  # BL-1843 a-note-naming-no-ticket-is-claimed-as-today-04
  Scenario: a note that names no ticket is claimed by the first seat to ask
    Given the stage queue holds the note "merge main into your branch"
    When seat coder@iq3 asks for its next task
    Then the note is claimed by that seat
