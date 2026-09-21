Feature: BL-1684 The pipeline board's caption cap budgets the rendered length and the message never exceeds its limit
  The board's caption description is capped at sixty-four characters of
  raw slug and the body is HTML-escaped afterwards, so escapable titles
  render far past the cap and a board of fifteen such rows composes over
  the message limit with no link list left to drop. This feature is that
  the cap budgets the rendered length, and that the composed message
  never exceeds its limit for any board.

  Background:
    Given the compiled pipeline board module

  # BL-1684 the-counterexample-board-composes-within-the-limit-01
  Scenario: a board of fifteen escapable long titles with no links composes within the message limit
    Given a board of fifteen active rows whose titles are long runs of ampersands and less-than signs, three plain parked tickets and four epic trackers
    When the board message is composed with no link list
    Then the composed html is at most the message limit
    And every caption line still ends in the ellipsis that marks the cap

  # BL-1684 the-bl956-property-passes-at-the-seed-that-failed-02
  # Pin (BL-1445): seed 10 of the bl956 invariant-1 property failed within 1500 runs at mint.
  Scenario: BL-956 invariant 1 holds at the seed that found the overflow
    When the bl956 caption-cap property's invariant 1 runs at seed 10 for 1500 runs
    Then it passes
