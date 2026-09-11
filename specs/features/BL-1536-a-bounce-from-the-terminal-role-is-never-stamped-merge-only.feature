Feature: BL-1536 A bounce from the terminal role is never stamped merge-only

  swarm_handoff.bb stamps `non-forwarding: true` on every git_handoff whose
  SENDER is the last code-worktree role in roles.tsv (`with-non-forwarding`,
  `last-pack-role?`). The stamp was meant for that role's terminal FORWARD -
  QA's approved commit to the coordinator, which nobody forwards again. It
  keys on the sender's seat alone, so QA's BOUNCE to an earlier role carries
  the same marker, and Article 2.4 tells the recipient a marked inbound is
  merge-only: merge, done_with_current, send nothing. The bounce is dropped
  by a role obeying the protocol. This feature is that the stamp follows the
  hop's DIRECTION: a git_handoff addressed to a role earlier in pipeline
  order is a bounce and never carries the marker, whoever sends it, while a
  terminal forward to a non-pipeline recipient still does.

  Background:
    Given the roles table lists the code-worktree roles in order "coder, cleaner, architect, hardender, documenter, QA"
    And the roles table gives the master checkout as the worktree of "specifier, coordinator"

  # BL-1536 bounce-never-stamped-merge-only-01
  Scenario Outline: the terminal stamp follows the hop's direction, not the sender's seat
    When the terminal stamp is decided for a git_handoff from "<sender>" to "<recipient>"
    Then the parcel <carries> the non-forwarding marker

    Examples:
      | sender     | recipient   | carries        |
      | QA         | hardender   | does not carry |
      | QA         | coder       | does not carry |
      | QA         | coordinator | carries        |
      | hardender  | coder       | does not carry |
      | documenter | QA          | does not carry |

  # BL-1536 bounce-never-stamped-merge-only-02
  # The terminal role is DERIVED from the table (BL-1299 scenario 04, human
  # ruling 2026-08-30): a pack whose QA row is master-resident has the
  # documenter as its last code-worktree role, and the direction rule must
  # hold there too. A role-name implementation passes 01 and fails here.
  Scenario Outline: the terminal role is read from the roles table, never from a role name
    Given the roles table gives the master checkout as the worktree of "QA"
    When the terminal stamp is decided for a git_handoff from "documenter" to "<recipient>"
    Then the parcel <carries> the non-forwarding marker

    Examples:
      | recipient   | carries        |
      | coordinator | carries        |
      | hardender   | does not carry |
