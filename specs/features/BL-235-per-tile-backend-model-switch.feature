# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T08:07:42.966439107Z","feature_name":"switch one tile's backend/model on the fly, respawning just that role","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-235-per-tile-backend-model-switch.feature","background_hash":"0dd637ff36f3fa1678f95007a193c246ebfce5f7659cb95c543ea035f559cace","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: switch one tile's backend/model on the fly, respawning just that role

  # Roadmap gap (coordinator scan 2026-07-10): M5 / Spec.MD "Change an agent's
  # backend/model on the fly" (lines 575-661). A per-tile backend/model dropdown
  # rewrites that one window's launch command in the IN-MEMORY config and respawns
  # only that role's agent on the new choice; no other agent is affected;
  # swarmforge.conf on disk is untouched. Conceptually "switch model" and "switch
  # backend" are the same respawn operation, but this slice delivers the MODEL
  # switch (same backend). Cross-BACKEND switching (e.g. an external CLI backend
  # <-> the in-process vscode.lm runtime, which have different process lifecycles)
  # is a DEFERRED slice, parked in
  # BL-235-per-tile-backend-model-switch.cross-backend.feature.draft. The
  # provider/backend abstraction this rides on is already done
  # (BL-130/BL-142/BL-206-208). Explicitly M5 — a paused proposal, NOT
  # Milestone-1 work (M1 excludes per-tile respawn/model-switch controls).

  Background:
    Given a running swarm with a tiled agent panel, each tile bound to one role's agent

  # BL-235 switch-respawns-that-role-01
  Scenario Outline: switching a tile's backend/model respawns only that role on the new choice
    Given the tile for a role whose agent runs on "<from>"
    When the operator picks "<to>" from that tile's backend/model dropdown
    Then that role's agent is respawned on "<to>" in its existing worktree
    And no other role's agent is respawned

    Examples:
      | from            | to              |
      | claude-sonnet-5 | claude-opus-4-8 |

  # BL-235 in-memory-not-persisted-02
  Scenario: the switch changes only the in-memory launch command, not swarmforge.conf
    Given a role's agent switched to a new backend/model via its tile
    When the swarm config on disk is inspected
    Then swarmforge.conf is unchanged and the swap lives in the in-memory config only

  # BL-235 respawn-resumes-work-03
  Scenario: the respawned agent re-reads its instructions and resumes its in-process work
    Given a role holding an in-process task
    When its tile's backend/model is switched and the agent respawns
    Then the respawned agent re-reads the constitution and its role prompt
    And it resumes the same in-process task without losing it

  # BL-235 dropdown-lists-configured-04
  Scenario: the dropdown offers the configured backends and models
    Given the swarm's configured backends and models
    When the operator opens a tile's backend/model dropdown
    Then it lists those backends and models as options
