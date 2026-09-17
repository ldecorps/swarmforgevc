Feature: BL-1615 A seat's dispatcher claims the mail addressed to that seat

  BL-983 gave a multi-seat stage one addressable queue: every seat's
  dispatcher reads the STAGE's new/ (stage-queue-dir), so a parcel
  addressed to the stage is claimed by exactly one seat. Delivery still
  puts mail addressed to a SEAT - reverse-hop merge-only copies, the
  coordinator's branch-behind merge-up notes, anything with `to: coder@2`
  - into that seat's own new/, which no dispatcher reads. On 2026-09-17
  eight such files sat in coder@2's inbox while three consecutive
  ready_for_next.sh calls printed NO_TASK, the daemon chased two of them,
  and the seat's branch never merged up. This feature is that a seat's
  dispatcher offers the stage queue and the seat's own new/ together,
  each file once in the one filename order, and that seat-addressed mail
  is offered to that seat alone.

  Background:
    Given a stage with two seats, coder and coder@2, each booted with its own worktree and mailbox
    And the stage queue is the coder seat's new/

  # BL-1615 seat-dispatcher-claims-seat-mail-01
  Scenario Outline: mail is offered by the dispatcher of the seat whose box it landed in
    Given a <kind> addressed to <recipient> is delivered
    When seat <asking> asks for its next task
    Then the file <outcome>

    Examples:
      | kind                            | recipient | asking  | outcome                              |
      | git_handoff                     | coder     | coder@2 | is claimed from the stage queue      |
      | non-forwarding git_handoff copy | coder@2   | coder@2 | is claimed from the seat's own new/  |
      | note                            | coder@2   | coder@2 | is claimed from the seat's own new/  |
      | non-forwarding git_handoff copy | coder@2   | coder   | is not listed and NO_TASK is printed |

  # BL-1615 seat-dispatcher-claims-seat-mail-02
  Scenario: candidates from both directories share one order
    Given a priority-10 note addressed to coder sits in the stage queue
    And a priority-00 non-forwarding git_handoff copy addressed to coder@2 sits in the seat's own new/
    When seat coder@2 asks for its next task
    Then the priority-00 copy is claimed first

  # BL-1615 seat-dispatcher-claims-seat-mail-03
  Scenario Outline: a role whose two directories coincide sees each file once
    Given a roster with <shape>
    And one note addressed to <role> sits in its new/
    When seat <role> asks for its next task
    Then exactly one candidate is offered and it is claimed
    And the mailbox is unchanged apart from that claim

    Examples:
      | shape                                                                              | role      |
      | a bare single-seat code role with its own worktree                                 | cleaner   |
      | two master-resident rows sharing one checkout path with different session values   | specifier |
