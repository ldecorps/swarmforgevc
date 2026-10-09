Feature: BL-2071 fixture: a two-scenario feature driven by marker files

# A fixture feature for local_seat_acceptance_gate_lib.bb's own test (BL-2071) -
# never minted as a real ticket. Each scenario reads a marker file the
# fixture harness writes before invoking the real acceptance pipeline, so
# the harness controls pass/fail deterministically without touching the
# feature or its step handler between runs.

  # bl2071-marker-pair-01
  Scenario: marker A
    Then the bl2071 fixture marker "A" says pass

  # bl2071-marker-pair-02
  Scenario: marker B
    Then the bl2071 fixture marker "B" says pass
