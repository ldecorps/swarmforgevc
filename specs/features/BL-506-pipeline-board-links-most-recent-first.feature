Feature: the pipeline board LINKS section lists the most recent tickets first

  # Root intake 2026-07-17 (backlog/INTAKE-pipeline-board-links-order.md): the LINKS section
  # rendered oldest-first (BL-001, BL-002, BL-003, ...) because buildLinks sorts every link by
  # id STRING ascending across all four sources (active rows, parked, recently-closed,
  # root-intake). The human wants most-recent first. Decision (specifier asked 2026-07-17):
  # "most recent" = highest ticket NUMBER first, numeric-aware (not lexicographic), since the
  # merged sources carry only {id, path} - no closed-at timestamp to order by true chronology.
  #
  # Observable contract:
  #  1. LINKS are ordered by ticket number DESCENDING - highest (newest) first.
  #  2. Ordering is NUMERIC, not lexicographic: BL-1000 sorts ABOVE BL-999 (a plain string sort
  #     would place "BL-1000" below "BL-999", the exact bug the current comparator would hit at
  #     the four-digit boundary).
  #  3. An id with no parseable trailing ticket number (a root-intake filename stem) sorts AFTER
  #     every numbered link, ordered deterministically among such ids, so the render stays stable
  #     tick-over-tick (the board's content-signature change-gate needs a deterministic order).
  #     [Specifier decision, flagged for human sign-off: unnumbered root-intake ids sort LAST
  #     rather than first; the LINKS block is a reference list, not a priority list.]
  # Only the LINKS section ORDERING changes. The grid, the below-grid lists, the link TEXT/format,
  # and BL-502's link-budget/overflow behaviour are all unchanged.

  Background:
    Given a repo base url is configured so the board renders tappable ticket links

  # BL-506 pipeline-board-links-most-recent-first-01
  Scenario: links are listed highest ticket number first
    Given linkable tickets "BL-101", "BL-493", "BL-504"
    When the pipeline board links are rendered
    Then the links appear in the order "BL-504", "BL-493", "BL-101"

  # BL-506 pipeline-board-links-most-recent-first-02
  Scenario: link ordering is numeric, so a four-digit ticket sorts above a three-digit one
    Given linkable tickets "BL-999", "BL-1000"
    When the pipeline board links are rendered
    Then the links appear in the order "BL-1000", "BL-999"

  # BL-506 pipeline-board-links-most-recent-first-03
  Scenario: an id with no ticket number sorts after every numbered link
    Given linkable tickets "BL-504" and a root-intake entry "INTAKE-pipeline-board-links-order"
    When the pipeline board links are rendered
    Then the links appear in the order "BL-504", "INTAKE-pipeline-board-links-order"
