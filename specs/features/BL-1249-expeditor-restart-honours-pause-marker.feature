Feature: BL-1249 the expeditor declines to restart the swarm while an operator hold is in force

  The expeditor's final phase runs the start command whenever the caller did
  not pass --no-restart, and consults no operator state at all. On 2026-08-28
  a run for BL-1248 brought the whole pack up at 14:30 BST against a human
  directive given at 10:54Z ("Hold restart, do not push, wait for QA") and
  against a standing ops hold that had blocked restart across eleven readings.
  The restart also rearmed the master-main-reconcile sweep BL-1236 pins as
  broken. A hold recorded on the host must reach the one phase that acts on
  it, and declining must be as loud as failing - a quiet decline is
  indistinguishable from a swarm that came up.

  # IR-DRY: one finding reviewed and deliberately not extracted. The marker
  # Given appears as a bound value in scenarios 01, 02 and 04 and as a
  # placeholder in the outline; they are the same step and a handler with a
  # parameter matches both. Hoisting it into Background is impossible - the
  # outline exists to vary exactly that value.

  Background:
    Given an expedite run whose stages have all passed
    And a stubbed start command that records whether it ran

  # BL-1249 expeditor-restart-honours-pause-marker-01
  Scenario: a hold stops the start command from running at all
    Given the operator pause marker is "holding"
    When the expeditor reaches its restart phase
    Then the start command does not run

  # BL-1249 expeditor-restart-honours-pause-marker-02
  Scenario: a held restart is reported as held, not as one the caller declined
    Given the operator pause marker is "holding"
    When the expeditor reaches its restart phase
    Then the run report names the marker that caused the hold
    And the reported outcome differs from the outcome of a run invoked with "--no-restart"

  # BL-1249 expeditor-restart-honours-pause-marker-03
  Scenario Outline: only an absent or positively inactive marker permits the restart
    Given the operator pause marker is <marker>
    When the expeditor reaches its restart phase
    Then the start command <outcome>

    Examples:
      | marker              | outcome      |
      | absent              | runs         |
      | positively inactive | runs         |
      | holding             | does not run |
      | malformed           | does not run |
      | truncated           | does not run |

  # BL-1249 expeditor-restart-honours-pause-marker-04
  Scenario: a hold reports, and never retracts the ticket verdict
    Given the operator pause marker is "holding"
    When the expeditor reaches its restart phase
    Then the ticket verdict for the run is still a pass
