Feature: an expedited run never reports success with its ticket's backlog state unchanged

  # BL-1023. The expeditor ends a passing run by moving its ticket from
  # backlog/active/ to backlog/done/, but the move is guarded by a when-let
  # that returns nil when the ticket is not in the source folder. An
  # expedited ticket specced straight into backlog/paused/ - the default,
  # since an expedited run has no coordinator to promote it - therefore
  # finishes fully built, gated and landed while still filed as un-started
  # work, with the run summary reporting success. Found during the BL-1021
  # run, which was promoted by hand mid-run to avoid it.

  Background:
    Given an expedited run whose stages all pass

  # BL-1023 run-ticket-in-active-is-bookkept-01
  Scenario: the ordinary case still closes the ticket
    Given the run ticket is filed as active
    When the run completes
    Then the run reports success
    And the run ticket is closed

  # BL-1023 run-ticket-not-active-is-never-a-silent-success-02
  Scenario Outline: a run ticket the expeditor cannot close never passes silently
    Given the run ticket is filed as <location>
    When the run completes
    Then the run does not report success with the run ticket still filed as <location>

    Examples:
      | location |
      | paused   |
      | hold     |

  # BL-1023 unbookkeepable-ticket-is-reported-before-the-stages-run-03
  Scenario: the operator learns the ticket cannot be closed before the stages spend
    Given the run ticket is filed as paused
    When the run reaches the end of initiation
    Then the outcome for that ticket is already decided
    And the decision names the run ticket and the folder it was found in

  # BL-1023 parking-other-tickets-is-unaffected-04
  Scenario: rearranging the run ticket does not disturb the parked ones
    Given the run ticket is filed as paused
    And another ticket is active work
    When the run completes
    Then the other ticket is parked out of active
    And a park record names the other ticket

  # BL-1023 a-dry-run-mutates-no-backlog-file-05
  Scenario: a dry run still writes nothing
    Given the run ticket is filed as paused
    When the run completes as a dry run
    Then no backlog file has moved
