Feature: BL-1247 the BL-593 telemetry property test agrees with the contract it exercises, so the property lane stops flaking

  test/bl593MutationRunTelemetry.property.test.js draws its scope from
  fc.string({ minLength: 1, maxLength: 80 }), whose default charset includes
  the space character, so it emits whitespace-only strings on roughly 1 draw
  in 600 (measured: 8 blank of 5000). buildMutationRunRecord correctly
  refuses those - a whitespace-only scope is not a load-bearing scope - and
  throws "mutation run record requires a non-empty scope". With fast-check's
  default 100 runs per property the file therefore fails about 3 runs in 10:
  measured 6 red in 20 consecutive isolated runs at mint. The production
  guard is right; the generator models a domain wider than the contract
  accepts, so the red carries no information about the code under test.

  Background:
    Given the extension is compiled

  # BL-1247 property-generator-domain-agreement-01
  Scenario: the BL-593 property file is green on every consecutive run
    When "test/bl593MutationRunTelemetry.property.test.js" runs 20 consecutive times in isolation
    Then every one of those runs passes

  # BL-1247 property-generator-domain-agreement-02
  Scenario: the scope generator never emits a value the contract refuses
    When 5000 values are drawn from the scope generator the property uses
    Then every drawn value is accepted by buildMutationRunRecord as a load-bearing scope

  # BL-1247 property-generator-domain-agreement-03
  Scenario Outline: the production guard still refuses a scope that is blank after trimming
    When a mutation run record is built with a scope that is <scope>
    Then building it throws "mutation run record requires a non-empty scope"

    Examples:
      | scope                |
      | a single space       |
      | a single tab         |
      | spaces and a newline |
      | the empty string     |
