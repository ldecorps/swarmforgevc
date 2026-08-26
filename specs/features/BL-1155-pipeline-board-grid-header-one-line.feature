Feature: Pipeline Board stage header stays one line including QA
  The Telegram Pipeline Board `<pre>` matrix soft-wraps the stage header on
  phone widths so QA splits across two lines (Q then A), even after tip
  646ffe85d / BL-1117 made escapeHtml emit numeric &#160; for U+00A0.
  The pinned preview still shows one line; the message body does not.

  This slice keeps the eight-stage header on exactly one line under the
  board's stated phone width budget, without dropping or renaming QA.

  # BL-1155 pipeline-board-header-one-line-01
  Scenario: The stage header renders as exactly one line including intact QA
    Given the Pipeline Board grid is rendered for today's eight stage columns
    And the render targets the board's stated phone width budget
    When the stage header line is produced
    Then that header is exactly one line
    And the header contains the intact label "QA" with no mid-label wrap

  # BL-1155 pipeline-board-header-aligns-columns-02
  Scenario: Header cells still align over the matching mark columns
    Given the Pipeline Board grid is rendered with ticket mark rows
    When the stage header and a mark row are compared
    Then each header stage cell aligns over its corresponding mark column

  # BL-1155 pipeline-board-header-width-budget-03
  Scenario: The one-line contract is a named width or wrap budget, not only an entity string
    Given the Pipeline Board header one-line fix is in place
    When the width or wrap contract is inspected
    Then it names a durable layout or budget check (for example max composed header width)
    And it is not solely an assertion that the HTML contains numeric &#160;
