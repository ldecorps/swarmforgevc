Feature: Bubble Operator docs index and first readable pages

  # First slice of BL-1165: phone-readable documenter corpus from docs/index.md
  # via a Bubble remote HTML page — separate from the Gherkin docs-tree explorer.

  Background:
    Given the bridge serves the Bubble UI bundle with BL-829 remote page host
    And docs index.md lists tutorials how-to reference and explanation sections
    And at least one how-to and one reference markdown page exist in the repo docs tree

  # BL-1166 operator-docs-page-reachable-01
  Scenario: the expanded Bubble pager exposes an Operator docs entry point
    When the Operator docs remote page is opened from the Bubble pager
    Then the page loads without requiring a laptop browser
    And the page title identifies operator authored documentation

  # BL-1166 index-lists-divio-sections-02
  Scenario: the Operator docs index shows the four Divio sections from docs index.md
    When the Operator docs index is rendered
    Then it lists tutorials how-to reference and explanation sections
    And each section link drills to that section's page list derived from docs index.md

  # BL-1166 how-to-page-readable-03
  Scenario: a how-to markdown page renders readable on a phone viewport
    When the operator opens a listed how-to page from the Operator docs browser
    Then the response body is HTML not raw markdown source
    And headings and paragraphs are legible at a phone viewport width

  # BL-1166 reference-page-readable-04
  Scenario: a reference markdown page renders readable on a phone viewport
    When the operator opens a listed reference page from the Operator docs browser
    Then the response body is HTML not raw markdown source
    And headings and paragraphs are legible at a phone viewport width

  # BL-1166 read-only-no-write-05
  Scenario: the Operator docs browser exposes no write path
    When the Operator docs routes are enumerated at the parcel commit
    Then none of them accept backlog git or operator store writes from the browser client

  # BL-1166 bridge-auth-required-06
  Scenario: Operator docs content requires bridge authentication
    Given a client without a valid bridge token
    When it requests an authored docs HTML page
    Then the bridge refuses with an unauthorized or forbidden response
    And no document body is served

  # BL-1166 honest-unavailable-07
  Scenario: bridge unreachable shows an honest unavailable state
    Given the bridge cannot serve the docs corpus
    When the Operator docs page is opened
    Then the page shows an unavailable state that names bridge reachability
    And it does not present an empty corpus as if fully synced
