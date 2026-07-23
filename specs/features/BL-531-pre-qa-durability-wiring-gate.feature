Feature: a parcel reaches QA only with durable lineage and declared wiring

  # BL-531 (BL-512 audit BL-FIX-004): qa_bounce:behavior:coder is the largest non-chaser
  # failure mode (count 31). Two machine-checkable causes dominate it. BL-490 shipped to QA
  # on a lineage that did not contain the coder's own bounce-fix commit (still stranded at
  # the tip of swarmforge-coder, never forwarded). BL-419 built commit_integrity_cli.bb and
  # never wired it at the one call site the ticket was filed to fix, so the parcel was green
  # everywhere and protected nothing. Both are decidable at send time from the sender's own
  # checkout, so swarm_handoff.sh refuses a QA-bound git_handoff that fails either check.

  Background:
    Given a ticket in backlog/active/ whose parcel commit is ready to forward

  # BL-531 orphan-ticket-commit-refused-01
  Scenario: a ticket commit stranded on a role branch refuses the handoff to QA
    Given a commit naming that ticket sits on a pipeline role branch
    And that commit is not reachable from main
    And that commit is not an ancestor of the commit cited in the draft
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is refused
    And the refusal names the stranded commit and the ancestry failure class

  # BL-531 clean-lineage-allowed-02
  Scenario: a parcel whose ticket commits are all in its lineage is sent
    Given every commit naming that ticket on a pipeline role branch is an ancestor of the cited commit
    And the ticket declares no required wiring
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is sent

  # BL-531 declared-wiring-missing-refused-03
  Scenario Outline: declared wiring that is absent at the cited commit refuses the handoff
    Given the ticket declares required wiring for a path and a pattern
    And at the cited commit <wiring state>
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is refused
    And the refusal names the declared path, the declared pattern, and the wiring failure class

    Examples:
      | wiring state |
      | the declared path exists but does not contain the pattern |
      | the declared path does not exist |

  # BL-531 wiring-judged-at-the-commit-04
  Scenario: declared wiring is judged at the cited commit, not in the sender's working tree
    Given the ticket declares required wiring for a path and a pattern
    And the cited commit contains that pattern at that path
    And the sender's working tree has since deleted that path
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is sent

  # BL-531 malformed-wiring-entry-refused-05
  Scenario: a required wiring entry that cannot be parsed refuses the handoff
    Given the ticket declares a required wiring entry with no separator between path and pattern
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is refused
    And the refusal names the malformed entry and the manifest failure class

  # BL-531 acknowledged-abandoned-commit-allowed-06
  Scenario: a stranded commit the ticket records as abandoned no longer refuses the handoff
    Given a commit naming that ticket is stranded off the parcel's lineage
    And the ticket records that commit under abandoned_commits
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is sent

  # BL-531 gate-scope-07
  Scenario Outline: drafts outside the QA edge are not gated
    Given a commit naming that ticket is stranded off the parcel's lineage
    When the sender runs swarm_handoff.sh on <draft>
    Then the handoff is sent

    Examples:
      | draft |
      | a git_handoff draft addressed to cleaner |
      | a note draft addressed to QA |

  # BL-531 infrastructure-error-fails-open-08
  Scenario: a role branch the gate cannot read warns and still sends
    Given a pipeline role worktree recorded in roles.tsv is missing
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is sent
    And a warning names the check that could not run

  # BL-531 no-ticket-id-skips-the-gate-09
  Scenario: a task name carrying no ticket id skips the gate
    Given the draft's task name carries no ticket id
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is sent

  # BL-531 standalone-self-check-10
  Scenario Outline: the sender can run the gate standalone before handing off
    Given the parcel <parcel state>
    When the sender runs the pre-QA gate script on the ticket and the cited commit
    Then the script exits <exit> and prints a <line> line

    Examples:
      | parcel state                 | exit    | line |
      | satisfies both checks        | zero    | OK   |
      | has a stranded ticket commit | nonzero | FAIL |

  # BL-531 empty-diff-or-merge-commit-is-not-a-finding-11
  Scenario Outline: a ticket-naming commit that carries no dropped work does not refuse the handoff
    Given a commit naming that ticket is stranded off the parcel's lineage
    And that commit <carries no dropped work>
    When the sender runs swarm_handoff.sh on a git_handoff draft addressed to QA
    Then the handoff is sent

    Examples:
      | carries no dropped work                                        |
      | is a merge commit whose diff against its first parent is empty |
      | has a tree identical to the commit cited in the draft          |
