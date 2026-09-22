Feature: BL-1692 the freshness CLI test waits for the front-desk status, not its pid file

  The front-desk supervisor writes its pid file at start and stamps each
  child's build_sha into its status file on its first tick, about a
  second later. test_build_freshness_cli.sh case 02/03 waited for the pid
  file and read the freshness report inside that window, so it has been
  red on main since at least 2026-09-02 with nothing wrong in the code.
  Every launch site in the file now waits for the status file to carry a
  build_sha for both children before its first read. The green run of
  the file is QA's e2e step, not a scenario: a launcher-driven runner
  does not fit the per-mutant ceiling.

  Background:
    Given the source of swarmforge/scripts/test/test_build_freshness_cli.sh is read

  # BL-1692 freshness-test-waits-for-status-01
  Scenario: case 02/03 reads its first report only after the status file carries both children's build_sha
    When the merged-code-reaches-daemons-02/03 case is located
    Then between its front-desk launch and its first report read it waits on front-desk-supervisor.status.json carrying a build_sha for bridge and for bot
    And it never reads a report with only the pid-file wait before it

  # BL-1692 freshness-test-waits-for-status-02
  Scenario: every launch site in the file uses the same status readiness wait
    When the front-desk launch sites in the file are counted
    Then there are exactly 3 of them
    And each is followed by the status readiness wait before any report or status read
