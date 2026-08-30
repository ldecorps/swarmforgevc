Feature: Swarm stamp-off for the pipeline-board sleep freeze

  Hotfix 2b67f4b1a2 landed on main outside the pipeline. These scenarios
  review what it landed - they confirm or refute it and never reimplement
  it. The certification itself is a human decision recorded in the hotfix
  ledger; nothing here may write it.

  Background:
    Given the landed sources at commit 2b67f4b1a2

  # BL-1283 pipeline-board-sleep-freeze-stamp-01
  Scenario: an asleep pack freezes the board
    Given a concierge tick whose pipeline board is reported asleep
    When the tick runs
    Then the board is neither recomputed nor reposted
    And the board pin is not re-enforced
    And the previously posted board state is carried forward unchanged

  # BL-1283 pipeline-board-sleep-freeze-stamp-02
  Scenario: an awake pack syncs the board as before
    Given a concierge tick whose pipeline board is reported awake
    When the tick runs
    Then the board is synced
    And the board pin is enforced

  # BL-1283 pipeline-board-sleep-freeze-stamp-03
  Scenario: a tick that reports no liveness at all is treated as awake
    Given a concierge tick with no pipeline board liveness adapter wired
    When the tick runs
    Then the board is synced
    And the board pin is enforced

  # BL-1283 pipeline-board-sleep-freeze-stamp-04
  Scenario: the front desk supplies liveness from the swarm itself
    Then the front-desk bot wires the pipeline board liveness adapter to the swarm liveness probe for its own target path

  # BL-1283 pipeline-board-sleep-freeze-stamp-05
  Scenario Outline: a wrong liveness answer fails in a stated direction
    Given a pack that is really "<reality>"
    And a liveness probe answering "<probe>"
    When the tick runs
    Then the board outcome is "<outcome>"

    Examples:
      | reality | probe  | outcome              |
      | awake   | asleep | frozen-while-working |
      | asleep  | awake  | reposting-while-idle |

  # BL-1283 pipeline-board-sleep-freeze-stamp-06
  Scenario: every property-allowlist row the hotfix added names a tracking ticket
    Then each property suite allowlist row added by commit 2b67f4b1a2 names a tracking ticket
    And the review records whether that ticket covers the allowlisted file

  # BL-1283 pipeline-board-sleep-freeze-stamp-07
  Scenario: the review never certifies the hotfix by itself
    When the review completes with every scenario green
    Then the hotfix ledger entry for commit 2b67f4b1a2 is still awaiting a human decision
