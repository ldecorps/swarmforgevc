Feature: The freshness tests read a pinned fixture, not the operator's live conf

  `swarmforge/scripts/daemon_log_freshness.conf` is, by its own header, "the
  one declared place" an operator tunes how long a daemon may go quiet before
  the watchdog kills and restarts it. It exists to be changed.

  Both freshness shell tests bind their conf seam straight to that live file,
  then stage a handoffd heartbeat 200 seconds old and assert a restart fires.
  That assertion only holds while the shipped threshold stays at 120. Every
  other seam in those tests is injected - root, clock, incident file, cool-off,
  and the announce, kill and start commands - so the conf is the single seam
  left pointing at production.

  The consequence is a false red: an operator raising handoffd's threshold
  during a noisy window turns the suite red for a reason that has nothing to
  do with the code under test, and the next role to see it spends a turn
  diagnosing the wrong thing.

  Background:
    Given the freshness shell tests and the operator's live threshold conf

  # BL-1000 ops-raise-does-not-redden-the-suite-01
  Scenario Outline: Raising the live threshold leaves the suite green
    Given the operator has raised handoffd's live threshold above the staged staleness
    When <test_file> runs
    Then it passes
    Examples:
      | test_file                               |
      | test_daemon_log_freshness.sh            |
      | test_bl785_freshness_deliberate_stop.sh |

  # BL-1000 shipped-restart-behaviour-unchanged-02
  Scenario: The restart assertions still hold against the pinned threshold
    When the freshness suite runs
    Then a handoffd heartbeat older than the pinned threshold is killed and restarted
    And the durable record names the daemon, its age and the restart action

  # BL-1000 every-conf-a-test-reads-is-tracked-03
  Scenario: A conf the tests depend on survives a fresh checkout
    Given a checkout containing only files tracked in git
    When the freshness suite runs
    Then every conf the tests read is present
