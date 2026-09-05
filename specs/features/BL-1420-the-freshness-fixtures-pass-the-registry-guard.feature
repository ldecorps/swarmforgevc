Feature: BL-1420 Every freshness-check fixture passes the fail-closed registry guard, and a refused checker is a red run

  BL-784 made daemon_log_freshness_check.sh run the registry guard first: it
  refuses when a daemon named in the required registry has no conf row, and
  when any live *_supervisor.bb script under swarmforge/scripts has no conf
  row. Three fixtures written before BL-784 point FRESHNESS_CONF at a
  one-row conf and never set FRESHNESS_REQUIRED: the BL-1011 acceptance
  handler, the BL-1012 acceptance handler, and the bl1011 attribution
  property runner. Since BL-784 closed on 2026-08-27 the guard has refused
  every one of their checker runs with "daemon 'babysitterd' has no row";
  BL-1011's feature is 0/8 and BL-1012's 0/9 on main, and the property
  runner, which spawns the checker with :continue true, turns the refusal
  into an empty observation so its properties hold vacuously. BL-1399
  repaired the bl1012 vitest fixture with the guard's own seams and left the
  guard untouched; these three were not in its scope. Found by the coder on
  BL-1413, 2026-09-05.

  This feature is that each of the three fixtures supplies its own required
  registry and one conf row per live supervisor script, derived from the
  same glob the guard walks, so the guard passes on the fixture's terms; and
  that a checker exit the property runner did not expect is a failed run,
  never an empty observation.

  # BL-1420 bl1011-acceptance-is-green-01
  Scenario: BL-1011's acceptance feature passes every scenario run on main
    Given the live swarmforge/scripts directory
    When the BL-1011 feature runs
    Then every scenario run passes
    And no run's checker output contains FRESHNESS_REGISTRY_GUARD

  # BL-1420 bl1012-acceptance-is-green-02
  Scenario: BL-1012's acceptance feature passes every scenario run on main
    Given the live swarmforge/scripts directory
    When the BL-1012 feature runs
    Then every scenario run passes
    And no run's checker output contains FRESHNESS_REGISTRY_GUARD

  # BL-1420 a-refused-checker-is-a-red-property-run-03
  Scenario: the bl1011 property runner fails a run whose checker exited non-zero
    Given a bl1011 fixture whose registry names a daemon its conf lacks
    When one property run invokes the checker
    Then the run fails naming the guard's refusal line
    And no property is evaluated over that run's empty announce

  # BL-1420 fixture-rows-follow-the-live-glob-04
  Scenario Outline: a fixture's conf carries one row per live supervisor script without editing the fixture
    Given a scratch scripts directory holding the guard, the checker and <supervisors> supervisor scripts
    When <fixture> builds its conf and registry against that directory
    Then the conf carries exactly <supervisors> supervisor rows plus the row under test
    And the guard run from that directory passes

    Examples:
      | fixture                     | supervisors |
      | the BL-1011 handler         | 2           |
      | the BL-1012 handler         | 3           |
      | the bl1011 property runner  | 2           |
