# mutation-stamp: sha256=d2a495701deea4d44a7e364ebab7ed6fa0c8f57ddd0215a275afc00810bf2422
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T14:53:17.916702085Z","feature_name":"BL-1070 a pane's liveness verdict reads the whole tree under it, not one generation","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1070-pane-liveness-misses-a-claude-below-the-first-generation.feature","background_hash":"977aa89e15a7554f7702e7c112ab4159ff5fa2cb7dd177fc25efbd42770d2225","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the agent is found wherever it sits under the pane","scenario_hash":"5d6e72bc26820814b36079153dabfd2aa1edf371405f191f798d188fc89ccaf7","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:53:17.916702085Z"},{"index":3,"name":"a check gated on liveness runs, or says it could not","scenario_hash":"e726efde1ea4cbf8083514679eeb57341a5f4d5f9df12ced69a76e9744ccc5bd","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:53:17.916702085Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1070 a pane's liveness verdict reads the whole tree under it, not one generation
  The babysitter decides a role is alive by looking for a claude process whose
  PPID equals the pane's pid - the FIRST generation only. Every role in this
  pack launches as pane `sh` -> `zsh <role>.sh` -> `claude`, so claude sits one
  generation lower and the predicate answers false for every healthy agent.

  Measured on this host 2026-08-22: all eight panes match that shape, and
  babysitterd.log at 16:24:46Z carries CRIT "pane alive but NO claude process
  under it (half-launch/exit)" for all eight roles at once, then NUDGED
  coordinator with 8 findings - while all eight agents were working.

  The verdict also gates the remote-control check, which therefore cannot run
  at all: a check silenced by another check's false negative reports nothing
  rather than reporting that it did not run.

  Background:
    Given a role pane the pack launched and whose agent is working

  # BL-1070 pane-liveness-depth-01
  Scenario Outline: the agent is found wherever it sits under the pane
    Given the claude process sits "<depth>"
    When the babysitter decides whether the role is alive
    Then the role is reported "<verdict>"

    Examples:
      | depth                          | verdict |
      | one generation below the pane  | alive   |
      | two generations below the pane | alive   |
      | three generations below the pane | alive |
      | nowhere under the pane         | absent  |

  # BL-1070 pane-liveness-scope-02
  Scenario: another role's agent never stands in for a missing one
    Given the claude process sits "nowhere under the pane"
    And another role's pane has a working agent under it
    When the babysitter decides whether the role is alive
    Then the role is reported "absent"

  # BL-1070 pane-liveness-gather-03
  Scenario: a failed process gather is still unavailable, never absence
    Given the process gather fails this sweep
    When the babysitter decides whether the role is alive
    Then the role is reported "unavailable"
    And no half-launch alert is raised for it

  # BL-1070 pane-liveness-gated-check-04
  Scenario Outline: a check gated on liveness runs, or says it could not
    Given the claude process sits "<depth>"
    And it was started without the remote-control flag
    When the babysitter runs its remote-control check
    Then the operator is told "<told>"

    Examples:
      | depth                          | told                       |
      | one generation below the pane  | remote control is degraded |
      | two generations below the pane | remote control is degraded |
      | nowhere under the pane         | the check could not be run |
