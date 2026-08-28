Feature: A merge never silently drops work the receiving branch introduced

  QA's merge-up broadcast tells every worktree role to merge the approved
  commit. When QA's branch carries BL-490/BL-495 bounce reverts for tickets
  the receiving role has since rebuilt, git resolves the merge as "theirs
  deleted, ours unchanged" and drops the rebuilt files with no conflict
  marker and no failing hook.

  BL-901 already refuses exactly this for backlog ticket YAMLs, and exempts a
  deliberate removal whose commit message names the ticket. This feature
  extends the same refusal, and the same name-it-to-mean-it escape, to the
  pipeline and product paths a branch introduced.

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
  Scenario: A merge that removes nothing the branch introduced is allowed
    When the merge would remove no file the branch introduced
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
