Feature: Multi-branch parsers need one test per arm on /pilot land and in hardener guidance

  # BL-755: take-flow-reason had three branches; every BL-661 test hit only
  # double-quoted. Harden hardener guidance and the /pilot land gate so a
  # changed multi-arm cond/case (≥3 arms) cannot land with untested arms.

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-755 parser-branch-01
  Scenario: the hardener role prompt requires one distinct test per parser branch
    When the hardener role prompt is read
    Then it requires at least one distinct test per arm of a multi-branch parser

  # BL-755 parser-branch-02
  Scenario: the /pilot prompt requires the same per-branch test rule for the hardener hat
    When the offline expeditor prompt is composed for ticket "BL-755"
    Then the prompt requires at least one distinct test per arm of a multi-branch parser

  # BL-755 parser-branch-03
  Scenario: A land whose touched multi-arm parser has an untested arm refuses
    Given the run's commits touched a function with three cond or case arms
    And only one of those arms is exercised by the run's tests
    When the pilot runs the landing gate
    Then the land is refused for untested parser branch
    And the refusal names an untested arm

  # BL-755 parser-branch-04
  Scenario: Every arm exercised lets the land complete
    Given the run's commits touched a function with three cond or case arms
    And each arm is exercised by at least one distinct test
    When the pilot runs the landing gate
    Then the land is completed

  # BL-755 parser-branch-05
  Scenario: A refused untested-parser-branch land writes nothing durable
    Given the run's commits touched a multi-arm parser with an untested arm
    When the pilot runs the landing gate
    Then the land is refused for untested parser branch
    And the ticket yaml stays where it was
    And no acceptance receipt is written

  # BL-755 parser-branch-06
  Scenario: The check is a no-op when the run touches no multi-arm parser
    Given the run's commits touched no function with three or more cond or case arms
    When the pilot runs the landing gate
    Then the land is completed
