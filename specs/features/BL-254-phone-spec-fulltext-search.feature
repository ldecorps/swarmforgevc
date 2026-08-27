Feature: the phone app filters the docs drill-down by full-text spec search

  # Operator request (2026-07-10, via coordinator intake clarification, commit
  # b575253; the intake file was drained with BL-253 so this half is specced from
  # that history). The operator's PRIMARY ask: a text search/filter box in the phone
  # app that matches any Gherkin scenario (and ideally ticket title/description) by
  # its text, filtering the docs drill-down tree to the matching items — across BOTH
  # implemented and not-yet-implemented items. The implemented-vs-greyed drill-down
  # (BL-253) is the surface this filters over.
  #
  # REUSE: filter the docs-tree data the PWA already fetches (BL-117's tree already
  # carries each ticket's scenarios, title, and status). Client-side substring
  # filter — no new search endpoint or index. This item works over the existing tree
  # and COMPOSES with BL-253's status styling (matched items keep the tree's normal
  # status treatment), so it does not hard-depend on BL-253.

  Background:
    Given the phone docs drill-down tree over milestones, tickets, and their Gherkin scenarios

  # BL-254 filter-by-gherkin-01
  Scenario: a query filters the tree to tickets whose Gherkin matches
    Given a query that appears in a ticket's Gherkin scenario text
    When the search is applied
    Then that ticket remains in the filtered tree
    And a ticket containing the query nowhere is hidden

  # BL-254 match-title-description-02
  Scenario: the query also matches a ticket's title or description
    Given a query that appears in a ticket's title or description but not its scenarios
    When the search is applied
    Then that ticket remains in the filtered tree

  # BL-254 case-insensitive-03
  Scenario: matching is case-insensitive substring
    Given a query that differs only in letter case from text in a ticket's Gherkin
    When the search is applied
    Then that ticket still matches

  # BL-254 spans-implemented-and-not-yet-04
  Scenario: search spans implemented and not-yet-implemented items
    Given a query that matches both an implemented ticket and a not-yet-implemented ticket
    When the search is applied
    Then both remain in the filtered tree, each with the tree's normal status treatment

  # BL-254 empty-query-05
  Scenario: an empty query shows the full unfiltered tree
    Given an empty query
    When the search is applied
    Then the full unfiltered tree is shown

  # BL-254 no-results-06
  Scenario: a query that matches nothing shows a clear empty state
    Given a query that matches no ticket
    When the search is applied
    Then a clear no-results state is shown rather than a blank or an error
