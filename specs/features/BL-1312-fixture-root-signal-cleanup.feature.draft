Feature: A fixture root survives SIGTERM whenever no other step file happens to install a reaper

  mkSocketFixtureRoot hands out fixture roots and promises to remove the
  stragglers, reaping any fixture tmux server by socket path first. It keeps
  that promise with a bare process.on('exit') handler, which Node does not
  run when the process is terminated by SIGTERM or SIGINT. The cleanup
  therefore fires only by accident: when some unrelated step file loaded in
  the same process installed fixtureReaper's own signal handlers, whose
  handler calls process.exit(1) and so happens to unwind the 'exit' hook.
  Load a process that uses the helper alone and the root - and any tmux
  server under it - is left behind. This is BL-458's own finding, quoted in
  fixtureReaper's header comment, reproduced in the shared helper that 90
  step files depend on.

  # BL-1312 fixture-root-signal-01
  Scenario Outline: a fixture root is removed on an abnormal-exit signal however the process is loaded
    Given another step file has <other_handler> installed a fixtureReaper handler
    And a node process has created a fixture root with mkSocketFixtureRoot
    When the process is sent <signal>
    Then the fixture root no longer exists

    Examples:
      | signal  | other_handler |
      | SIGTERM | not           |
      | SIGTERM | already       |
      | SIGINT  | not           |

  # BL-1312 fixture-root-signal-02
  Scenario: signal cleanup is installed once per process, not once per root
    Given a node process has created four fixture roots with mkSocketFixtureRoot
    Then the process has exactly one SIGINT listener and one SIGTERM listener
