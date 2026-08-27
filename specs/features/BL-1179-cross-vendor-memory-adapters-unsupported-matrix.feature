Feature: cross-vendor memory adapters refuse unsupported pairs loudly

  # BL-1179 (epic BL-1176). Adapters + explicit unsupported matrix for
  # mixed-vendor same-role swaps.

  Background:
    Given the portable agent-memory payload from BL-1177

  # BL-1179 supported-pair-transfers-01
  Scenario: a supported vendor pair transfers via the portable payload
    Given outgoing and incoming runtimes are a supported pair in the matrix
    When memory transfer runs for that same-role swap
    Then transfer succeeds using the portable payload

  # BL-1179 unsupported-pair-refuses-02
  Scenario: an unsupported vendor pair refuses with a matrix reason
    Given outgoing and incoming runtimes are listed as unsupported
    When memory transfer is attempted
    Then transfer refuses naming the unsupported matrix reason
    And continuity is not silently pretended

  # BL-1179 matrix-readable-without-live-swap-03
  Scenario: the unsupported matrix is readable without performing a live swap
    When the unsupported matrix is queried
    Then each unsupported pair is named with a reason
