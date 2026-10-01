# mutation-stamp: sha256=4c076c4a6619c612dcc98689c4ba41ef6272b6316060a8e6e191f7e9db34b3ae
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-01T12:25:29.546976423Z","feature_name":"BL-1822 The morning briefing carries the recruiter's model scout table","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1822-the-morning-briefing-carries-the-model-scout-table.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the section is one line when <state>","scenario_hash":"5aea2f9420db45d8a5f7349cfd950b211bc582978d8e308122c4558c4d101737","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-10-01T12:25:29.546976423Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1822 The morning briefing carries the recruiter's model scout table
  The recruiter's score table (BL-1821) lives on the host. The documenter
  authors the morning briefing and must not invent or re-rank numbers,
  so a tool renders the Model scout section from the table and the
  documenter pastes it. When nothing has been scouted since the previous
  briefing, the section is one line saying so. How the section reads on a
  phone is the Art Director's to sign off.

  # BL-1822 fresh-table-renders-rows-01
  Scenario: a table updated since the previous briefing renders its rows, best first
    Given a score table with 3 specifier rows updated after the previous briefing
    When the Model scout section is rendered
    Then it lists the 3 rows by passed count, highest first, each naming the model, its passed count out of the total and whether it is the incumbent
    And it ends with the table's recommend line

  # BL-1822 empty-states-02
  Scenario Outline: the section is one line when <state>
    Given <state>
    When the Model scout section is rendered
    Then the section is the single line "<line>"

    Examples:
      | state                                                     | line                                               |
      | the score table was last updated before the previous briefing | Model scout: no new scout since the previous briefing. |
      | no score table exists                                     | Model scout: no scout has run yet.                 |
