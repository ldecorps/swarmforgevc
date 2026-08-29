# BL-1192's task-scope gate attributes a changed path to a ticket by the id in
# the path's own BASENAME. That is correct for the entanglement it was built to
# catch, and wrong for one shape it cannot see: a ticket whose own landed YAML
# DECLARES another ticket's path as part of its own deliverable. The specifier
# writes those declarations deliberately, and two kinds of them exist today:
#
#   acceptance: - a defect against a shipped check amends the durable contract
#   for that check rather than forking it in two, so the one file the ticket
#   must edit is the one file the gate reads as foreign.
#
#   retires:    - a retirement ticket, by construction, edits the superseded
#   ticket's feature file. BL-1006 REQUIRES this ("retire, never reword"), so
#   the constitution mandates precisely the edit the gate refuses.
#
# Two live instances, both blocked on 2026-08-29, both with a correct commit
# already made:
#
#   BL-1246 (nested-git guard exempts git-ignored dirs, a human ruling) at
#   3c07857a5 edits specs/features/BL-1230-...feature, which its own
#   `acceptance:` field names.
#   Evidence: backlog/evidence/BL-1246-handoff-blocked-by-task-scope-gate-20260829.md
#
#   BL-1251 (retire BL-1248 scenario 04 now the sweep is re-armed) at 4ba1d0c9e
#   edits specs/features/BL-1248-...feature, which carries `RETIRE-WITH: BL-1251`
#   and which BL-1251 exists solely to retire a scenario from. BL-1251 has no
#   `acceptance:` field at all, so an exemption keyed only on `acceptance:`
#   leaves it blocked with no move.
#   Evidence: backlog/evidence/BL-1251-handoff-blocked-by-task-scope-gate-20260829.md
#
# Every move available to the coder is worse than the block: a tip-pure commit
# drops the very change the ticket exists to make, BL-1241's rebuild-off-main
# hatch replays only "this task's own paths" (the set that excludes the file),
# and an untagged or foreign-tagged commit subject would pass by re-labelling -
# which for a retirement also destroys the attribution BL-1006 depends on.
#
# This is the fourth instance of the recurring gate shape (BL-1237, BL-1240,
# BL-1241): a gate whose refusal reaches someone with no action available.

Feature: A ticket's own landed declarations are not another ticket's work

  Background:
    Given a swarm repository whose roles send parcels with swarm_handoff.sh
    And the task's ticket is read from the freshest landed ref, never the sender's working copy

  # BL-1276 declared-path-not-foreign-01
  Scenario Outline: only the exact path a ticket declares for itself is exempt
    Given the landed ticket for the task declares <declaration>
    And a commit tagged for that task whose own diff changes <changed_path>
    When the coder sends a git_handoff for that task citing that commit
    Then the send is <outcome>

    Examples:
      | declaration                                     | changed_path                          | outcome  |
      | acceptance: specs/features/BL-1230-guard.feature | specs/features/BL-1230-guard.feature | accepted |
      | acceptance: specs/features/BL-1230-guard.feature | backlog/active/BL-1230-guard.yaml    | refused  |
      | acceptance: specs/features/BL-1246-own.feature   | specs/features/BL-1230-guard.feature | refused  |
      | retires: specs/features/BL-1248-switch.feature   | specs/features/BL-1248-switch.feature | accepted |
      | retires: specs/features/BL-1248-switch.feature   | backlog/active/BL-1248-switch.yaml   | refused  |
      | no declaration of that path                      | specs/features/BL-1230-guard.feature | refused  |

  # BL-1276 declared-path-not-foreign-02
  Scenario: the exemption is read from the landed ticket, never from the sender's own working copy
    Given the landed ticket for the task declares acceptance: specs/features/BL-1246-own.feature
    And the sender's uncommitted working copy of that ticket declares specs/features/BL-1230-guard.feature instead
    And a commit tagged for that task whose own diff changes specs/features/BL-1230-guard.feature
    When the coder sends a git_handoff for that task citing that commit
    Then the send is refused

  # BL-1276 declared-path-not-foreign-03
  Scenario: a declaration that cannot be read grants no exemption and says so
    Given the ticket for the task cannot be resolved on any landed ref or in the working tree
    And a commit tagged for that task whose own diff changes specs/features/BL-1230-guard.feature
    When the coder sends a git_handoff for that task citing that commit
    Then the send is refused
    And the refusal records that the declared-path exemption could not be evaluated
