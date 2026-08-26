Feature: outage_failover_cli is load-file safe and still runnable as entrypoint

  # BL-1150: handoffd load-files outage_failover_cli.bb; a bare (-main) exited
  # the daemon. Guard -main to babashka entrypoint only.

  Background:
    Given the outage_failover_cli.bb script under swarmforge/scripts

  # BL-1150 load-file-01
  Scenario: load-file of the CLI does not exit the process
    When a harness load-files outage_failover_cli.bb
    Then the harness process is still alive
    And -main was not invoked

  # BL-1150 load-file-02
  Scenario: Running the CLI as a bb entrypoint still reaches usage or command dispatch
    When outage_failover_cli.bb is run as a babashka entrypoint with no command
    Then usage is printed or the process exits through -main intentionally
