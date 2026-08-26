Feature: Unreachable acceptance step handlers are untested-behavior flags on /pilot land and in review prompts

  # BL-753: BL-694 registered a step with no Examples row; three seats called
  # it cosmetic dead code. Harden review prompts and the /pilot land gate so
  # an unmatched registered pattern refuses (or requires an explicit covered-
  # elsewhere answer) instead of being dismissed as a nit.

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-753 unreachable-handler-01
  Scenario: cleaner hardener and architect prompts require the untested-behavior question
    When the cleaner role prompt is read
    Then it requires asking what claim an unreachable step handler was meant to verify
    When the hardener role prompt is read
    Then it requires asking what claim an unreachable step handler was meant to verify
    When the architect role prompt is read
    Then it requires asking what claim an unreachable step handler was meant to verify

  # BL-753 unreachable-handler-02
  Scenario: the /pilot prompt carries the same unreachable-handler rule
    When the offline expeditor prompt is composed for ticket "BL-753"
    Then the prompt requires treating an unreachable step handler as an untested-behavior flag until the claim question is answered

  # BL-753 unreachable-handler-03
  Scenario: A land with a touched step file registering an unmatched pattern refuses
    Given the run's commits touched a step-handler file that registers a pattern
    And the ticket feature file renders no step matching that pattern
    When the pilot runs the landing gate
    Then the land is refused for unreachable step handler
    And the refusal names the pattern or handler file

  # BL-753 unreachable-handler-04
  Scenario: Every registered pattern matching a rendered step lets the land complete
    Given the run's commits touched a step-handler file whose every registered pattern matches a rendered feature step
    When the pilot runs the landing gate
    Then the land is completed

  # BL-753 unreachable-handler-05
  Scenario: A refused unreachable-handler land writes nothing durable
    Given the run's commits touched a step-handler file with an unmatched registered pattern
    When the pilot runs the landing gate
    Then the land is refused for unreachable step handler
    And the ticket yaml stays where it was
    And no acceptance receipt is written
