Feature: BL-1690 the freshness cron checker runs under the shell its env files are written in

  The installed BL-675 cron line ran the freshness checker under /bin/sh,
  and the checker sourced the operator's env files POSIX-style, while the
  swarm's own launcher sources the same files under bash. On Linux that
  printed "[[: not found" on every 2-minute run and evaluated bash guards
  backwards. The checker now runs under bash, bash-3.2-clean, so a "[["
  in an operator env file is neither an error line nor a reversed guard.

  Background:
    Given a fixture project root under a temporary directory
    And the fixture's swarm.env keeps a sentinel variable behind a bash "[[ ... ]] || unset" guard and exports another inside a bash "if [[ ... ]]" block

  # BL-1690 freshness-checker-runs-under-bash-01
  Scenario: the checker run the way the installed cron line runs it prints no shell error and honours the guards
    When the freshness checker is run for the fixture root with the interpreter the composed cron line names
    Then its combined output contains no line ending in "not found"
    And the sentinel variable is kept and the exported variable is set for the checker's own work

  # BL-1690 freshness-checker-runs-under-bash-02
  Scenario: the composed cron line names bash, and its marker comment is unchanged
    When the crontab line is composed for the fixture root without writing any crontab
    Then it runs the checker under bash
    And it ends with the BL-675 marker comment naming the fixture root
