Feature: Bubble's pure logic is verified by a JVM unit suite that runs without a device

  Bubble ships Kotlin whose behavior no test in this repo can reach: there is no
  JVM unit source set, and the Node acceptance runner cannot execute Kotlin. The
  seam this feature describes is where Bubble behavior that is NOT device
  behavior gets verified, so a Bubble ticket stops being a choice between an
  inert Gherkin contract and no contract at all.

  Background:
    Given the Bubble Android module

  # BL-769 android-pure-logic-jvm-unit-seam-01
  Scenario: the JVM unit suite runs with no emulator and no connected device
    When the JVM unit suite is run
    Then it completes and reports a passing result

  # BL-769 android-pure-logic-jvm-unit-seam-02
  Scenario: the JVM unit suite is load-bearing
    Given a deliberately failing assertion is added to the JVM unit suite
    When the JVM unit suite is run
    Then it reports a failing result

  # BL-769 android-pure-logic-jvm-unit-seam-03
  Scenario Outline: the pure logic behind the recent Bubble defects is covered
    When the JVM unit suite is run
    Then it exercises <behavior>

    Examples:
      | behavior                                      |
      | parsing a pairing deep link                   |
      | classifying an unresolvable host as a failure |
