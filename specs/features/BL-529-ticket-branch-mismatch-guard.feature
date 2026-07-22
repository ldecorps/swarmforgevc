# mutation-stamp: sha256=ffbe3646b505e695b81b82d2578c5ab1aad47f13639e78b5d861821e80d0bc33
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-22T06:26:38.859389277Z","feature_name":"Worktree branch and active claim stay aligned before each agent turn","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-529-ticket-branch-mismatch-guard.feature","background_hash":"5778b10b4b3aef5a9387edf85f194506734e82807c2006747260bf0502b39d64","implementation_hash":"unknown","scenarios":[{"index":0,"name":"Turn proceeds when branch is not ticket-specific or matches claim","scenario_hash":"ec94f8a99c89d884082f378e5e27e1d136f20bc61aae1ffc3ef1eecb0471a1b5","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-07-22T06:26:20.419572708Z"}]}
# acceptance-mutation-manifest-end

# BL-529 ticket-branch-mismatch-guard
Feature: Worktree branch and active claim stay aligned before each agent turn

  # A role's worktree branch may be a generic role branch (e.g. swarmforge-coder,
  # main), a branch named after the current ticket (e.g. BL-529), or a stale
  # branch named after a DIFFERENT previously-worked ticket (e.g. BL-526 when
  # the active claim is BL-512). The guard fires at turn-start — both when
  # ready_for_next picks up a new task and when a role resumes an in-process
  # one — and must prevent any productive work running on the wrong branch.

  Background:
    Given a SwarmForge swarm with a pipeline worktree role for "coder"
    And SWARMFORGE_HOME is set to a fixture swarm root

  # BL-529 ticket-branch-mismatch-guard-01
  Scenario Outline: Turn proceeds when branch is not ticket-specific or matches claim
    Given the coder worktree is on branch "<branch>"
    And the coder has an in-process claim for ticket "<claim_ticket>"
    When the coder begins a turn
    Then the guard passes without intervention
    And the turn proceeds normally on branch "<branch>"

    Examples:
      | branch           | claim_ticket |
      | swarmforge-coder | BL-529       |
      | main             | BL-512       |
      | BL-529           | BL-529       |

  # BL-529 ticket-branch-mismatch-guard-02
  Scenario: Mismatch detected when branch names a different ticket than the claim
    Given the coder worktree is on branch "BL-526"
    And the coder has an in-process claim for ticket "BL-512"
    When the coder begins a turn
    Then the guard detects the branch "BL-526" conflicts with claim "BL-512"

  # BL-529 ticket-branch-mismatch-guard-03
  Scenario: Clean-worktree mismatch is auto-corrected before the turn starts
    Given the coder worktree is on branch "BL-526"
    And the coder has an in-process claim for ticket "BL-512"
    And the coder worktree has no uncommitted changes
    When the coder begins a turn
    Then the coder worktree is no longer on branch "BL-526"
    And the turn proceeds on a branch consistent with claim "BL-512"
    And no productive turn ran on the mismatched branch

  # BL-529 ticket-branch-mismatch-guard-04
  Scenario: Dirty-worktree mismatch refuses the turn and requeues the task
    Given the coder worktree is on branch "BL-526"
    And the coder has an in-process claim for ticket "BL-512"
    And the coder worktree has uncommitted changes
    When the coder begins a turn
    Then the in-process task for "BL-512" is moved back to new/
    And the turn is refused
    And a warning is logged naming the branch "BL-526" and claim "BL-512"
    And no productive turn ran on the mismatched branch
