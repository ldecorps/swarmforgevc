Feature: the pipeline board LINKS section lists only the grid tickets, alphabetically

  # SUPERSEDES BL-506 (human directive, relayed in-session 2026-07-18): "in the LINKS section, put
  # only the YAMLs for the tickets shown on the message, in alphabetical order." BL-506 (LINKS
  # ordered most-recent / highest-ticket-number first, numeric-aware, across all four link sources)
  # was ALREADY QA-approved and integrating when this directive arrived, so it could not be amended
  # in-flight; this new ticket carries out the human's supersession. The specifier asked and the
  # human chose "Supersede: grid-only, alphabetical" over keeping BL-506's most-recent-first. So the
  # LINKS section now:
  #  1. Includes ONLY the tickets shown on the board GRID (the active pipeline rows rendered in the
  #     board message) - the parked, recently-closed, and root-intake link sources buildLinks merges
  #     in (and that BL-506 just ordered) are DROPPED from LINKS entirely.
  #  2. Orders those links ALPHABETICALLY (lexicographic, A->Z) by id - literal string order, the
  #     plain reading of "alphabetical" and the reverse of BL-506's just-shipped most-recent-first.
  #     [Specifier note, flagged for human sign-off in the ticket: literal alphabetical is NOT
  #     numeric-aware, so "BL-1000" sorts ABOVE "BL-999" lexicographically. The active grid is small
  #     and same-width today, so this only bites past the 4-digit boundary; easy to flip to numeric
  #     if the human prefers.]
  #
  # Verified live layer: extension/src/concierge/pipelineBoard.ts buildLinks (~L357-364) merges
  # links from FOUR sources (active rows, parked, recently-closed, root-intake) and (after BL-506)
  # orders them most-recent-first. This ticket narrows the SET to grid tickets only and replaces the
  # comparator with a plain alphabetical id sort. The grid, the below-grid lists, the link
  # TEXT/format, and BL-502's link-budget/overflow behaviour are all unchanged. Update the
  # pipelineBoard test / acceptance fixtures that BL-506 set to pin most-recent-first LINKS order so
  # this fix does not just move the defect into a stale expectation (grep pipelineBoard.test.js and
  # the BL-506 feature/steps).

  Background:
    Given a repo base url is configured so the board renders tappable ticket links

  # BL-513 pipeline-board-links-grid-only-01
  Scenario: LINKS include only the tickets shown on the board grid
    Given the board grid shows tickets "BL-493", "BL-504"
    And a recently-closed ticket "BL-101" that is not on the grid
    When the pipeline board links are rendered
    Then only "BL-493" and "BL-504" have links
    And "BL-101" has no link

  # BL-513 pipeline-board-links-alphabetical-02
  Scenario Outline: the grid tickets' links are listed in plain alphabetical (lexicographic) order
    Given the board grid shows tickets <tickets>
    When the pipeline board links are rendered
    Then the links appear in the order <order>

    # Row 1: plain A->Z. Row 2: the load-bearing edge - lexicographic, NOT numeric, so the
    # four-digit "BL-1000" sorts ABOVE the three-digit "BL-999" (the plain reading of "alphabetical").
    Examples:
      | tickets                        | order                          |
      | "BL-504", "BL-101", "BL-493"   | "BL-101", "BL-493", "BL-504"   |
      | "BL-999", "BL-1000"            | "BL-1000", "BL-999"            |
