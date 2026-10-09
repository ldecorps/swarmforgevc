Feature: BL-2071 fixture: a feature whose one step has no handler

# A fixture feature for local_seat_acceptance_gate_lib.bb's own test (BL-2071) -
# never minted as a real ticket, and deliberately given no step handler
# anywhere in the registry, so a real run of it surfaces runtime.js's own
# "no step handler matched" failure (specs/pipeline/runtime.js:73) rather
# than a hand-simulated one.

  # bl2071-unresolved-step-01
  Scenario: a step nobody implemented
    Then the bl2071 fixture step nobody implemented runs
