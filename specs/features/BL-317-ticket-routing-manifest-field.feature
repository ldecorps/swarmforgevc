Feature: A backlog ticket can declare its required role set, defaulting to the full chain

  # BL-317 routing-manifest-field-01
  Scenario: a ticket with no roles: field defaults to the full chain
    Given a ticket YAML with no roles: field
    When the routing manifest is read
    Then it reports the full standard pipeline chain

  # BL-317 routing-manifest-field-02
  Scenario: a ticket with an explicit roles: list is read back as declared
    Given a ticket YAML declaring roles: [coder, QA]
    When the routing manifest is read
    Then it reports exactly that list

  # BL-317 routing-manifest-field-05
  Scenario: a block-style roles: list is read back as declared
    Given a ticket YAML declaring a block-style roles: list of coder and QA
    When the routing manifest is read
    Then it reports exactly that list

  # BL-317 routing-manifest-field-06
  Scenario: a present-but-unreadable roles: field is rejected, not treated as absent
    Given a ticket YAML whose roles: field is present but cannot be parsed
    When the routing manifest is validated
    Then it is rejected before promotion
    And it does not silently report the full standard pipeline chain

  # BL-317 routing-manifest-field-03
  Scenario: a roles: list missing coder or QA is rejected
    Given a ticket YAML declaring a roles: list that omits coder or QA
    When the routing manifest is validated
    Then it is rejected before promotion

  # BL-317 routing-manifest-field-04
  Scenario: a roles: list naming coordinator or an unknown role is rejected
    Given a ticket YAML declaring a roles: list that names coordinator or an unknown role
    When the routing manifest is validated
    Then it is rejected before promotion
