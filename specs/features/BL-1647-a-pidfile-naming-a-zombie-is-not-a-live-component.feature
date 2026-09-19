Feature: BL-1647 A pidfile naming a zombie is not a live component

  Bedtime's verify decides whether a pidfile-owned component is still up
  with kill -0, which succeeds on a process that has exited but not yet been
  reaped. test_finish_shift_lib.sh case 08 kills the fixture's front-desk
  process inside a command substitution, where the parent's child cannot be
  waited for, so whether the verify sees it dead depends on how fast the
  parent shell reaps it; under host load it sometimes does not, and the
  case flips red. After this parcel a zombie is not alive to the pidfile
  liveness helper, the case makes the death observable before the verify
  runs, and a new case pins the zombie mechanism.

  Background:
    Given a fixture root under a temporary directory with the finish-shift library loaded and its operator pidfiles pointing at fixture processes

  # BL-1647 a-zombie-pidfile-owner-is-not-running-01
  Scenario Outline: a pidfile naming an exited but unreaped process reads as not running
    Given the <component> pidfile names a fixture process that was killed inside a command substitution and not reaped
    When the component's liveness is read through the finish-shift library
    Then the <component> is reported as not running

    Examples:
      | component  |
      | front-desk |
      | onboarder  |
      | tunnels    |

  # BL-1647 a-live-pidfile-owner-still-reads-as-running-02
  Scenario: a pidfile naming a live process still reads as running
    Given the front-desk pidfile names a fixture process that is alive
    When the component's liveness is read through the finish-shift library
    Then the front-desk is reported as running

  # BL-1647 the-library-test-is-green-once-with-its-census-pinned-03
  Scenario: the finish-shift library test passes once and carries the zombie case
    When swarmforge/scripts/test/test_finish_shift_lib.sh runs once
    Then it reports PASS=13 FAIL=0
    And its passing lines include case 08 and a case 09 naming a zombie pidfile owner
