Feature: BL-2043 A gather row keeps its lane's failures and verdict whatever the tail holds

  QA's gather (qa-gather.js) reports each lane as a row whose excerpt is the
  last 4000 characters of the run's stdout followed by its stderr. On
  2026-10-06 that tail cost QA three hand checks. Twice a red property run's
  assertion text was crowded out by allowlisted stderr noise or cut
  mid-line, and once a green unit run's own per-file budget verdict, printed
  to stdout, sat above the tail. BL-1769 made the failing-file join read the
  whole output; the row itself still loses the text. After this parcel the
  unit and property rows carry each failing test's message as the lane's own
  report recorded it, and the lane's verdict line, however long the run's
  output is. The excerpt is unchanged.

  # BL-2043 a-red-row-carries-each-failure-message-01
  Scenario: a red property run's row carries its failing test's message verbatim
    Given a property run that exits 1 with one failing test whose message is "expected 3 handlers, found 2"
    And the run's stderr after the failure is longer than the excerpt with allowlisted onTaskUpdate timeouts
    When the gather builds the property lane's row
    Then the row names the failing test's file and carries "expected 3 handlers, found 2" verbatim

  # BL-2043 a-row-carries-its-lanes-verdict-line-02
  Scenario: a green unit run's row carries the lane's budget verdict line
    Given a unit run that exits 0 and prints its suite-file budget verdict to stdout
    And the run's stderr after the verdict is longer than the excerpt
    When the gather builds the unit lane's row
    Then the row carries the budget verdict line

  # BL-2043 an-unreadable-report-is-said-03
  Scenario: a red run whose report cannot be read says so on its row
    Given a property run that exits 1 without writing its report
    When the gather builds the property lane's row
    Then the row says the lane's failures could not be read from its report
