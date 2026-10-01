Feature: BL-1877 A commit runs only the property files its change reaches

  check_property_suite_drift.sh (BL-570) is the last guard of every role's
  pre-commit hook. When a commit stages any file under extension/src or any
  *.property.test.js, it compiles and runs the whole property lane, 493
  files, about 7 minutes on 2026-10-01, before the commit can land. 41
  commits paid that between 2026-10-01 00:00 and the coder's BL-1835 fix
  that night. QA's gather runs the whole lane once per parcel anyway. A
  commit now runs only the property files its staged change reaches, and
  falls back to the whole lane when it cannot tell which those are.

  Background:
    Given a fixture repository with the property-suite guard and a recording suite command

  # BL-1877 a-change-runs-only-the-property-files-it-reaches-01
  Scenario Outline: a commit runs only the property files its staged change reaches
    Given a staged change to <change>
    When the property-suite guard runs
    Then the suite command names exactly <property files>
    And it does not name the whole property lane

    Examples:
      | change                                                   | property files              |
      | one extension/src module that two property files import  | those two property files    |
      | one property test file and nothing under extension/src   | that property file          |

  # BL-1877 an-unknown-reach-falls-back-to-the-whole-lane-02
  Scenario: a change whose reach cannot be computed runs the whole lane
    Given a staged change to one extension/src module whose reach cannot be computed
    When the property-suite guard runs
    Then the suite command runs the whole property lane

  # BL-1877 a-change-outside-the-lane-runs-nothing-03
  Scenario: a commit staging nothing the lane reads runs no property file
    Given a staged change to backlog evidence only
    When the property-suite guard runs
    Then the suite command is not run
