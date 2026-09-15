Feature: BL-1573 The dispatch-gap note fallback is a dispatch trail

  The dispatch-gap sweep, unable to resolve HEAD, falls back to a soft
  note instead of a git_handoff. BL-1223 narrowed what counts as a dispatch
  trail to structural task headers and the router's verb-first Spec or
  Work notes, and re-worded the sibling unassigned-active nudge to match,
  but left this fallback as a bare-id mention. So the fallback wakes the
  assignee and then the next sweep, reading no trail, sends it again. This
  feature is that the fallback note itself counts as the dispatch it is.

  Background:
    Given the dispatch-gap draft for an active ticket BL-217 assigned to coder is built with no commit

  # BL-1573 dispatch-gap-fallback-is-a-trail-01
  Scenario: the fallback draft is a note the trail predicate attributes to the ticket
    When the dispatch trail predicate reads the draft's message header
    Then it answers BL-217

  # BL-1573 dispatch-gap-fallback-is-a-trail-02
  Scenario: a queued fallback note silences the next sweep
    Given that draft sits as the only handoff in the coordinator's outbox
    When the dispatch-gap sweep lists the tickets needing a route
    Then BL-217 is not listed

  # BL-1573 dispatch-gap-fallback-is-a-trail-03
  Scenario: the note still fits the handoff message limit and still names its ticket first
    When the draft's message header is measured
    Then it is at most 80 characters
    And extract-ticket-id resolves it to BL-217

  # BL-1573 dispatch-gap-fallback-is-a-trail-04
  Scenario: the pure runner stays green and pins the new text
    When swarmforge/scripts/test/dispatch_gap_test_runner.bb runs
    Then it exits zero
