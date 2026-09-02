Feature: Stamp-off review of the RC-repair stale-marker hotfix

  BL-848 review-only certification of landed commit 195de28861. `swarm
  ensure`'s RC repair classified the first roles.tsv row as the mono-router
  resident and handed the RC check the launch script named by
  `.swarmforge/mono-router-active-role` - a leftover `coordinator` from the
  morning's router run. It then read the specifier pane against
  coordinator.sh's flag, called it degraded, and respawned coordinator.sh INTO
  the specifier session: a duplicate coordinator, zero specifiers, the
  specifier inbox backing up silently. Twice on 2026-09-02, plus the 17:30
  ensure.

  These scenarios confirm or refute what landed; none may rewrite it, and none
  writes a certify or waive decision into backlog/hotfix-ledger.yaml - only a
  recorded human decision does that.

  Background:
    Given a leftover resident marker naming a role other than the pane's own

  # BL-1346 swarm-stamp-rc-launch-role-stale-marker-01
  Scenario: The RC repair no longer respawns the marker's role into another pane
    Given a standing pack whose panes are correctly staffed
    When the RC repair runs
    Then no pane is respawned

  # BL-1346 swarm-stamp-rc-launch-role-stale-marker-02
  Scenario: A genuinely down pane is still repaired, with its own role
    Given a standing pack with one pane down
    When the RC repair runs
    Then that pane is respawned with the role its pack assigns it

  # BL-1346 swarm-stamp-rc-launch-role-stale-marker-03
  Scenario: The marker still governs a rotation-router pack
    Given a rotation-router pack whose resident pane is down
    When the RC repair runs
    Then the resident is respawned as the role the marker names

  # BL-1346 swarm-stamp-rc-launch-role-stale-marker-04
  Scenario: The resident role comes from the one shared decision
    When the RC repair resolves which role a pane should run
    Then it resolves through the shared resident-role decision, not a local rule

  # BL-1346 swarm-stamp-rc-launch-role-stale-marker-05
  Scenario: The stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
