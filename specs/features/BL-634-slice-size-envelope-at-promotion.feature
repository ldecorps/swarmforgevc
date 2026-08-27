Feature: promotion flags oversized slice envelopes before a coder starts

  # BL-634: at promotion, a declared size estimate above the measured p90 (~514
  # insertions) or a high band envelope requires an explicit split-or-justify
  # decision. Normal-band slices promote with no added friction. Thresholds are
  # configurable; defaults trace to the 2026-07-25 distribution (median 65).

  Background:
    Given a ticket eligible for promotion into the active backlog

  # BL-634 envelope-gate-01
  Scenario: a BL-590-shaped estimate is refused without a split-or-justify decision
    Given the candidate declares 1929 expected insertions
    And the candidate has no size envelope decision
    When the coordinator promotes the next eligible ticket
    Then the promotion is refused
    And the refusal names the slice size envelope gate

  # BL-634 envelope-gate-02
  Scenario: a median-shaped estimate promotes with no added friction
    Given the candidate declares 65 expected insertions
    When the coordinator promotes the next eligible ticket
    Then the candidate is promoted

  # BL-634 envelope-gate-03
  Scenario: a high band envelope requires an explicit decision
    Given the candidate declares a high size envelope band
    And the candidate has no size envelope decision
    When the coordinator promotes the next eligible ticket
    Then the promotion is refused

  # BL-634 envelope-gate-04
  Scenario: a recorded split-or-justify decision clears a high band envelope
    Given the candidate declares a high size envelope band
    And the candidate records a justified size envelope decision
    When the coordinator promotes the next eligible ticket
    Then the candidate is promoted

  # BL-634 envelope-gate-05
  Scenario: the p90 flag threshold is configurable
    Given the promotion gate uses a p90 flag of 100 insertions
    And the candidate declares 120 expected insertions
    And the candidate has no size envelope decision
    When the coordinator promotes the next eligible ticket
    Then the promotion is refused

  # BL-634 envelope-gate-06
  Scenario: QA records actual insertions and files on the ticket
    When QA records actual slice size as 1929 insertions and 18 files
    Then the ticket carries actual_insertions and actual_files fields
