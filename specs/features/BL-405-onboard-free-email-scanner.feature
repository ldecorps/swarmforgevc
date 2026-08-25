Feature: onboarding negotiation is run against the free-email-scanner target

  Background:
    Given the existing onboarding-negotiation machinery
    And the target repository https://github.com/ldecorps/free-email-scanner

  # BL-405 onboard-free-email-scanner-01
  Scenario: surveying the target repo produces a proposed scope contract
    Given the target repo has been surveyed
    When the onboarding proposal tooling runs
    Then a proposed scope contract naming the target's edges is produced

  # BL-405 onboard-free-email-scanner-02
  Scenario: the proposed contract is delivered through the existing negotiation loop
    Given a proposed scope contract for the target
    When onboarding negotiation runs
    Then the contract is delivered through the iterative negotiation loop

  # BL-405 onboard-free-email-scanner-03
  Scenario: the human can approve or amend the contract via the existing channel
    Given a delivered proposed contract awaiting the human's response
    When the human replies through the negotiation Telegram relay
    Then the reply is applied as an approval or an amendment to the contract

  # BL-405 onboard-free-email-scanner-04
  Scenario: a negotiated contract is not treated as approved until the human confirms
    Given a proposed contract that has been amended but not yet confirmed
    When onboarding checks the contract's approval state
    Then it is not treated as approved
