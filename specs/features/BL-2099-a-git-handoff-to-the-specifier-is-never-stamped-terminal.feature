Feature: BL-2099 A git_handoff to the specifier is never stamped terminal

  Article 5.1 routes an amendment proposal to the specifier as a
  git_handoff. swarm_handoff.bb stamps `non-forwarding: true` on a
  git_handoff whose sender is the last code-worktree role in roles.tsv
  and whose recipients include no earlier role
  (reverse_hop_lib.bb `terminal-forward?`, BL-1536). Since BL-1565 a
  git_handoff to the coordinator is refused before that decision runs,
  so the only send the stamp can still reach is the last role's
  git_handoff to the specifier, and ready_for_next.sh tells the specifier
  to complete a marked parcel unread. Packs that list the art-director
  after QA make the art-director the last role: its human-directed
  proposal of 2026-10-09 (3cb1fcf73b, 47a740d281) was completed unread.
  This feature is that a git_handoff addressed to the specifier never
  carries the terminal marker, whichever role sends it and wherever that
  role's row sits.

  Background:
    Given the roles table gives the master checkout as the worktree of "specifier, coordinator"

  # BL-2099 git-handoff-to-specifier-never-stamped-01
  Scenario Outline: the last role's git_handoff to the specifier carries no terminal marker
    Given the roles table lists the code-worktree roles in order "<order>"
    When the terminal stamp is decided for a git_handoff from "<sender>" to "specifier"
    Then the parcel does not carry the non-forwarding marker

    Examples:
      | order                                                              | sender       |
      | coder, cleaner, architect, hardender, documenter, QA, art-director | art-director |
      | coder, cleaner, architect, hardender, documenter, QA               | QA           |
