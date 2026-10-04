Feature: BL-1974 The fixture sweep never selects a live run's fixture from a partial ps line

  BL-1287's sweep selects a temp-path cloudflared fixture when the run that
  created it is no longer alive. It reads the creator's pid from the
  tunnel name in the fixture's ps line, and when no pid can be read it
  selects the fixture anyway, so a fixture from before BL-1287 is still
  cleared. On 2026-10-04 its property test found a live run's fixture
  selected (creatorAlive=true, selected=true), in a loaded property lane;
  the same file was green in earlier runs that night. Three ways a live
  run's fixture can reach that fallback, or look dead: ps cuts command
  lines to COLUMNS when it is set (measured: 246 characters become 81 at
  COLUMNS=80), so the pid can fall off the end; a fixture caught before its
  exec still shows its spawner's bash -c line, which carries no pid; and a
  ps that fails to run at all is read as the creator having exited.

  Background:
    Given a fixture cloudflared under the OS temp directory whose tunnel name records a live creating run

  # BL-1974 a-cut-ps-line-is-never-read-as-an-unknown-creator-01
  Scenario: a fixture line longer than the terminal width is read whole
    Given COLUMNS is 80 and the fixture's ps line is longer than 80 characters
    When the sweep selects leaked fixtures
    Then the fixture is not selected

  # BL-1974 a-spawner-line-is-not-a-fixture-02
  Scenario: a fixture still showing its spawner's bash -c line is not selected
    Given the fixture's ps line is still its spawner's bash -c command line
    When the sweep selects leaked fixtures
    Then the fixture is not selected

  # BL-1974 a-ps-that-cannot-run-is-not-a-dead-creator-03
  Scenario: a creator whose state ps cannot report is not read as gone
    Given ps fails to run when the sweep asks for the creator's state
    When the sweep selects leaked fixtures
    Then the fixture is not selected

  # BL-1974 a-dead-creators-fixture-is-still-selected-04
  Scenario: a fixture whose creating run has exited is still selected
    Given the fixture's creating run has exited
    When the sweep selects leaked fixtures
    Then the fixture is selected
