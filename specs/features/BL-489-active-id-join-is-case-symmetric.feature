# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-17T13:16:15.298649442Z","feature_name":"a role-held active ticket resolves on the board regardless of the letter-case of its yaml id","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-489-active-id-join-is-case-symmetric.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: a role-held active ticket resolves on the board regardless of the letter-case of its yaml id

  # BL-474 audit finding #4 (real, latent). The stage-map keys are upper-cased by
  # extract-ticket-id, but active-ticket-ids reads each backlog/active/*.yaml
  # `id:` VERBATIM, so filter-active joins an upper-cased key against a
  # possibly-mixed-case active id. A mis-cased yaml id (`bl-490`) then fails the
  # join and the held ticket silently vanishes from the board with no error. The
  # fix normalizes the active-set id side to the same upper-case as the header
  # side, so the join is case-symmetric.

  # Hardener (BL-234 equivalent-mutant note, 2026-07-17): a soft Gherkin mutation pass
  # single-character-mangles each <yaml_id> example VALUE (3 mutants: 1 killed, 2
  # survived). The 2 survivors (row 1 "BL-490" -> "bL-490", row 2 "bl-490" -> "bL-490")
  # are both case-only permutations of the same ticket id; the killed mutant (row 3
  # "Bl-490" -> "Blx490") changes an actual character, producing a genuinely different
  # id. This scenario's own fix upper-cases the active-set id before the join, so
  # active-ticket-ids treats every case variant of "BL-490" identically BY DESIGN — a
  # case-only mutation of an <yaml_id> value can never be distinguished from the
  # original, since both resolve to the same upper-cased key. Killing the row-3 mutant
  # (a real character change) proves the join is exercised; no artificial assertion was
  # added to force the 2 case-only survivors to die.
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
