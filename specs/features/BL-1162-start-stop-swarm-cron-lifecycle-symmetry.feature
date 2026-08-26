Feature: start-swarm installs every swarmforge cron for a root and stop-swarm removes them all

  # BL-1162: BL-785 closed freshness resurrection on stop only. Schedule start/stop
  # lines under .swarmforge/operator/*-start.sh remain armed after ./stop-swarm.sh,
  # so night-start / day-shift-bedtime can wake or stop the stack the operator
  # deliberately halted. Human directive (verbatim): "start-swarm should ensure
  # necessary cron jobs are in place. Conversely, and that's very important,
  # stop-swarm should ensure they are disabled."

  Background:
    Given a fixture host user crontab seam
    And a fixture swarm root R with operator schedule scripts present

  # BL-1162 stop-removes-all-root-lines-01
  Scenario: stop-swarm leaves no swarmforge cron lines scoped to root R
    Given the user crontab has freshness and schedule start stop lines for root R
    And the swarm for root R is up
    When the operator runs stop-swarm.sh for root R
    Then crontab -l contains no line with a swarmforge marker or path scoped to root R
    And no scheduled script under root R .swarmforge operator can fire for root R

  # BL-1162 start-ensures-required-lines-02
  Scenario: start-swarm ensures required swarmforge cron lines for root R
    Given the user crontab has no swarmforge lines for root R
    And operator conf selects a shift schedule for root R
    When the operator runs start-swarm.sh for root R
    Then crontab -l contains the freshness line for root R
    And crontab -l contains the rendered start and stop schedule lines for root R

  # BL-1162 deliberate-stop-survives-tick-03
  Scenario: a deliberate stop survives the next freshness and schedule cron ticks
    Given stop-swarm.sh for root R completed successfully
    When two minutes elapse
    And the next schedule boundary passes if any schedule line had remained
    Then handoffd and babysitterd for root R are still down
    And nothing has invoked start-swarm.sh for root R

  # BL-1162 multi-root-isolation-04
  Scenario: stop-swarm for one root leaves sibling root cron lines unchanged
    Given the user crontab has swarmforge lines for roots R1 and R2
    When the operator runs stop-swarm.sh for root R1
    Then crontab -l still contains every swarmforge line scoped to root R2
    And crontab -l contains no swarmforge line scoped to root R1
