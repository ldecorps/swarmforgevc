Feature: A forward hop that jumps stages is recorded whatever the ticket declares

  The routing-skips record is the only durable evidence that a parcel
  bypassed a pipeline stage. Today it is written only when a ticket carries
  a usable required_stages declaration; a ticket with no declaration at all
  - the default, and the conservative case - produces no envelope header and
  no log line, so the jump is invisible to any later audit.

  Background:
    Given required_stages routing is enabled
    And the ticket "BL-951-probe" is active

  # BL-951 skip-recorded-regardless-of-declaration-01
  # BL-991 removed the `full-chain` row. This outline is about a coder-to-QA
  # hop being RECORDED whatever the declaration says; under BL-991's ruling a
  # full-chain declaration no longer lets that hop happen at all - it is
  # redirected to cleaner and skips nothing, so the row asserted a jump the
  # declaration now forbids. `absent` and `invalid` both resolve to
  # default-full, where sender judgement still stands, so both rows are
  # untouched and this outline still covers exactly what BL-951 was for. The
  # full-chain case now lives in BL-991's own scenario 01, in its binding form.
  Scenario Outline: A coder-to-QA hop records the skipped stages for every declaration state
    Given the ticket's required_stages declaration is <declaration>
    When the coder sends a git_handoff addressed to QA
    Then the handoff envelope carries a routing_skipped header naming cleaner, architect, hardender and documenter
    And exactly one routing-skips log line records those same four stages

    Examples:
      | declaration |
      | absent      |
      | invalid     |

  # BL-951 adjacent-hop-records-nothing-02
  Scenario: An adjacent forward hop skips nothing and records nothing
    Given the ticket's required_stages declaration is absent
    When the coder sends a git_handoff addressed to cleaner
    Then the handoff envelope carries no routing_skipped header
    And no routing-skips log line is written

  # BL-951 rejection-reason-recorded-03
  Scenario: An invalid declaration records why it was rejected
    Given the ticket's required_stages declaration is invalid
    When the coder sends a git_handoff addressed to QA
    Then the recorded skip carries the rejection reason for that declaration

  # BL-951 delivery-unchanged-04
  Scenario: Recording a skip does not change who receives the parcel
    Given the ticket's required_stages declaration is absent
    When the coder sends a git_handoff addressed to QA
    Then the parcel is delivered to QA and to no other role

  # BL-951 backward-bounce-is-not-a-skip-05
  Scenario: A backward bounce is not a skip
    Given the ticket's required_stages declaration is absent
    When QA sends a git_handoff addressed to coder
    Then the handoff envelope carries no routing_skipped header
    And no routing-skips log line is written
