Feature: A reverse hop never targets a role whose worktree is the master checkout

  Reverse git_handoff copies propagate a parcel's tree shape BACKWARD to
  earlier pipeline roles so they do not drift. That only makes sense for a
  role that holds its own code worktree branch.

  The coordinator and the specifier both work in the master checkout and are
  both forbidden to integrate (Article 1.2, Article 4.2 — QA lands on main).
  `pack-role-names` excludes the coordinator but not the specifier, so a
  `back-all` sender addresses the specifier a merge-only inbound whose
  prescribed action would land unapproved in-flight work on the published
  branch, bypassing the QA gate entirely.

  Background:
    Given the pack pipeline roles in order are "specifier, coder, cleaner, architect, hardender, documenter, QA"
    And the roles table gives the master checkout as the worktree of "specifier, coordinator"

  # BL-1299 reverse-hop-skips-master-resident-roles-01
  Scenario Outline: reverse recipients exclude every master-resident role
    Given role "<sender>" declares propagation "<mode>"
    When reverse recipients are computed for sender "<sender>"
    Then the reverse recipients are "<recipients>"

    Examples:
      | sender     | mode      | recipients                                       |
      | architect  | back-all  | coder, cleaner                                   |
      | cleaner    | back-one  | coder                                            |
      | coder      | back-all  |                                                  |
      | QA         | back-all  | coder, cleaner, architect, hardender, documenter |

  # BL-1299 reverse-hop-skips-master-resident-roles-02
  Scenario: the specifier is never addressed a reverse copy
    Given role "architect" declares propagation "back-all"
    When reverse recipients are computed for sender "architect"
    Then the reverse recipients do not include "specifier"
    And the reverse recipients do not include "coordinator"

  # BL-1299 reverse-hop-skips-master-resident-roles-03
  Scenario: excluding master-resident roles does not move the terminal role
    When the terminal pack role is computed
    Then the terminal pack role is "QA"

  # BL-1299 reverse-hop-skips-master-resident-roles-04
  # Master-residency is DERIVED from the roles table, never a hardcoded pair of
  # role names (human ruling 2026-08-30). A name-list implementation passes 01-03
  # and fails here, which is the whole point of this scenario: the extra role is
  # master-resident purely by its roles-table row.
  Scenario Outline: master-residency is read from the roles table, not from a role-name list
    Given the roles table gives the master checkout as the worktree of "<extra-master-resident>"
    And role "QA" declares propagation "back-all"
    When reverse recipients are computed for sender "QA"
    Then the reverse recipients are "<recipients>"

    Examples:
      | extra-master-resident | recipients                              |
      | cleaner               | coder, architect, hardender, documenter |
      | hardender             | coder, cleaner, architect, documenter   |
