Feature: a role-held active ticket resolves on the board regardless of the letter-case of its yaml id

  # BL-474 audit finding #4 (real, latent). The stage-map keys are upper-cased by
  # extract-ticket-id, but active-ticket-ids reads each backlog/active/*.yaml
  # `id:` VERBATIM, so filter-active joins an upper-cased key against a
  # possibly-mixed-case active id. A mis-cased yaml id (`bl-490`) then fails the
  # join and the held ticket silently vanishes from the board with no error. The
  # fix normalizes the active-set id side to the same upper-case as the header
  # side, so the join is case-symmetric.

  # BL-489 active-id-join-is-case-symmetric-01
  Scenario Outline: a held ticket whose yaml id is written in any letter-case still appears on the board
    Given a role holds ticket "BL-490" in its in_process mailbox
    And that ticket's backlog/active yaml id is written as "<yaml_id>"
    When the board computes the active stage map
    Then "BL-490" appears on the board at that role's stage

    Examples:
      | yaml_id |
      | BL-490  |
      | bl-490  |
      | Bl-490  |
