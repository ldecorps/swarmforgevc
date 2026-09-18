Feature: BL-1636 A step handler never leaks its temp root

  Of the 1191 acceptance step handlers, 583 create a temp root with
  mkdtemp and 455 never register it for reaping, so the host's temp
  directory holds 686,946 leaked handler roots, gains about 48,000 a day,
  and every one of the 35 code paths that list it pays 2.6 seconds per
  listing. The cleaner fixed the fifth such leak by hand this session. The
  rule and the reaper primitive exist; the gate does not. This feature is
  that a standing guard refuses any handler that creates a root without
  registering it, that its census of today's offenders can only shrink,
  that the real tree names no new offender, and that an age-floored reap
  removes dead roots while keeping young ones and any root with a live
  owner. The one host-wide reap is QA's e2e step, not a scenario (BL-1541).

  # BL-1636 step-handler-never-leaks-its-temp-root-01
  Scenario: an unregistered temp root is an offender and a registered one is not
    Given a fixture handler directory holding one handler that creates a temp root and never registers it and one that registers its root with the fixture reaper
    When the temp-root guard scans that directory against an empty census
    Then it names the unregistering handler as an offender
    And it does not name the registering handler

  # BL-1636 step-handler-never-leaks-its-temp-root-02
  Scenario: a census entry that no longer offends fails the guard until it is removed
    Given a fixture handler directory holding one handler that registers its root with the fixture reaper
    And a census naming that handler as an offender
    When the temp-root guard scans that directory against that census
    Then it fails naming the stale census entry

  # BL-1636 step-handler-never-leaks-its-temp-root-03
  Scenario: the real handler tree names no new offender and the census pins its population
    When the temp-root guard scans specs/pipeline/steps against the committed census
    Then it names no offender outside the census
    And the census names at least 400 handlers

  # BL-1636 step-handler-never-leaks-its-temp-root-04
  Scenario Outline: the reap removes only a dead root older than the floor
    Given a fixture temp directory holding a bl-prefixed root that is <root>
    When the stale temp-root reap runs on that directory with a floor of 24 hours
    Then the root <outcome>

    Examples:
      | root                                       | outcome    |
      | two days old with no owner pid in its name | is removed |
      | one hour old with no owner pid in its name | survives   |
      | two days old and named for a live pid      | survives   |
