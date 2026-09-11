Feature: BL-1524 The daemon's load closure routes its four stray subprocess calls through the chokepoint

  The standing gate in daemon_cycle_guard_lib_test_runner.bb walks handoffd.bb's
  load-file closure and bans babashka.process and clojure.java.shell everywhere
  but daemon_cycle_guard_lib.bb, the bounded chokepoint BL-967 built after an
  unbounded subprocess wait deadlocked the daemon. Its load-closure assertion
  has been red on main since ceda945b23 (2026-08-25): process_table_lib.bb,
  model_factory_store.bb, outage_failover_store.bb and handoff_lib.bb each call
  the subprocess API directly. This feature is that the four sites run under
  the chokepoint and the gate earns its green from the files themselves - the
  closure is not shrunk and the ban's exempt set is not widened. The runner's
  other two assertions belong to BL-1525 and BL-1526 and are not asserted here.

  # BL-1524 load-closure-strays-through-chokepoint-01
  Scenario: the gate's load-closure assertion passes without shrinking the closure
    When the daemon cycle guard test runner runs on the real swarmforge/scripts tree
    Then its output has no FAIL line naming the load-closure assertion "invariant 1 structural half"
    And its closure census line reports more than 60 files

  # BL-1524 load-closure-strays-through-chokepoint-02
  Scenario Outline: a formerly stray file names no banned subprocess API and is still loaded by the daemon
    When the subprocess-API ban scan runs over <file> alone
    Then it reports zero offenders
    And <file> is still in handoffd.bb's load-file closure

    Examples:
      | file                     |
      | process_table_lib.bb     |
      | model_factory_store.bb   |
      | outage_failover_store.bb |
      | handoff_lib.bb           |

  # BL-1524 load-closure-strays-through-chokepoint-03
  Scenario Outline: a converted wait returns at the bound when its child never exits
    Given the subprocess wait bound is 300 milliseconds
    And a fake <child> that sleeps for 600 seconds
    When <site> is invoked against that fake
    Then the call returns within 5 seconds with a non-zero exit
    And no process of the fake <child> is still alive

    Examples:
      | site                                       | child              |
      | model-factory-store's invoke-launch-seam!  | launch seam script |
      | outage-failover-store's respawn-seat!      | tmux on PATH       |

  # BL-1524 load-closure-strays-through-chokepoint-04
  Scenario: the ban is not blunted to earn the green
    When the subprocess-API ban scan's default exempt set is read
    Then it names only daemon_cycle_guard_lib.bb
    And a scratch closure holding one file with a direct process/sh call outside the chokepoint is still reported
