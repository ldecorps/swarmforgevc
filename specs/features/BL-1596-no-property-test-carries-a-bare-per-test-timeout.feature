Feature: BL-1596 No property test carries a bare per-test timeout

  A property test that passes its own bare numeric third argument overrides
  the lane's testTimeout and never learns the lane is busy, so it times out
  under a full lane one file at a time: bl1529 (BL-1592) and
  telegramFrontDeskBotCli (BL-1595) in two days. At bdb76c3c8a, 38 property
  files carried 81 such arguments of four or more digits. This feature is that a guard with a pure
  scanner and a real-tree walk refuses any bare per-test timeout in a
  property file, that the real tree scans clean after every site is migrated
  to the lane budget helper from the same base, and that the evidence lists
  every migrated site so the census is pinned rather than hoped for.

  # BL-1596 no-property-test-carries-a-bare-per-test-timeout-01
  Scenario Outline: the pure scanner flags each bare shape and passes a helper-wrapped budget
    When the bare per-test timeout scanner reads a test source <shape>
    Then it reports <finding>

    Examples:
      | shape                                                                  | finding                  |
      | whose test call closes with a number-only line before the closing paren | one bare site at that line |
      | whose test call closes inline with a comma and a number before the paren | one bare site at that line |
      | whose test call closes with propertyLaneTimeoutMs around the number     | no bare site               |
      | whose only number-only line sits inside an array literal                | no bare site               |

  # BL-1596 no-property-test-carries-a-bare-per-test-timeout-02
  Scenario: the real property test tree scans clean and the migration is visible
    When the bare per-test timeout guard walks the real extension property test tree
    Then it reports no bare site
    And at least 38 property files require the property lane's budget helper

  # BL-1596 no-property-test-carries-a-bare-per-test-timeout-03
  Scenario: the evidence lists every migrated site with its base and matches the census
    When the parcel's evidence for the sweep is read
    Then it lists every migrated site as file, line and base
    And the number of listed sites equals the census it records for the parcel's base commit
