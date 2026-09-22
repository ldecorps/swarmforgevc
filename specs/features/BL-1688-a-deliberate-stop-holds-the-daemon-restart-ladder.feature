Feature: BL-1688 a deliberate stop holds the daemon restart ladder

  Three files say a stop was deliberate: the freshness marker BL-785
  writes, the supervisor's stop file, and the restart_history ledger
  BL-1492's budget reads. The one start owner erased all three on every
  invocation, so on 2026-09-21 the ladder restarted a deliberately
  stopped daemon 334 times in 44 minutes into a missing tmux socket. A
  heal-path start now refuses while the marker stands, only a launch that
  names itself deliberate clears the signals, the ledger survives every
  writer of the status file, and a missing socket is a skip and a
  refusal, never a dead verdict retried.

  Background:
    Given a fixture project root under a temporary directory with a daemon directory, a roles file and no tmux-socket file
    And the start owner's daemon command is replaced by a recorded fake that never launches a daemon

  # BL-1688 deliberate-stop-holds-restart-ladder-01
  Scenario: a heal-path start is refused while the stop marker stands and touches nothing
    Given the handoffd.stopped marker is present under the fixture's freshness-stopped directory
    And the supervisor's stop file is present
    And the status file carries one restart_history entry
    When the start owner is invoked with the caller "build_freshness_cli"
    Then it exits non-zero and the recorded fake is never launched
    And the start audit's last line names the handoffd.stopped marker as the reason
    And the marker, the stop file and the status file are byte-identical to before

  # BL-1688 deliberate-stop-holds-restart-ladder-02
  Scenario: a deliberate launch clears the marker and the stop file and starts
    Given the handoffd.stopped marker is present under the fixture's freshness-stopped directory
    And the supervisor's stop file is present
    When the start owner is invoked with the caller "swarmforge.sh"
    Then the marker and the stop file are gone
    And the recorded fake is launched exactly once

  # BL-1688 deliberate-stop-holds-restart-ladder-03
  Scenario: two failed starts spend the budget and the third dead verdict is the halt
    Given a supervisor whose restart budget is 2 restarts per 600000 ms
    And a start owner that fails to claim on every invocation and rewrites the status file the way the real one does
    When the supervisor acts on a "dead" verdict three times within the window
    Then the start owner is invoked exactly twice
    And the status file's restart_history carries two "failed" entries before the third verdict
    And the third verdict invokes the swarm halt once and the status file reads "halted"

  # BL-1688 deliberate-stop-holds-restart-ladder-04
  Scenario: a missing tmux socket is a supervisor skip and a daemon refusal, not a crash
    When the supervisor runs one health check against the fixture root
    Then it logs a skip naming the tmux-socket path and invokes no start owner
    And starting the daemon against the fixture root exits non-zero with one refusal line naming the tmux-socket path and no stack trace
