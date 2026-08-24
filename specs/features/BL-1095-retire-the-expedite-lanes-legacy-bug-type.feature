# mutation-stamp: sha256=73d31549b21d06459b2767395431f041a578fe137be8319136c51c0adeca111d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T14:43:20.988260505Z","feature_name":"The Article 3.2.4 expedite lane recognises only `type: defect`","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1095-retire-the-expedite-lanes-legacy-bug-type.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"Only a defect of critical or high severity takes the expedite lane","scenario_hash":"ad273eb79f653898d6e89fd6c3e79227fa4c1e22c0055e1514a2e4362acae863","mutation_count":18,"result":{"Total":18,"Killed":18,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:43:20.988260505Z"},{"index":2,"name":"The mint gate refuses the retired type and accepts its replacement","scenario_hash":"2b838425f4768ef3da76327a5d419ef4e33b3f14084a98f9e8874a5dce686e4a","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:43:20.988260505Z"}]}
# acceptance-mutation-manifest-end

Feature: The Article 3.2.4 expedite lane recognises only `type: defect`

  The `bug` ticket type is retired. Article 3.2.4 carried a transition clause
  matching it "while any still carry that type"; no promotable ticket does,
  and the promotion ranking reads `backlog/paused/` only, so a done ticket
  never reaches the predicate at all.

  Two halves that must move together: the predicate stops matching `bug`,
  and the mint gate starts refusing it — otherwise a `bug` ticket minted
  later would lose its expedite lane with no error anywhere.

  # BL-1095 expedite-bug-retired-01
  Scenario Outline: Only a defect of critical or high severity takes the expedite lane
    Given the coordinator is ranking promotion candidates from backlog/paused/
    And a paused candidate of type <type> with severity <severity>
    When the expedite lane classifies the candidate
    Then the candidate is <ranking> ahead of every non-expedited ticket

    Examples:
      | type    | severity | ranking    |
      | defect  | high     | ranked     |
      | defect  | critical | ranked     |
      | bug     | high     | not ranked |
      | bug     | critical | not ranked |
      | defect  | none     | not ranked |
      | feature | high     | not ranked |

  # BL-1095 expedite-bug-retired-02
  Scenario: A done ticket carrying the retired type is never a candidate
    Given the coordinator is ranking promotion candidates from backlog/paused/
    And a ticket of type bug with severity high exists in backlog/done/
    When the coordinator ranks promotion candidates
    Then that ticket is not among the candidates

  # BL-1095 expedite-bug-retired-03
  Scenario Outline: The mint gate refuses the retired type and accepts its replacement
    Given a ticket YAML carrying type <type> and a valid epic
    When the specifier backlog hygiene gate runs on it
    Then the gate <verdict> the ticket

    Examples:
      | type   | verdict |
      | bug    | refuses |
      | defect | accepts |
