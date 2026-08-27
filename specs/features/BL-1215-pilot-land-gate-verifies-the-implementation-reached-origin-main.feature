Feature: the pilot acceptance gate marks a ticket done only once its implementation is reachable from origin/main

  # BL-1215 (epic swarm-reliability). Operator intake
  # .swarmforge/operator/INTAKE-bl1191-pilot-cleanup-gate-before-restart.md
  # (human Laurent via Cursor, 2026-08-27 ~16:39 BST) names this as an
  # explicitly OPTIONAL specifier follow-on, separate from that intake's own
  # restart hold: "If 'pilot claimed done but did not land on origin/main' is
  # still an unowned process gap after BL-727/BL-701, mint a separate defect."
  #
  # It is still unowned, verified by reading the gate rather than assuming:
  # extension/src/tools/pilotAcceptanceGate.ts contains no reference to
  # origin/main, no push, and no ancestry check. Its land step captures
  # `deps.getLandedCommit()` (local HEAD) and then moves the ticket YAML to
  # backlog/done/. "Done" is therefore a fact about one local checkout, never
  # about the durable remote — so an expedition whose work never reached
  # origin/main still writes a passing receipt and a done ticket.
  #
  # That is exactly how BL-1158 failed earlier the same day: the
  # implementation existed in worktrees and in-session but not on
  # origin/main, and the run still read as successful.
  #
  # Deliberate contrast with BL-729: that check fails OPEN (`checked: false`)
  # when a run's own commit range cannot be resolved, because an unresolvable
  # range is not evidence of a defect. This one fails CLOSED — an origin/main
  # that cannot be read is not evidence the work landed, and treating it as
  # such is the whole defect.

  Background:
    Given a piloted ticket whose acceptance contract has just passed

  # BL-1215 unlanded-implementation-refuses-done-01
  Scenario: An implementation that never reached origin/main does not become a done ticket
    Given the run's implementation commit is not reachable from origin/main
    When the pilot acceptance gate reaches its land step
    Then the ticket yaml is not moved to backlog/done/
    And the refusal names the implementation commit that is missing from origin/main
    And no passing acceptance receipt is written for the run

  # BL-1215 landed-implementation-still-lands-02
  Scenario: An implementation that did reach origin/main lands exactly as it does today
    Given the run's implementation commit is reachable from origin/main
    When the pilot acceptance gate reaches its land step
    Then the ticket yaml is moved to backlog/done/
    And a passing acceptance receipt is written for the run

  # BL-1215 unreadable-origin-fails-closed-03
  Scenario: An origin/main that cannot be read is treated as not landed, never as landed
    Given origin/main cannot be read at all
    When the pilot acceptance gate reaches its land step
    Then the ticket yaml is not moved to backlog/done/
    And the refusal says origin/main could not be read
