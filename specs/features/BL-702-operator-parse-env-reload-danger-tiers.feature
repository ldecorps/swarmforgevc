Feature: BL-702 operator parse, env-reload, and danger tiers
  Slice 1 of BL-698. Shared Cursor Remote decision core, soft light confirm,
  hard two-step confirm, /confirm-off, and swarm.env merge on relaunch.

  Background:
    Given a principal-only Cursor Remote Telegram topic
    And .swarmforge/swarm.env exists with operator keys
    And unauthorised senders and wrong topics never mutate swarm state

  Scenario: Unauthorised sender cannot run a hard-tier verb
    When an unauthorised user sends "/restart" in Cursor Remote
    Then the bridge refuses with no bounce sentinel written

  Scenario: Hard-tier verb outside Cursor Remote is ignored
    When the principal sends "/kill-all" in a non-ops topic
    Then no kill or drain runs

  Scenario: Hard-tier verb requires confirm before execute
    When the principal sends "/ensure" in Cursor Remote
    Then the bridge prompts for confirmation and does not run ensure yet
    When the principal confirms
    Then ensure runs single-flight and a summary is posted

  Scenario: Soft-tier verb needs a light confirm before run
    When the principal sends "/compile" in Cursor Remote
    Then the bridge prompts for a single Confirm tap and does not run yet
    When the principal confirms
    Then compile runs and a short result is posted

  Scenario: /confirm-off clears a pending hard confirm
    Given a pending "/bounce" confirm
    When the principal sends "/confirm-off"
    Then the pending confirm is cleared and no bounce runs

  Scenario: /restart relaunches after re-reading swarm.env
    Given swarm.env defines a key that the current host process.env lacks
    When the principal confirms "/restart"
    Then the relaunch child environment includes that key from swarm.env

  Scenario: buildLaunchEnv merges swarm.env over host process.env
    Given a repo with .swarmforge/swarm.env exporting a key absent from the host
    When buildLaunchEnv is called with that repo root
    Then the returned env includes the key from swarm.env

  Scenario: /bounce bridge reloads swarm.env like /redeploy
    When the principal confirms "/bounce bridge"
    Then the cursor bridge supervisor child is started with swarm.env merged

  Scenario: /syncenv reports key presence without values
    When the principal confirms "/syncenv"
    Then the reply names required keys as present or missing
    And the reply body contains no secret values

  Scenario: Soft-tier /pause freezes promotion via control-pause marker
    When the principal confirms "/pause"
    Then control-pause.json is active
    And no bounce sentinel is written

  Scenario: Soft-tier /resume clears the pause marker
    Given an active control pause
    When the principal confirms "/resume"
    Then control-pause.json is inactive

  Scenario: Hard-tier /stop runs kill_all_swarm after confirm
    When the principal confirms "/stop"
    Then kill_all_swarm.sh is invoked for the repo root

  Scenario: Hard-tier /start writes bounce sentinel for env-merging relaunch
    When the principal confirms "/start"
    Then a swarm bounce sentinel is written
