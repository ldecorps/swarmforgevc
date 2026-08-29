Feature: A ticket held in backlog/hold/ while its parcel is still moving is reported

  `backlog/hold/` means human-held: Article 3.1 forbids auto-promotion out of
  it, and `promotion_gates_lib` refuses to auto-pick from it. That is correct
  for a ticket a human parked.

  But parking moves a ticket's YAML, not its parcel. The expeditor parks every
  other `active/` ticket into `hold/` at initiation and deliberately declines to
  promote them back — "promotion is not the expeditor's call". A parcel already
  in a role's mailbox is untouched by that move, so the pipeline goes on
  building, reviewing and gating a ticket whose backlog record says nobody may
  touch it. When it reaches QA, the coordinator's bookkeeping looks in
  `active/`, finds nothing, and the ticket has no pool to be closed from.

  Nothing reconciles the two views today. This audit reports the divergence. It
  never resolves it: which pool a ticket belongs in is the coordinator's and the
  human's call, not a tool's.

  Background:
    Given a backlog with pools active, paused, hold and done
    And role mailboxes that may hold parcels

  # BL-1261 hold-divergence-audit-01
  Scenario: A held ticket whose parcel is live is reported
    Given ticket BL-9001 is in backlog/hold/
    And a parcel naming BL-9001 is in a role's inbox
    When the audit runs
    Then the audit reports BL-9001 as held-with-a-live-parcel
    And the report names the mailbox the parcel was found in

  # BL-1261 hold-divergence-audit-02
  Scenario Outline: Only the held-plus-live pairing is a divergence
    Given ticket BL-9001 is in backlog/<pool>/
    And the ticket <parcel state>
    When the audit runs
    Then the audit <verdict>

    Examples:
      | pool   | parcel state              | verdict                |
      | hold   | has a live parcel         | reports a divergence   |
      | hold   | has no parcel anywhere    | reports no divergence  |
      | active | has a live parcel         | reports no divergence  |
      | active | has no parcel anywhere    | reports no divergence  |
      | paused | has no parcel anywhere    | reports no divergence  |

  # BL-1261 hold-divergence-audit-03
  Scenario: A parcel inside a batch subdirectory still counts as live
    Given ticket BL-9001 is in backlog/hold/
    And a parcel naming BL-9001 is inside a batch subdirectory of a role's inbox
    When the audit runs
    Then the audit reports BL-9001 as held-with-a-live-parcel

  # BL-1261 hold-divergence-audit-04
  Scenario: The audit reports and changes nothing
    Given ticket BL-9001 is in backlog/hold/
    And a parcel naming BL-9001 is in a role's inbox
    When the audit runs
    Then ticket BL-9001 is still in backlog/hold/
    And no ticket has moved between pools
    And no parcel has been removed from any mailbox

  # BL-1261 hold-divergence-audit-05
  Scenario: A mailbox the audit cannot read is reported, never assumed clean
    Given ticket BL-9001 is in backlog/hold/
    And one role's inbox cannot be read
    When the audit runs
    Then the audit reports that role's mailbox as unresolved
    And the audit does not report the backlog as clean
