# mutation-stamp: sha256=6ff010f31ae1d6afe96acf5567c0afe677ee9e289bcfbe0029b64d416dd63951
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-20T03:59:02.775978725Z","feature_name":"A merge never silently drops work either branch carries","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1242-merge-never-silently-drops-branch-work.feature","background_hash":"3345f26689e75ebd3347f46a9767dfd4a875fe31f8e03183692a6bec9bba4a3f","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The commit message decides whether a removal is accounted for","scenario_hash":"bd083b5467f84ca3dcccbd132693c45e541711289158c518e49b87b54d395db0","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-02T22:06:17.605016411Z"},{"index":3,"name":"Each removed path is reported by exactly one guard","scenario_hash":"f5144d5dd1cc9c6a4d40566e3eb79c2bfa27bf32c2ad83027dc0fa25e137e984","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-02T22:06:17.605016411Z"},{"index":4,"name":"The commit message decides whether an incoming removal is accounted for","scenario_hash":"00beaeae1b861ef5c312bb0874924e9ef36dc7c8891d615d2582de52cdcebfad","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-02T22:06:17.605016411Z"}]}
# acceptance-mutation-manifest-end

Feature: A merge never silently drops work either branch carries

  QA's merge-up broadcast tells every worktree role to merge the approved
  commit. When QA's branch carries BL-490/BL-495 bounce reverts for tickets
  the receiving role has since rebuilt, git resolves the merge as "theirs
  deleted, ours unchanged" and drops the rebuilt files with no conflict
  marker and no failing hook.

  BL-901 already refuses exactly this for backlog ticket YAMLs, and exempts a
  deliberate removal whose commit message names the ticket. This feature
  extends the same refusal, and the same name-it-to-mean-it escape, to the
  pipeline and product paths a branch introduced.

  Both directions are covered (BL-1341). Refusing only the receiving side left
  the mirror case invisible: a path that exists ONLY on the incoming branch,
  dropped by a hand resolution, is absent from the diff against HEAD and sails
  through. On `main` the incoming branch is `origin/main`, so that blind
  direction was the one carrying QA-landed work - merge `b71c941a19` lost nine
  of BL-1330's paths through it. One refusal and one exemption model cover
  both; a path dropped from both sides is one finding, not two, and each
  finding says which side the path came from.

  Background:
    Given a role branch that introduced files of its own for several tickets

  # BL-1242 merge-branch-work-deletion-guard-01
  Scenario Outline: The commit message decides whether a removal is accounted for
    When the merge would remove those files and the message names <tickets> of them
    Then the merge commit is <outcome>

    Examples:
      | tickets | outcome |
      | none    | refused |
      | every   | allowed |

  # BL-1242 merge-branch-work-deletion-guard-02
  Scenario: A refusal names what was removed and a move available on this branch
    When the merge is refused for an unaccounted removal
    Then the refusal names every removed path
    And the refusal names the ticket each removed path belongs to
    And the refusal names the commit on this branch that introduced each removed path

  # BL-1242 merge-branch-work-deletion-guard-03
  Scenario: A merge that removes nothing either branch carries is allowed
    When the merge would remove no file either branch carries
    Then the merge commit is allowed

  # BL-1242 merge-branch-work-deletion-guard-04
  Scenario Outline: Each removed path is reported by exactly one guard
    When the merge would remove <path>
    Then the removal is reported by <guard>
    And the removal is reported once and not twice

    Examples:
      | path                                       | guard                    |
      | backlog/paused/BL-0001-example-ticket.yaml | check_ticket_deletion.sh |
      | specs/pipeline/steps/bl0001ExampleSteps.js | this guard               |
      | swarmforge/scripts/bl0001_example_lib.bb   | this guard               |

  # BL-1341 merge-incoming-work-deletion-guard-01
  Scenario Outline: The commit message decides whether an incoming removal is accounted for
    Given a merge in progress on a branch that lacks files the incoming branch carries
    When the merge result omits those files and the message names <tickets> of them
    Then the merge commit is <outcome>

    Examples:
      | tickets | outcome |
      | none    | refused |
      | every   | allowed |

  # BL-1341 merge-incoming-work-deletion-guard-02
  Scenario: A refusal names the dropped path, its ticket, and the side it came from
    Given a merge in progress on a branch that lacks files the incoming branch carries
    When the merge is refused for an unaccounted incoming removal
    Then the refusal names every omitted path
    And the refusal names the ticket each omitted path belongs to
    And the refusal says the path came from the incoming branch

  # BL-1341 merge-incoming-work-deletion-guard-03
  Scenario: A merge that keeps every incoming path is allowed
    Given a merge in progress on a branch that lacks files the incoming branch carries
    When the merge result keeps every file the incoming branch carries
    Then the merge commit is allowed

  # BL-1341 merge-incoming-work-deletion-guard-04
  Scenario: A path dropped from both sides is reported once, not twice
    Given a merge in progress on a branch that lacks files the incoming branch carries
    When the merge omits a path both branches carry
    Then the removal is reported once

  # BL-1242 an-untagged-removal-of-a-closed-owner-path-merges-when-the-body-names-it-09
  # BL-1662 (2026-09-20): the closed-ticket subject guard forbids the
  # id in the subject, so the removal commit is untagged by rule;
  # attribution reaches past it to the commit that introduced the path.
  Scenario: a merge carrying a deliberate untagged removal of a closed ticket's path is accepted when the message body names that ticket
    Given a path introduced by a commit whose subject names ticket BL-9001 and later removed by a commit whose subject names no ticket
    And a branch that still carries the path
    When that branch is merged with a commit message whose body names BL-9001
    Then the merge-deletion guard accepts the merge
    And the same merge with a message naming no ticket is refused naming BL-9001

  # BL-1242 an-incoming-only-path-tagged-only-at-its-introduction-is-attributed-10
  # BL-1662 hardener hardening (2026-09-20): BL-1662's own fix walks BOTH
  # sides' whole history for a tagged commit, but its own scenario 09 only
  # ever exercises the HEAD-side walk (the tagged commit sits on shared
  # history reachable from HEAD too). This scenario is the MERGE_HEAD-side
  # mirror: the path exists ONLY on the incoming branch, whose own tip
  # commit touching it is untagged and whose introducing commit, deeper in
  # its history, is tagged.
  Scenario: a path that exists only on the incoming branch, tagged only at its introduction, is attributed by that introducing commit
    Given a path that exists only on the incoming branch, introduced by a commit naming ticket BL-9002 and later edited by a commit naming no ticket
    When that incoming branch is merged, dropping the path, with a commit message whose body names BL-9002
    Then the merge-deletion guard accepts the merge
    And the same merge with a message naming no ticket is refused naming BL-9002
