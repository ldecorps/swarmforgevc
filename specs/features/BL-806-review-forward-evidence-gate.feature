# mutation-stamp: sha256=59edd3c38ef6aae2ba2f0c3f15e3703a76281190ca4b4b625558af3ffefac9a2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-15T04:17:41.598970Z","feature_name":"BL-806 a review role's forward must name its own pass commit, never the bare received hash","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-806-review-forward-evidence-gate.feature","background_hash":"a890699b46bf97c7313ac5889252e3e48e31414190b19afde9e349851d8dbd0c","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a review role forwarding exactly the received commit is refused","scenario_hash":"6b40678f8ba1f94d292e86ace1ea800e9e5f31b693e7cd404f918b1b1c0e1e12","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-15T04:17:41.598970Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-806 a review role's forward must name its own pass commit, never the bare received hash

  Article 4.4 requires a clean review pass to commit its explicit-NONE
  inventory and forward that commit. BL-536 showed prompt text alone does
  not hold: architect and hardener both fast-forward-merged and forwarded
  exactly the hash they received, leaving a lineage indistinguishable from
  two skipped stages, and QA burned a full bounce + re-entry cycle on
  passes that had actually run. swarm_handoff must refuse the bare
  same-commit forward at send time. Bounces (backward direction) and
  marked detours (reroute_reason) are different, deliberately ungated
  moves; a sender with no received parcel for the task has no baseline to
  compare and fails open.

  Background:
    Given a fixture project root with role mailboxes and a git repository

  # BL-806 review-forward-evidence-gate-01
  Scenario Outline: a review role forwarding exactly the received commit is refused
    Given the <role> in_process box holds a git_handoff for task "BL-T" naming the received commit
    And a draft git_handoff from <role> to the next forward stage for task "BL-T" naming that same received commit
    When the draft is submitted to swarm_handoff
    Then the handoff is refused
    And the refusal names Article 4.4 pass evidence as the missing step
    And nothing is delivered to the recipient's inbox

    Examples:
      | role       |
      | cleaner    |
      | architect  |
      | hardender  |
      | documenter |

  # BL-806 review-forward-evidence-gate-02
  Scenario: forwarding the role's own descendant commit is accepted
    Given the architect in_process box holds a git_handoff for task "BL-T" naming the received commit
    And a draft git_handoff from architect to the next forward stage for task "BL-T" naming a descendant commit of the received commit
    When the draft is submitted to swarm_handoff
    Then the handoff is accepted

  # BL-806 review-forward-evidence-gate-03
  Scenario: a backward bounce naming the received commit is not gated
    Given the architect in_process box holds a git_handoff for task "BL-T" naming the received commit
    And a draft git_handoff from architect to an earlier stage for task "BL-T" naming that same received commit
    When the draft is submitted to swarm_handoff
    Then the handoff is accepted

  # BL-806 review-forward-evidence-gate-04
  Scenario: a marked detour with reroute_reason naming the received commit is not gated
    Given the architect in_process box holds a git_handoff for task "BL-T" naming the received commit
    And a draft git_handoff from architect to the next forward stage for task "BL-T" naming that same received commit with a reroute_reason
    When the draft is submitted to swarm_handoff
    Then the handoff is accepted

  # BL-806 review-forward-evidence-gate-05
  Scenario: a review role with no received parcel for the task fails open
    Given the architect in_process box holds no git_handoff for task "BL-T"
    And a draft git_handoff from architect to the next forward stage for task "BL-T" naming any valid commit
    When the draft is submitted to swarm_handoff
    Then the handoff is accepted

  # BL-806 review-forward-evidence-gate-06
  Scenario: a non-review sender forwarding an identical commit is not gated
    Given the coder in_process box holds a git_handoff for task "BL-T" naming the received commit
    And a draft git_handoff from coder to the next forward stage for task "BL-T" naming that same received commit
    When the draft is submitted to swarm_handoff
    Then the handoff is accepted
