Feature: The Article 3.2.4 expedite lane recognises only `type: defect`

  The `bug` ticket type is retired. Article 3.2.4 carried a transition clause
  matching it "while any still carry that type"; no promotable ticket does,
  and the promotion ranking reads `backlog/paused/` only, so a done ticket
  never reaches the predicate at all.

  Two halves that must move together: the predicate stops matching `bug`,
  and the mint gate starts refusing it — otherwise a `bug` ticket minted
  later would lose its expedite lane with no error anywhere.

  # BL-1049 expedite-bug-retired-01
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

  # BL-1049 expedite-bug-retired-02
  Scenario: A done ticket carrying the retired type is never a candidate
    Given the coordinator is ranking promotion candidates from backlog/paused/
    And a ticket of type bug with severity high exists in backlog/done/
    When the coordinator ranks promotion candidates
    Then that ticket is not among the candidates

  # BL-1049 expedite-bug-retired-03
  Scenario Outline: The mint gate refuses the retired type and accepts its replacement
    Given a ticket YAML carrying type <type> and a valid epic
    When the specifier backlog hygiene gate runs on it
    Then the gate <verdict> the ticket

    Examples:
      | type   | verdict |
      | bug    | refuses |
      | defect | accepts |
