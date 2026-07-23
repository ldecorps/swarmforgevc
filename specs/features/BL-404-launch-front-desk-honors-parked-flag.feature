Feature: launching the front desk respects a human-authored park flag

  Background:
    Given a front-desk launch invoked via launch_front_desk.sh

  # BL-404 launch-honors-park-01
  Scenario: launch is refused while the park flag exists
    Given .swarmforge/operator/front-desk-PARKED.md exists
    When launch_front_desk.sh runs
    Then it logs that the front desk is PARKED and does not launch
    And it exits 0

  # BL-404 launch-honors-park-02
  Scenario: the park flag is left untouched by a refused launch attempt
    Given .swarmforge/operator/front-desk-PARKED.md exists
    When launch_front_desk.sh runs and refuses to launch
    Then front-desk-PARKED.md still exists afterward
    And front-desk-supervisor.stop is not removed

  # BL-404 launch-honors-park-03
  Scenario: launch proceeds normally once the park flag is removed
    Given no front-desk-PARKED.md file exists
    When launch_front_desk.sh runs
    Then it launches the front-desk trio as before

  # BL-404 launch-honors-park-04
  Scenario: an explicit unpark script removes the flag
    Given front-desk-PARKED.md exists
    When the unpark script is run
    Then front-desk-PARKED.md no longer exists
