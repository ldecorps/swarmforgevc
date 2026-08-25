Feature: done_with_current.sh rejects arguments instead of completing silently

  # BL-652: dispatch_lib.bb run-helper! drops argv entirely, so a usage
  # probe like `done_with_current.sh --help` runs the full destructive
  # completion. Any argument must fail fast with usage text and NO
  # completion side effect, in both receive modes.

  # BL-652 done-with-current-arg-rejection-01
  Scenario Outline: any argument fails fast in batch mode with no completion side effect
    Given a role in batch receive mode with 2 handoffs in an in_process batch
    When done_with_current.sh is invoked with argument "<argument>"
    Then the exit code is non-zero
    And usage text stating the no-argument contract is printed
    And both handoffs remain in the in_process batch
    And no completed batch directory is created
    And no completed_at header is stamped on either handoff
    And ready_for_next is not chained

    Examples:
      | argument |
      | --help   |
      | -h       |
      | now      |

  # BL-652 done-with-current-arg-rejection-02
  Scenario: any argument fails fast in task mode with no completion side effect
    Given a role in task receive mode with 1 handoff in in_process
    When done_with_current.sh is invoked with argument "--help"
    Then the exit code is non-zero
    And usage text stating the no-argument contract is printed
    And the handoff remains in in_process

  # BL-652 done-with-current-arg-rejection-03
  Scenario: argumentless batch invocation still completes normally
    Given a role in batch receive mode with 2 handoffs in an in_process batch
    When done_with_current.sh is invoked with no arguments
    Then the batch is archived to completed
    And a completed_at header is stamped on both handoffs
