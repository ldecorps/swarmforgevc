Feature: BL-1620 Two unit-lane poles come under the per-file budget

  BL-791 slice D is the unit lane's poles, per file, once BL-1598's
  register owns them. The census of 2026-09-16 (9 forks, load 10.8) names
  nine files over the 7000 ms per-file budget, together 273 s of 546 s of
  work; the two largest were bl968StepRegistryMaterializedTreeGuard.test.js
  at 69.9 s and telegramFrontDeskBotCli.test.js at 65.3 s. Amended
  2026-09-17: bl968 performs two full step-registry loads by design and
  left this ticket for BL-1629 (an accepted pole) and BL-1630 (the registry
  load itself); this feature is that telegramFrontDeskBotCli.test.js comes
  under budget alone with no test deleted, skipped or excluded, that its
  register row stays, re-owned by BL-1633 (amended 2026-09-18: the gate
  reads the file's in-suite duration, two to four times its solo one, and
  refuses an unregistered file at 1.5x the budget - so the row leaves in
  BL-1633's land, once a suspected pole is confirmed alone before refusing,
  and BL-1633 retires scenario 02 below then), and that the cause is named,
  not guessed.

  Background:
    Given the extension unit lane with the BL-1598 pole register

  # BL-1620 two-unit-lane-poles-01
  Scenario Outline: a pole file comes under budget with its tests intact
    Given <file> at the received commit has a recorded test count
    When <file> runs alone three times under the unit config at a 1-minute load below 8
    Then <file> measures under 7000 ms in every run
    And its test count at the parcel is greater than or equal to the received count
    And no test in it is skipped or excluded

    Examples:
      | file                                                    |
      | extension/test/telegramFrontDeskBotCli.test.js          |

  # BL-1620 two-unit-lane-poles-02
  Scenario: the register row stays, re-owned, until the gate confirms a pole alone
    Given backlog/suite-poles.tsv names the file under BL-1633
    And the parcel's evidence records the file's in-suite duration from one npm test run
    When the per-file budget guard runs with a 7000 ms budget against that duration and the register
    Then it reports no new-pole and no unowned-row for the file
    And the parcel leaves the row in backlog/suite-poles.tsv

  # BL-1620 two-unit-lane-poles-03
  Scenario: the cause of the pole is named in evidence
    Given the parcel's evidence file
    When it is read
    Then it names, per file, what made it slow and which established pattern replaced it
