Feature: BL-1565 A git_handoff to the coordinator is refused at send

  The coordinator runs on main with no code commits (Article 1.1) and the QA
  merge-up signal is a note (Article 2.2). A git_handoff addressed to it
  carries a merge_and_process payload, is stamped non-forwarding as the
  terminal forward (BL-1536), and Article 2.4 has the coordinator complete
  it merge-only and wait for a close that never comes - twice in twelve
  hours (BL-1527 parcel 002673, BL-1563 parcel 002698) the swarm starved at
  cap 1 on exactly that. This feature is that swarm_handoff.sh refuses the
  shape at the sender, before the mailbox and before the self-audit
  challenge, and names the note the close is; a note to the coordinator and
  a git_handoff to any other role are untouched.

  Background:
    Given a fixture project whose roles table lists the code-worktree roles in order "coder, cleaner, architect, hardender, documenter, QA"
    And the roles table gives the master checkout as the worktree of "specifier, coordinator"

  # BL-1565 git-handoff-to-coordinator-refused-01
  Scenario Outline: only a git_handoff naming the coordinator is refused, whoever sends it
    When the recipient guard decides a "<type>" draft from "<sender>" to "<recipients>"
    Then the decision is "<decision>"

    Examples:
      | type        | sender     | recipients          | decision |
      | git_handoff | QA         | coordinator         | refuse   |
      | git_handoff | coder      | coordinator         | refuse   |
      | git_handoff | QA         | coordinator, cleaner | refuse   |
      | git_handoff | QA         | documenter          | allow    |
      | git_handoff | documenter | QA                  | allow    |
      | git_handoff | coordinator | specifier          | allow    |
      | note        | QA         | coordinator         | allow    |

  # BL-1565 git-handoff-to-coordinator-refused-02
  # Drives the REAL swarm_handoff.bb against the fixture root (the bl1518
  # shape): a refusal needs no git repository and no tmux socket, and the
  # ordering - before AUDIT_REQUIRED, before any inbox write - is the
  # contract a decision-level test cannot see.
  Scenario: the real sender refuses before the mailbox and before the self-audit challenge
    Given a "git_handoff" draft from "QA" to "coordinator" naming task "BL-1565-a-git-handoff-to-the-coordinator-is-refused-at-send" and commit "0123456789"
    When swarm_handoff.bb is run on that draft
    Then it exits non-zero
    And its output names "type: note" and the close shape "QA-approved <task> landed <sha> - bookkeep to done"
    And its output does not contain "AUDIT_REQUIRED"
    And no inbox under the fixture root holds a new file

  # BL-1565 git-handoff-to-coordinator-refused-03
  Scenario: a note from QA to the coordinator still queues
    Given a "note" draft from "QA" to "coordinator" reading "QA-approved BL-1565 landed 0123456789 - bookkeep to done"
    When swarm_handoff.bb is run on that draft
    Then the coordinator's inbox/new/ holds one note carrying that message
