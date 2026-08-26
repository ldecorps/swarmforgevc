Feature: every operator_runtime.bb test fixture sandboxes the libs it load-files

  # BL-671: operator_runtime.bb load-files llm_cost_ledger_lib.bb, but 9 of
  # the 10 test_operator_runtime_*.sh fixtures build their sandbox by
  # explicitly cp-ing operator_runtime.bb alone — the ledger lib was added
  # after those nine were written, so every one of them breaks at require
  # time. Fix (coder's call): a shared fixture helper that copies
  # operator_runtime.bb together with every lib it load-files, so the next
  # added lib breaks one place instead of nine.

  # BL-671 all-ten-fixtures-pass-01
  Scenario Outline: every test_operator_runtime_*.sh fixture passes end-to-end
    Given "<fixture>" builds a sandbox copy of operator_runtime.bb
    When "<fixture>" runs
    Then it passes end-to-end
    And operator_runtime.bb loads successfully in its sandbox

    Examples:
      | fixture                                              |
      | test_operator_runtime_bl647_rotation_liveness.sh      |
      | the other nine test_operator_runtime_*.sh fixtures    |

  # BL-671 next-added-load-file-breaks-one-place-02
  Scenario: a new lib load-filed by operator_runtime.bb breaks one fixture location, not nine
    Given operator_runtime.bb load-files a new lib not yet in any fixture's sandbox copy list
    When the fixtures' shared sandbox-copy helper is updated for the new lib
    Then every test_operator_runtime_*.sh fixture picks up the new lib without a per-fixture edit
