Feature: BL-1623 A fixture sweep never reaps a live run's temp root

  QA's BL-1609 pass (2026-09-17, full property lane) failed
  bl1309LandDecideEntanglementInvariants on an assertion: the approved
  sibling ticket the fixture had just written into its own temp root was
  read back as "no backlog ticket file found". The file is green alone.
  Its module-load sweep removes every root under the shared temp dir that
  starts with its prefix, whoever made it, so a second instance of the file
  alive on the host - another checkout's lane, a guard re-run, a solo
  re-run - deletes the first instance's live fixtures mid-test. Seven
  property files carry the same blind sweep. This feature is that a temp
  root is removed only when the pid recorded in its name is gone (or is
  this process's own, before it has written), that each of the seven files
  builds and sweeps its roots that way through one helper, and that a
  unit-lane guard over the real tree names any property file that still
  sweeps the temp dir directly. The two-instance reproduction and the full
  lane are QA's e2e steps, not scenarios (BL-1541).

  # BL-1623 fixture-sweep-never-reaps-a-live-runs-temp-root-01
  Scenario Outline: only a root whose recorded owner is gone is removed
    Given a temp root named with the sweep prefix and <owner>
    When the scoped temp-root sweep runs for that prefix
    Then the root <outcome>

    Examples:
      | owner                                   | outcome   |
      | this process's own pid                  | is removed |
      | a pid that is alive                     | survives  |
      | a pid that no longer exists             | is removed |
      | no pid at all, the pre-fix name shape   | survives  |

  # BL-1623 fixture-sweep-never-reaps-a-live-runs-temp-root-02
  # Census pin (BL-1445): the seven files are named, not derived.
  Scenario Outline: each blind-sweeping property file now records its owner and sweeps through the helper
    When the source of <file> is read
    Then it builds its temp roots with its prefix followed by its own pid
    And it sweeps through the scoped temp-root helper and never lists the temp dir itself

    Examples:
      | file                                                                  |
      | extension/test/bl1030RefusalCostsNothing.property.test.js             |
      | extension/test/bl1300SingleEnforceableBudget.property.test.js         |
      | extension/test/bl1309LandDecideEntanglementInvariants.property.test.js |
      | extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js |
      | extension/test/bl1356StampOffInvariants.property.test.js              |
      | extension/test/bl1358MutantTimeCeilingInvariants.property.test.js     |
      | extension/test/bl1359MergeChargedInvariants.property.test.js          |

  # BL-1623 fixture-sweep-never-reaps-a-live-runs-temp-root-03
  Scenario: the unit-lane guard names a blind temp-dir sweep and is clean on the real tree
    Given a fixture directory holding one property file that lists the temp dir itself and one that sweeps through the helper
    When the blind temp-dir sweep finder runs over that directory
    Then it names exactly the blind file
    And the same finder over this repository's property files names none and counts 7 migrated files
