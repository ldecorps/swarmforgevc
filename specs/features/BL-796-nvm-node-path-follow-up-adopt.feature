Feature: Daemon and cron start paths resolve node as well as bb

  The 2026-08-02 PATH bake found bb but not nvm-only node, so a freshness
  restart handed handoffd a PATH on which every node sweep failed. The
  2026-08-03 hand follow-up added shared PATH helpers (operator_path_lib.sh)
  and wired them into the checker, the daemon start script, and the cron
  installer. These scenarios pin that behaviour. They drive the real scripts
  and the real lib with stubbed binaries in a fixture tree — no cron
  installation, no live daemons, no network.

  Background:
    Given a project root with a daemon state directory
    And a fake nvm tree containing node versions "v9.11.2" and "v22.1.0"

  # BL-796 nvm-node-path-follow-up-adopt-01
  Scenario: A freshness restart hands the daemon a PATH that resolves node
    Given the freshness check is invoked with PATH set to "/usr/bin:/bin"
    When the freshness check restarts a stale daemon
    Then the restart command inherits a PATH on which "node" resolves

  # BL-796 nvm-node-path-follow-up-adopt-02
  Scenario: The daemon start script pins node before launching the daemon
    Given the daemon start script is invoked with a PATH that resolves "bb" but not "node"
    When the daemon start script launches the daemon
    Then the launched daemon inherits a PATH on which "node" resolves

  # BL-796 nvm-node-path-follow-up-adopt-03
  Scenario: The installed crontab line bakes a node directory when node is nvm-only
    Given "node" is reachable only through the fake nvm tree
    When the freshness cron is installed
    Then the crontab entry sets a PATH containing the resolved nvm node bin directory

  # BL-796 nvm-node-path-follow-up-adopt-04
  Scenario: The nvm default alias wins over a newer installed version
    Given the nvm default alias names "v9.11.2"
    When the nvm node bin directory is resolved
    Then the resolved bin directory belongs to version "v9.11.2"

  # BL-796 nvm-node-path-follow-up-adopt-05
  Scenario: Without an alias the newest version wins by version order
    Given no nvm default alias exists
    When the nvm node bin directory is resolved
    Then the resolved bin directory belongs to version "v22.1.0"

  # BL-796 nvm-node-path-follow-up-adopt-06
  Scenario: A node already on the caller's PATH is never shadowed by the nvm fallback
    Given "node" also resolves on the caller's PATH outside the nvm tree
    When the operator bins are prepended
    Then "node" resolves to the caller's node and not to an nvm one
