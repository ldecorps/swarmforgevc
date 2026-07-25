Feature: ticket invariants section distinct from acceptance

  Gherkin scenarios are examples: concrete input to concrete expected output.
  A property that must hold across every scenario — including the ones nobody
  wrote down — had nowhere to live in the ticket schema, so it got discovered
  one violating site per review round (BL-590: four architect send-backs on
  one unstated idempotency property; BL-606: three on one routing property).
  This slice adds an `invariants:` field to the ticket schema, teaches the
  specifier to state such properties up front, and teaches the architect to
  review them as a distinct pass with one bounce per property, not per site.

  # BL-633 invariants-section-01
  Scenario: the backlog schema documents the invariants field
    Given the backlog schema document
    Then it documents an optional invariants field distinct from acceptance
    And it states that scenarios are examples and an invariant is a property across the whole slice
    And it states a cap of three entries with the rationale that needing more means the slice is too big
    And it states that an absent or empty invariants list is a legitimate outcome

  # BL-633 invariants-section-02
  Scenario: the specifier prompt instructs stating cross-scenario properties before writing scenarios
    Given the specifier role prompt
    Then it instructs asking what must hold across all scenarios before writing them
    And it instructs recording each such property in the ticket invariants list
    And it states that an absent or empty invariants list is a legitimate outcome

  # BL-633 invariants-section-03
  Scenario: the architect prompt instructs a distinct invariants pass with one bounce per property
    Given the architect role prompt
    Then it instructs reviewing the parcel against each declared invariant as a distinct pass
    And it instructs sweeping every site violating the same invariant before sending back
    And it instructs one bounce per violated property rather than one per site

  # BL-633 invariants-section-04
  Scenario: an existing ticket reader tolerates the new field
    Given a hygienic backlog fixture with two tickets identical except one declares an invariants list
    When the epic and milestone audit parses the fixture
    Then the audit exits zero
    And the fields the audit already reads parse identically for both tickets

  # BL-633 invariants-section-05
  Scenario: BL-590 carries its redelivery idempotency invariant as the worked example
    Given the BL-590 ticket in the backlog hold folder
    Then its invariants list includes the durable-write redelivery idempotency property
    And the backlog schema document cites the BL-590 invariant as its worked example
