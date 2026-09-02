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
