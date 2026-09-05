# mutation-stamp: sha256=6add5a6737a3ab645fbcef11c5fd23dffe05ad5fd6c6ecb1b6b2216ddc9619b0
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T19:11:49.605673957Z","feature_name":"A fixture root survives SIGTERM whenever no other step file happens to install a reaper","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1312-fixture-root-signal-cleanup.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a fixture root is removed on an abnormal-exit signal however the process is loaded","scenario_hash":"1ecb4f4b8fc61e97a181932cbce43cdcd33e2aa97f9c30d34235ce8f81753913","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-05T19:11:49.605673957Z"}]}
# acceptance-mutation-manifest-end

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
