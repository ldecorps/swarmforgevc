# mutation-stamp: sha256=cd09c995e5007c0e271499785dc089fe119caa81aecedc4014693b784f6ec937
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-10T22:47:52.700982Z","feature_name":"Freshness and bridge supervision survive a cron environment and a slow host","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-789-mac-host-switch-freshness-bridge-adopt.feature","background_hash":"4f9069c57bd37c83cd2105ff127ba44c0f1d13a85622a2dd512238ace9fbe53d","implementation_hash":"unknown","scenarios":[{"index":1,"name":"A deliberately disabled daemon is never restarted","scenario_hash":"c98fcb8bdfec4492b913d938ea2c62c007e909e362b53c68171bd21b2206cdb8","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-10T22:47:52.700982Z"}]}
# acceptance-mutation-manifest-end

Feature: Freshness and bridge supervision survive a cron environment and a slow host

  The 2026-08-02 Mac host-switch hotfix fixed three false failure modes by hand:
  a freshness cron that could not find its interpreter, restart spam against a
  deliberately disabled daemon, and a bridge supervisor that fought an orphan
  listener. These scenarios pin that behaviour. They drive the real scripts with
  stubbed binaries on PATH — no cron, no live daemons, no network.

  Background:
    Given a project root with a daemon state directory
    And a stub interpreter that is reachable only outside the minimal cron PATH

  # BL-789 mac-host-switch-freshness-bridge-adopt-01
  Scenario: The freshness check finds its interpreter under a minimal cron PATH
    Given the freshness check is invoked with PATH set to "/usr/bin:/bin"
    When the freshness check runs
    Then it resolves the stub interpreter
    And it does not report the daemon as down for a missing interpreter

  # BL-789 mac-host-switch-freshness-bridge-adopt-02
  Scenario Outline: A deliberately disabled daemon is never restarted
    Given the swarm environment sets "<setting>"
    When the freshness check runs
    Then the babysitter daemon restart is "<outcome>"
    And no restart warning for that daemon is logged

    Examples:
      | setting                       | outcome  |
      | SWARMFORGE_SKIP_BABYSITTERD=1 | skipped  |
      | SWARMFORGE_SKIP_BABYSITTERD=0 | attempted|

  # BL-789 mac-host-switch-freshness-bridge-adopt-03
  Scenario: The installed crontab line carries its own PATH
    When the freshness cron is installed
    Then the crontab entry sets a PATH containing the interpreter's directory
    And the crontab entry names the project root

  # BL-789 mac-host-switch-freshness-bridge-adopt-04
  Scenario: A healthy bridge listener already on our port is adopted, not fought
    Given a healthy bridge process is listening on the bridge port
    And the supervisor's tracked process id is dead
    When the supervisor takes its next turn
    Then the supervisor adopts the listening process
    And no second bridge process is spawned

  # BL-789 mac-host-switch-freshness-bridge-adopt-05
  Scenario: A non-bridge listener on our port is cleared before spawning
    Given an unrelated process is listening on the bridge port
    When the supervisor takes its next turn
    Then the supervisor frees the port
    And a bridge process is spawned

  # BL-789 mac-host-switch-freshness-bridge-adopt-06
  Scenario: A slow cycle is distinguishable from a wedged one
    Given the handoff daemon begins a cycle that outlasts the freshness window
    When the freshness check runs mid-cycle
    Then a heartbeat from the cycle's start is visible
    And the daemon is not reported as wedged
