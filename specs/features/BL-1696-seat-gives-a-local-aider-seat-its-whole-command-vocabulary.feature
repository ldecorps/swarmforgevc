Feature: BL-1696 seat gives a local aider seat its whole command vocabulary

  A headless aider seat has no command channel: it never runs a model's
  "!" lines and it auto-declines fenced shell blocks under --yes-always,
  so no prompt can make it merge, test or hand off. `seat` is the whole
  vocabulary the local parcel driver (BL-1697) speaks for it: a short
  verb with fixed arguments, each running exactly one pipeline script or
  git subcommand, allow-listed per role. A malformed argument is refused
  before anything runs, so a model or a driver can never compose shell
  through it. Coordinator verbs wait on the local pack-shape ruling
  (BL-1702).

  Background:
    Given a throwaway git repository whose pipeline scripts only record the arguments they receive
    And the repository's roles file lists coordinator, coder, cleaner and QA

  # BL-1696 seat-gives-a-local-aider-seat-its-whole-command-vocabulary-01
  Scenario Outline: a well-formed verb runs exactly its one script with fixed arguments
    Given the seat runs as role "coder"
    When the seat runs "<invocation>"
    Then it exits 0
    And exactly one recorded call exists, to "<script>" with arguments "<argv>"

    Examples:
      | invocation                                | script               | argv                                                          |
      | next                                      | ready_for_next.sh    | NONE                                                          |
      | done                                      | done_with_current.sh | NONE                                                          |
      | ask "BL-7: the acceptance test stays red" | role_ask.bb          | ROOT --role coder --question BL-7: the acceptance test stays red |
      | note cleaner 50 "BL-7 is on its way"      | swarm_handoff.sh     | DRAFT                                                         |

  # BL-1696 seat-gives-a-local-aider-seat-its-whole-command-vocabulary-02
  Scenario Outline: a malformed argument or a verb outside the role's set runs nothing
    Given the seat runs as role "<role>"
    When the seat runs "<invocation>"
    Then it exits 2 and prints the usage of the verb, or the role's verbs for an unknown one
    And no script call is recorded and the working tree is unchanged

    Examples:
      | role        | invocation                               |
      | coder       | handoff aider BL-7                       |
      | coder       | handoff cleaner 7                        |
      | coder       | merge coordinator not-a-sha              |
      | coder       | ask "BL-7: $(whoami)"                    |
      | coder       | note cleaner 5 "short"                   |
      | coder       | note cleaner 50 "EIGHTY_ONE_CHARACTERS"  |
      | coordinator | merge coder A_REAL_COMMIT                |
      | coder       | rebase main                              |

  # BL-1696 seat-gives-a-local-aider-seat-its-whole-command-vocabulary-03
  Scenario: a handoff writes the role's draft at HEAD and queues it through the two-call audit protocol
    Given the seat runs as role "coder"
    And the handoff helper answers the first call for a draft with AUDIT_REQUIRED
    When the seat runs "handoff cleaner BL-7"
    Then it exits 0
    And the coder's draft names type git_handoff, recipient cleaner, task BL-7 and the 10-hex HEAD commit
    And the handoff helper was called twice with a byte-identical draft

  # BL-1696 seat-gives-a-local-aider-seat-its-whole-command-vocabulary-04
  Scenario: a conflicting merge is aborted and never left in the tree
    Given the seat runs as role "coder"
    And a commit on another branch conflicts with the checkout in one file
    When the seat runs "merge coordinator" with that commit
    Then it exits 3 and prints the conflicted path
    And the checkout has no merge in progress and its HEAD is unchanged

  # BL-1696 seat-gives-a-local-aider-seat-its-whole-command-vocabulary-05
  Scenario: a clean merge records the received commit as a parent of a new merge commit
    Given the seat runs as role "coder"
    And a commit on another branch touches a file the checkout does not
    When the seat runs "merge coordinator" with that commit
    Then it exits 0
    And the new HEAD is a merge commit whose parents are the old HEAD and that commit

  # BL-1696 seat-gives-a-local-aider-seat-its-whole-command-vocabulary-06
  Scenario: the test verb fails closed when no test command is configured
    Given the seat runs as role "coder"
    And the live pack declares no seat test command
    When the seat runs "test"
    Then it exits 2 and says no seat test command is configured
    And no script call is recorded and the working tree is unchanged
