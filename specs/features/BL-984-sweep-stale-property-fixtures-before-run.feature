Feature: BL-984 a property-lane fixture run never executes a fixture it did not write

  The property-lane fixture helper generates real *.property.test.js files
  inside extension/test/ - the one directory the lane's own include glob
  collects from - so a fixture stranded by a killed run is executed by every
  later run as a false red. Cleanup after the fact cannot close this: nothing
  traps SIGKILL. The guarantee is therefore built on the way IN - sweep stale
  fixtures before writing new ones - not on the way out.

  Sweeping is deliberately narrow. It claims only files carrying the helper's
  own basename prefix, and only those whose originating run is gone; a peer
  run still working and a human's real property test are both off limits.

  Background:
    Given the property-lane fixture directory extension/test/
    And the fixture helper whose generated files match the lane include glob

  # BL-984 sweep-stale-property-fixtures-01
  Scenario: a fixture stranded by a killed run is swept before the next run
    Given a leftover fixture file named for the prefix "<prefix>" whose originating process is gone
    When the fixture helper begins a run
    Then the leftover fixture is removed before any new fixture is written
    And the run's reported verdict is decided only by the fixtures it wrote itself

    Examples:
      | prefix         |
      | bl868-fixture- |
      | bl871-fixture- |

  # BL-984 sweep-stale-property-fixtures-02
  Scenario: a fixture belonging to a still-running peer is left alone
    Given a fixture file carrying the helper's prefix whose originating process is still alive
    When the fixture helper begins a run
    Then that file is still present after the sweep

  # BL-984 sweep-stale-property-fixtures-03
  Scenario: a file the helper did not generate is never swept
    Given a property test file in the fixture directory that does not carry the helper's prefix
    When the fixture helper begins a run
    Then that file is still present after the sweep

  # BL-984 sweep-stale-property-fixtures-04
  Scenario: a run that completes normally still removes its own fixture
    Given the fixture directory holds no leftover fixtures
    When the fixture helper completes a run normally
    Then the fixture it wrote is no longer present in the fixture directory
