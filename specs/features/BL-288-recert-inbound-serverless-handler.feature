Feature: Deployed recert inbound webhook handler wires the BL-217 core to commit proposals

  Background:
    Given the recert inbound webhook handler wraps the BL-217 core with env-sourced deps

  # BL-288 recert-handler-01
  Scenario: a signed inbound email from an allowed sender commits a recert proposal
    Given a signed inbound webhook POST from an allowed sender
    When the handler processes the request
    Then it commits a recert proposal and responds with success

  # BL-288 recert-handler-02
  Scenario: a POST with no valid signature commits nothing and is rejected
    Given an inbound webhook POST carrying no valid signature
    When the handler processes the request
    Then no recert proposal is committed
    And the response is a rejection

  # BL-288 recert-handler-03
  Scenario: signature verification runs against the exact raw request body
    Given an inbound webhook POST with a signed raw payload
    When the handler builds the core request
    Then it passes the exact raw body bytes to the core, not a re-serialized copy

  # BL-288 recert-handler-04
  Scenario: with no signing secret in the environment the handler commits nothing
    Given the signing secret is absent from the handler's environment
    When the handler processes the request
    Then no recert proposal is committed

  # BL-288 recert-handler-05
  Scenario: the core's status and body become the HTTP response
    Given the core returns a status and body for a processed request
    When the handler finishes
    Then the HTTP response carries that status and that body
