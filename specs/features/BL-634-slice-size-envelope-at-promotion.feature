Feature: promotion requires split-or-justify when a slice declares a top-band size envelope

  # BL-634: BL-590 "slice 1" landed 1929 insertions / 18 files against a 65-insertion
  # median (above p99 of ticket-bearing commits). mutation_cost already sequences
  # work; this adds a declared size_envelope band and a promotion check in the
  # existing promotion_gates_lib chain (shared with BL-626), plus QA-time actuals
  # so estimates can calibrate. A hard refuse of the specifier's own estimate
  # without a justify path is theatre — the gate makes size visible and demands
  # an explicit decision, and does not overrule a recorded human/specifier
  # justification.

  # Bands (defaults from the 2026-07-25 measured distribution; configurable):
  #   normal  — expected insertions at or below p90 (~500); default when omitted
  #   large   — above p90 up to p99 (~500–1500)
  #   xlarge  — above p99 (~1500+)

  Background:
    Given a ticket eligible for promotion into the active backlog
    And promotion decisions go through promotion_gates_lib evaluate

  # BL-634 top-band-without-justify-refuses-01
  Scenario Outline: a top-band envelope without a recorded split-or-justify decision is refused
    Given the candidate declares size_envelope "<band>"
    And the candidate has no recorded size_justification
    When the coordinator promotes the next eligible ticket
    Then the promotion is refused
    And the refusal names the size_envelope gate and the missing justification

    Examples:
      | band   |
      | large  |
      | xlarge |

  # BL-634 top-band-with-justify-promotes-02
  Scenario: a top-band envelope with a recorded split-or-justify decision promotes
    Given the candidate declares size_envelope "xlarge"
    And the candidate records size_justification naming why the slice stays unsplit
    When the coordinator promotes the next eligible ticket
    Then the candidate is promoted
    And the size_envelope gate does not refuse it

  # BL-634 normal-band-no-friction-03
  Scenario Outline: a normal-band or omitted envelope promotes with no new friction
    Given the candidate's size_envelope is <envelope>
    When the coordinator promotes the next eligible ticket
    Then the candidate is promoted
    And no size_justification is demanded of it

    Examples:
      | envelope                          |
      | normal                            |
      | absent (field omitted)            |

  # BL-634 thresholds-configurable-04
  Scenario: size-envelope thresholds are configurable and default to the measured distribution
    Given the promotion size thresholds are read from configuration not hard-coded literals alone
    When the defaults are inspected
    Then the large flag threshold defaults near five hundred insertions (p90)
    And the xlarge threshold defaults near fifteen hundred insertions (p99)
    And the ticket or how-to names the 2026-07-25 commit-distribution source so the numbers can be re-derived

  # BL-634 qa-records-actual-size-05
  Scenario: QA records actual insertions and file count on the ticket
    Given a ticket has completed implementation and reached QA
    When QA records the land outcome for that ticket
    Then the ticket carries size_actual with insertions and files
    And those actuals are durable on the ticket yaml for later estimate calibration

  # BL-634 bl590-shape-trips-gate-06
  Scenario: a BL-590 slice-1 shaped declaration trips the gate; a median shape does not
    Given a candidate declaring size_envelope "xlarge" for a nineteen-hundred-insertion eighteen-file envelope with no size_justification
    When the coordinator promotes the next eligible ticket
    Then the promotion is refused by the size_envelope gate
    Given a candidate declaring size_envelope "normal" for a sixty-five-insertion median shape
    When the coordinator promotes the next eligible ticket
    Then the candidate is promoted

  # BL-634 shares-bl626-gate-chain-07
  Scenario: the size envelope check lives in the shared promotion_gates_lib chain
    Given promotion_gates_lib evaluate is the single promotion chokepoint
    When a top-band ticket without justification is evaluated
    Then the refusal is emitted from that shared evaluate chain
    And no parallel independent size-only promotion path is introduced

  # BL-634 human-justified-oversized-not-overruled-08
  Scenario: a human-requested oversized slice with justification is not blocked
    Given the candidate declares size_envelope "xlarge"
    And size_justification records that the human requested the slice stay large
    When the coordinator promotes the next eligible ticket
    Then the candidate is promoted
