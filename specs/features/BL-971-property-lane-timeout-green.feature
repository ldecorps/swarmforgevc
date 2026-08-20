Feature: BL-971 property lane is green again - no wall-clock exhaustion under swarm load

  The property lane (test:properties, its own lane per engineering rules) is
  standing-red, and every failure is wall-clock exhaustion rather than an
  assertion failure - bl868PropertyLaneIsolationGuards (126s against a 60s
  budget), bl632CommitTimeGuardInvariants (154s against 90s), and
  bl760DuplicateChainGuard (240s, the whole shared subprocess-heavy budget),
  all measured on the swarm host under full load. A permanently red lane
  makes every QA pass an attribution exercise and masks real regressions in
  the invariant areas the failing files protect.

  Background:
    Given the extension property lane runner and its config "extension/vitest.properties.config.mjs"

  # BL-971 property-lane-timeout-green-01
  Scenario Outline: a formerly timing-out property file passes within budget under live swarm load
    Given the swarm host is under its normal live load
    When the property lane runs scoped to "<file>"
    Then the run exits green with zero wall-clock exhausted tests

    Examples:
      | file                                             |
      | test/bl868PropertyLaneIsolationGuards.property.test.js |
      | test/bl632CommitTimeGuardInvariants.property.test.js   |
      | test/bl760DuplicateChainGuard.property.test.js         |

  # BL-971 property-lane-timeout-green-02
  Scenario: a subprocess-spawning property test's budget states its measured basis
    Given the property test files named in scenario 01
    When their explicit per-test timeout declarations are inspected
    Then each budget is accompanied by a stated measured per-case cost and headroom rationale
