Feature: BL-1498 The supervisor test is green under the operator's zsh startup files and the startup grace

  test_handoffd_supervisor.sh fakes tmux at the front of PATH and asserts the
  daemon-death halt reached it. The halt runs swarm-cleanup.sh, a zsh script,
  and zsh sources the operator's ~/.zshenv for every invocation - since
  2026-08-22 that file prepends a directory holding a real tmux, so the fake
  never logs kill-session. Independently, the 2026-09-02 startup grace reads
  the lingering-pid case's freshly written pid file as a newborn daemon, so a
  hung pid is healthy and never terminated. This feature is that the fixture
  isolates zsh startup files and presents a daemon older than one stall
  window, while the grace itself keeps its contract, so the file exits zero
  on main from the checkout it is run in.

  # BL-1498 halt-reaches-the-fixture-tmux-under-a-hostile-zsh-startup-file-01
  Scenario: the dead-daemon and messy-death halts reach the fixture's tmux although a zsh startup file prepends another tmux
    Given a zsh startup directory in the harness environment whose startup file prepends a directory holding a tmux that logs nowhere
    When the supervisor test runs under that environment
    Then it reports the dead-daemon halt case as passed
    And it reports the messy-death halt case as passed

  # BL-1498 startup-grace-keeps-its-contract-02
  Scenario Outline: a lingering live pid with stalled delivery is judged by its pid file's age against one stall window
    Given a supervisor fixture whose delivery is stalled past the window and whose pid names a live process that is not the daemon
    And the pid file is <pid_file_age> than one stall window
    When the supervisor checks once
    Then the status reads <state>
    And the lingering process is <fate>

    Examples:
      | pid_file_age | state   | fate       |
      | younger      | healthy | still alive |
      | older        | halted  | terminated |

  # BL-1498 the-file-exits-zero-from-the-checkout-it-runs-in-03
  Scenario: the supervisor test passes every case with the process environment as it is
    Given the process environment as the acceptance run inherits it
    When the supervisor test runs
    Then it exits zero
    And it reports every case as passed
