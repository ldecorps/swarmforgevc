Feature: Phone recertification composes to a real, deliverable inbound address

  Background:
    Given the phone app builds a mailto: link for a recertification action

  # BL-223 recert-address-01
  Scenario: the recert mailto targets the configured inbound address
    Given a configured inbound recertification address on a domain we control
    When the human taps a recertification send action
    Then the composed mailto is addressed to that configured address

  # BL-223 recert-address-02
  Scenario: the reserved .invalid placeholder is never used
    Given the phone app resolves the recertification send address
    When it builds the mailto: link
    Then the address is not on the reserved .invalid TLD
