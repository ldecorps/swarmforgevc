Feature: Handoff-mail wakes do not flood the Cursor follow-up bar

  # BL-1191: when the daemon re-notifies for unchanged mailbox state, suppress
  # or collapse duplicate HANDOFF_WAKE_MESSAGE injections so the agent pane
  # shows one actionable nudge, not N identical follow-ups. Literal unchanged
  # (BL-152). Builds on BL-870 attribution for auditable dedup decisions.

  Background:
    Given the handoff wake dedup gate is armed for a role pane

  # BL-1191 suppress-unchanged-mailbox-01
  Scenario: repeated notifies for the same unchanged mailbox do not stack follow-ups
    Given role "coordinator" has one parcel in new unchanged for "120" seconds
    And a handoff-mail wake was already injected for that parcel fingerprint
    When the chase sweep decides to notify again with the same mailbox fingerprint
    Then no new HANDOFF_WAKE_MESSAGE injection is sent
    And the dedup record names skip reason unchanged-mailbox

  # BL-1191 one-parcel-one-nudge-02
  Scenario: a genuinely new parcel produces exactly one wake
    Given role "specifier" has no prior wake fingerprint for the current mailbox state
    When a new handoff parcel arrives in new
    And the chase sweep decides to notify
    Then exactly one HANDOFF_WAKE_MESSAGE injection is sent
    And a wake attribution record names the motivating handoff filename

  # BL-1191 empty-mailbox-no-stack-03
  Scenario: empty mailbox does not stack wakes on repeated sweeps
    Given role "coordinator" has an empty mailbox
    And a false wake was already suppressed or attributed as none
    When the chase sweep runs again within the dedup window
    Then no HANDOFF_WAKE_MESSAGE injection is sent
    And attribution records explicit none with skip reason

  # BL-1191 cooldown-pacing-04
  Scenario: dedup respects chase cooldown within the bounded window
    Given role "coder" was notified for parcel fingerprint "fp-abc" within the cooldown window
    When the sweep would notify again before cooldown elapses
    Then the wake is suppressed
    And the skip reason names cooldown not a fresh parcel
