# mutation-stamp: sha256=c0620273d52f79b00639763a93eba04bd05e5efa8b81f0b0ddabd94633910883
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-16T07:48:45.966105Z","feature_name":"The briefing's open-ticket chart states what it measures and never suppresses a sibling section","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-896-briefing-not-done-burndown-stamp.feature","background_hash":"6beadd95505ffbc2da069b4fe1349474d57e9466864ba6e9c5e0552ef2632809","implementation_hash":"unknown","scenarios":[{"index":2,"name":"one chart source failing never suppresses the other","scenario_hash":"16ea6de393c35c4bda0999454aa5567dbf16953eb96ac70fed1258a1f267daf8","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-16T07:48:45.966105Z"}]}
# acceptance-mutation-manifest-end

Feature: The briefing's open-ticket chart states what it measures and never suppresses a sibling section

  Background:
    Given the morning briefing email composes its inline chart section from the architecture render and the open-ticket render

  # BL-896 briefing-open-chart-01
  Scenario: the chart names the series it actually plots
    Given a backlog whose open-ticket count rose over the charted window
    When the open-ticket chart is rendered
    Then its heading names the series as remaining open tickets over the window
    And its heading keeps the word "burndown" per the 2026-08-16 human ruling
    And its summary reports the open count at each end of the window with the filed and closed rates
    And it makes no claim of progress toward a fixed or committed scope
    And it projects no completion date

  # BL-896 briefing-open-chart-02
  Scenario: the open count matches the backlog's actual open set
    Given a ticket that was retired by deleting its file rather than moving it to done
    When the open-ticket series is computed for today
    Then today's open count equals the number of tickets currently held in the active, paused and hold lanes
    And the retired ticket is not counted as open

  # BL-896 briefing-open-chart-03
  Scenario Outline: one chart source failing never suppresses the other
    Given the architecture render <architecture> this run
    And the open-ticket render <burndown> this run
    When the briefing chart section is assembled
    Then the section carries <shipped>
    And the briefing is sent

    Examples:
      | architecture | burndown  | shipped                      |
      | succeeds     | fails     | the architecture charts only |
      | fails        | succeeds  | the open-ticket chart only   |
      | succeeds     | succeeds  | both chart sources           |
      | fails        | fails     | no charts and a plain note   |

  # BL-896 briefing-open-chart-04
  Scenario: an empty window degrades to no chart rather than a failed send
    Given a repository whose backlog history yields no chartable days
    When the briefing chart section is assembled
    Then the open-ticket chart is omitted
    And the briefing is sent
