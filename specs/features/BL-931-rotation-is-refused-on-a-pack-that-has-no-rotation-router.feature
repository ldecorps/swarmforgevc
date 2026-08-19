# mutation-stamp: sha256=1e8f97634cd6c06a4624b66e88f8ede9bef92de79bd16aa35af41f8466c84f43
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-19T00:29:48.948355Z","feature_name":"a pack without rotation router never has a standing pane respawned as another role","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-931-rotation-is-refused-on-a-pack-that-has-no-rotation-router.feature","background_hash":"b9bd8403cede50f468d5cd9aefe66c1420aa292cf794e6c066d57efd5e15d5b3","implementation_hash":"unknown","scenarios":[{"index":0,"name":"rotation is decided by whether the pack rotates at all","scenario_hash":"182fe199695fc6bd5a24d4cab103b0e22b2472261e0349fe78286051315eb7d9","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-19T00:29:48.948355Z"}]}
# acceptance-mutation-manifest-end

Feature: a pack without rotation router never has a standing pane respawned as another role

  # BL-931 (swarm-reliability). Rotation exists for `config rotation router`
  # packs, where ONE resident pane serves every role in turn. Every other gate
  # in the family asks whether the pack is a router before acting:
  # ready_for_next_task.bb gates ROTATE_HOME on it, handoffd.bb gates its own
  # chase rotation and context-clear sweep on it, swarm_ensure.bb and
  # babysitter_check.bb both resolve it before judging topology.
  #
  # The resident-invoked path does not. rotate_to_role.bb ->
  # handoff-lib/respawn-as! -> handoff-lib/rotate-resident-to! asks only
  # whether the departing role left a parcel behind (BL-805/BL-926); it never
  # asks whether this pack rotates at all. It then addresses the pane through
  # mono-router-resident-session, defined as the FIRST non-coordinator
  # roles.tsv row. On a standing pack that row is not a resident - it is a role
  # with its own pane, doing its own work.
  #
  # What that pane is is the whole defect: rotation on a non-router pack does
  # not move a resident, it evicts a colleague.
  #
  # Step handlers: specs/pipeline/steps/bl931RotatePackGateSteps.js, driving
  # the rotate helpers against fixture pack confs and roles.tsv layouts. The
  # <rotation mode> and <outcome> columns are validated against explicit
  # KNOWN_VALUES, never passed through.

  Background:
    Given a swarm whose roles.tsv lists a pipeline role before the coordinator

  # BL-931 rotate-pack-gate-01
  Scenario Outline: rotation is decided by whether the pack rotates at all
    Given the pack declares <rotation mode>
    When the resident rotate helper is invoked for another role
    Then the rotation outcome is "<outcome>"

    Examples:
      | rotation mode          | outcome           |
      | config rotation router | proceed           |
      | no rotation line       | refuse-not-router |

  # BL-931 rotate-pack-gate-02
  Scenario: a refused rotation leaves the standing pane doing its own job
    Given the pack declares no rotation line
    And the first pipeline row in roles.tsv is a standing specifier pane
    When the resident rotate helper is invoked for another role
    Then no pane is respawned
    And the standing specifier pane is still running the specifier launch script
    And the active-role marker is unchanged

  # BL-931 rotate-pack-gate-03
  Scenario: the unfinished-parcel override does not unlock the pack gate
    Given the pack declares no rotation line
    And the rotate force override is set
    When the resident rotate helper is invoked for another role
    Then the rotation outcome is "refuse-not-router"
    And the refusal names the pack rather than a parcel

  # BL-931 rotate-pack-gate-04
  Scenario: the daemon's own caller is refused by result, never by an exit
    Given the pack declares no rotation line
    When the handoff daemon invokes the rotate helper directly
    Then the rotation outcome is "refuse-not-router"
    And the caller receives a result it can read rather than a process exit
