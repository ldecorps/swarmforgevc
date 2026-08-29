# BL-1192's task-scope gate attributes a changed path to a ticket by the id in
# the path's own BASENAME. That is correct for the entanglement it was built to
# catch, and wrong for one shape it cannot see: a ticket whose own `acceptance:`
# field POINTS AT another ticket's feature file. The specifier writes that
# pointer deliberately - a defect against a shipped check amends the durable
# contract for that check rather than forking it in two - so the one file the
# ticket must edit is the one file the gate reads as foreign.
#
# Live instance, 2026-08-29: BL-1246 (the nested-git guard must exempt
# git-ignored directories, a human ruling) is implemented, tested and committed
# at 3c07857a5, and `swarm_handoff.sh` refuses to forward it because it edits
# `specs/features/BL-1230-no-leaked-git-repository-inside-the-working-tree.feature`,
# which BL-1246's own `acceptance:` field names. Every move available to the
# coder is worse than the block: a tip-pure commit drops the scenarios the
# ticket exists to add, BL-1241's rebuild-off-main hatch replays only "this
# task's own paths" (the set that excludes the very file), and a commit subject
# leading with BL-1230 would pass by re-labelling the same work.
# Evidence: backlog/evidence/BL-1246-handoff-blocked-by-task-scope-gate-20260829.md.
#
# This is the fourth instance of the recurring gate shape (BL-1237, BL-1240,
# BL-1241): a gate whose refusal reaches someone with no action available.

Feature: A ticket's own declared acceptance contract is not another ticket's work

  Background:
    Given a swarm repository whose roles send parcels with swarm_handoff.sh

  # BL-1276 acceptance-declared-path-not-foreign-01
  Scenario Outline: only the exact path a ticket declares as its acceptance contract is exempt
    Given the landed ticket "BL-1246" declares its acceptance contract as <declared_acceptance>
    And a commit tagged for that task whose own diff changes <changed_path>
    When the coder sends a git_handoff for task ticket "BL-1246" citing that commit
    Then the send is <outcome>

    Examples:
      | declared_acceptance                | changed_path                       | outcome  |
      | specs/features/BL-1230-guard.feature | specs/features/BL-1230-guard.feature | accepted |
      | specs/features/BL-1230-guard.feature | backlog/active/BL-1230-guard.yaml    | refused  |
      | specs/features/BL-1246-own.feature   | specs/features/BL-1230-guard.feature | refused  |
      | no acceptance contract               | specs/features/BL-1230-guard.feature | refused  |

  # BL-1276 acceptance-declared-path-not-foreign-02
  Scenario: the exemption is read from the landed ticket, never from the sender's own working copy
    Given the landed ticket "BL-1246" declares its acceptance contract as specs/features/BL-1246-own.feature
    And the sender's uncommitted working copy of that ticket declares specs/features/BL-1230-guard.feature instead
    And a commit tagged for that task whose own diff changes specs/features/BL-1230-guard.feature
    When the coder sends a git_handoff for task ticket "BL-1246" citing that commit
    Then the send is refused

  # BL-1276 acceptance-declared-path-not-foreign-03
  Scenario: a declaration that cannot be read grants no exemption and says so
    Given the ticket "BL-1246" cannot be resolved on any landed ref or in the working tree
    And a commit tagged for that task whose own diff changes specs/features/BL-1230-guard.feature
    When the coder sends a git_handoff for task ticket "BL-1246" citing that commit
    Then the send is refused
    And the refusal records that the acceptance-contract exemption could not be evaluated
