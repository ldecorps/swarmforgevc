# mutation-stamp: sha256=306563651999db7c8aec2f7a6d51ed3d8ea658cdbc8dd26b833d74fa7cc7ffa2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-12T03:52:51.507217173Z","feature_name":"BL-1536 A bounce from the terminal role is never stamped merge-only","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1536-a-bounce-from-the-terminal-role-is-never-stamped-merge-only.feature","background_hash":"61f63cbe921f834b6ae8ac1f6a0916f5a1bd558f153920236abaec13d30e7cde","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the terminal stamp follows the hop's direction, not the sender's seat","scenario_hash":"b7984160e4cf0fd265397ee47d4137912b739f99d6eba3d6bf76a12b6b8ac974","mutation_count":15,"result":{"Total":15,"Killed":15,"Survived":0,"Errors":0},"tested_at":"2026-09-12T03:52:51.507217173Z"},{"index":1,"name":"the terminal role is read from the roles table, never from a role name","scenario_hash":"474c17d791c9a655514c4a04c2af0bdbb26322f60a41ec6bd3c3334ec014236a","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-12T03:52:51.507217173Z"}]}
# acceptance-mutation-manifest-end

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
