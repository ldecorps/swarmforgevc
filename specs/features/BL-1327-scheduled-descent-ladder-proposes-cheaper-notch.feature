Feature: BL-1327 Scheduled descent ladder proposes a cheaper effort-then-model notch per seat

  BL-545's epic remaining_slices names a periodic descent ladder: walk a
  well-performing seat down through effort notches before model notches,
  one notch per review period, with asymmetric hysteresis — a guard trip
  climbs back immediately, a further descent requires several clean
  periods. BL-1316 (claim-time baseline) and BL-1317 (bounce-driven climb)
  already give this feature its notch state machine and its climb half;
  this feature is the scheduled descent half, and Slice 1 only ever
  PROPOSES a notch — it never applies one on its own (governance boundary
  named on the epic and on BL-1056: no autonomous seat mutation).

  Background:
    Given a seat with a guard window computed from bounce and QA outcomes for the tickets it has held
    And the seat's current position on the effort-then-model descent ladder

  # BL-1327 clean-streak-surfaces-effort-proposal-01
  Scenario: a sustained clean streak surfaces the next effort notch as a proposal
    Given the seat has stayed guard-clean for the configured number of review periods at its current notch
    When the scheduled descent review runs
    Then a descent proposal names the next lower effort notch to try
    And no seat's live model or effort changes as a result of the proposal

  # BL-1327 effort-exhausted-before-model-02
  Scenario: effort is exhausted before a cheaper model is proposed
    Given the seat is already at the lowest effort notch for its current model
    When the scheduled descent review runs
    Then the proposal names the next cheaper model at high effort, not at low effort
    And the proposal records the reason a smaller model starts at higher effort

  # BL-1327 guard-trip-climbs-back-immediately-03
  Scenario: a guard trip discards clean-period progress and climbs back immediately
    Given the seat had partial progress toward the clean-period threshold at a previously descended notch
    When a guard trip is recorded for that seat
    Then the seat's ladder position climbs back to the last known-good notch immediately
    And the discarded clean-period progress does not carry forward

  # BL-1327 price-window-shift-rewalks-terminal-04
  Scenario: a price window shift re-walks the terminal state instead of freezing it
    Given a seat's terminal notch was chosen using the price validity windows BL-1056 makes queryable
    When the price window for that model shifts
    Then the descent review re-evaluates the terminal state against the new window
    And a changed terminal notch is surfaced as a new proposal, not silently adopted
