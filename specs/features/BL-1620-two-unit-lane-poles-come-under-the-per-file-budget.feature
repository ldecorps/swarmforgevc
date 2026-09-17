Feature: BL-1620 Two unit-lane poles come under the per-file budget

  BL-791 slice D is the unit lane's poles, per file, once BL-1598's
  register owns them. The census of 2026-09-16 (9 forks, load 10.8) names
  nine files over the 7000 ms per-file budget, together 273 s of 546 s of
  work; the two largest are bl968StepRegistryMaterializedTreeGuard.test.js
  at 69.9 s and telegramFrontDeskBotCli.test.js at 65.3 s - half of the
  nine's work between them. This feature is that both come under budget
  with no test deleted, skipped or excluded, that their register rows leave
  in the same land, and that the cause is named, not guessed.

  Background:
    Given the extension unit lane with the BL-1598 pole register naming both files under BL-1620

  # BL-1620 two-unit-lane-poles-01
  Scenario Outline: a pole file comes under budget with its tests intact
    Given <file> at the received commit has a recorded test count
    When npm test runs three times on the parcel at a 1-minute load below 8
    Then <file> measures under 7000 ms in every run
    And its test count at the parcel is greater than or equal to the received count
    And no test in it is skipped or excluded

    Examples:
      | file                                                    |
      | extension/test/bl968StepRegistryMaterializedTreeGuard.test.js |
      | extension/test/telegramFrontDeskBotCli.test.js          |

  # BL-1620 two-unit-lane-poles-02
  Scenario: the register rows leave in the same land
    Given backlog/suite-poles.tsv names both files under BL-1620
    When the parcel's npm test verdict is read
    Then it reports no new-pole and no stale-row for either file
    And the parcel removes both rows from backlog/suite-poles.tsv

  # BL-1620 two-unit-lane-poles-03
  Scenario: the cause of each pole is named in evidence
    Given the parcel's evidence file
    When it is read
    Then it names, per file, what made it slow and which established pattern replaced it
