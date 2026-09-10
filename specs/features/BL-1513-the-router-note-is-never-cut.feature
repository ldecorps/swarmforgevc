Feature: BL-1513 The router's Work note names the ticket id and its path and is never cut

  route_backlog_to_coder.sh dispatches a promoted ticket to its first role as a
  priority-10 note. A note's message header is capped at 80 characters
  (handoff-protocol.md; swarm_handoff.bb refuses longer), and the router
  composed the message from the ticket file's whole basename, then cut the
  result to 80 before sending. Any ticket whose file name is longer than 46
  characters lost the tail of its instruction - 52 of the 107 live tickets on
  2026-09-10 - and one longer than 75 lost part of its own slug. BL-1494's
  dispatch reached the coder as "Work BL-1494-a-note-sent-as-deferred-costs-its-
  role-no-wake: read file in backlo", was completed unworked four minutes
  later, and was re-routed by hand thirty minutes on.

  This feature is that the routed note names the ticket id and where its file
  is, fits the limit whatever the length of the file name, is still read as a
  dispatch by the dispatch trail, and that a message which cannot fit is
  refused whole rather than sent cut.

  Background:
    Given a fixture repo with coordinator and coder mailbox trees and no dispatch trail

  # BL-1513 note-fits-regardless-of-slug-length-01
  Scenario Outline: the routed note names the ticket id and the backlog/active path whatever the length of the ticket file's name
    Given an active ticket BL-9001 whose file name is BL-9001- followed by a slug of <slug_length> characters
    When route_backlog_to_coder.sh routes the ticket
    Then the note in the coder's new mailbox begins with "Work BL-9001"
    And that note's message names "backlog/active"
    And that note's message is no longer than 80 characters

    Examples:
      | slug_length |
      | 10          |
      | 90          |

  # BL-1513 the-trail-reads-the-new-note-02
  Scenario: the dispatch trail counts the routed note as a dispatch and a second route without --force is refused
    Given an active ticket BL-9001 whose file name is BL-9001- followed by a slug of 90 characters
    When route_backlog_to_coder.sh routes the ticket
    Then the dispatch trail answers DISPATCHED for BL-9001
    And a second route of the ticket without --force is refused

  # BL-1513 a-note-that-cannot-fit-is-refused-whole-03
  Scenario: a note that would exceed the message limit is refused whole, never sent cut
    Given an active ticket whose id is BL- followed by 70 digits
    When route_backlog_to_coder.sh routes the ticket
    Then it exits non-zero naming the 80-character limit and the length it composed
    And the coder's new mailbox holds no note
