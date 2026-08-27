Feature: Approval ask cannot outlive its backlog yaml

  # BL-1190: systemic fix for ghost approval asks (BL-1186 incident). An
  # Approvals button must not post unless live yaml exists; stale asks must
  # reconcile when yaml disappears; specifier spec-ready must not ship without
  # committed yaml on main.

  Background:
    Given the front desk approval machinery is running against a fixture swarm root

  # BL-1190 refuse-post-without-yaml-01
  Scenario: ApprovalRequested is not emitted when the ticket yaml is missing
    Given ticket "BL-1190" has a topic record but no yaml in backlog active or paused
    When the concierge evaluates pending approval for "BL-1190"
    Then no ApprovalRequested event is emitted for "BL-1190"
    And no buttoned approval ask is registered for "BL-1190"

  # BL-1190 stale-ask-reconcile-02
  Scenario: A registered approval ask is marked stale when its yaml disappears
    Given ticket "BL-1190" had a buttoned approval ask registered yesterday
    And the yaml for "BL-1190" no longer exists on disk
    When the approval ask reconcile sweep runs
    Then the ask for "BL-1190" is closed or marked stale in the Approvals topic
    And tapping Approve returns an honest stale-ask outcome instead of a silent no-op loop

  # BL-1190 no-ticket-file-honest-03
  Scenario: Approve on a missing yaml returns no-ticket-file without leaving live buttons
    Given a buttoned approval ask exists for ticket "BL-1190"
    And no yaml exists for "BL-1190"
    When the principal taps Approve for "BL-1190"
    Then the tap records reason "no-ticket-file"
    And the ask is removed or marked stale so repeat taps cannot recur indefinitely

  # BL-1190 mint-durability-gate-04
  Scenario: Specifier spec-ready handoff refuses when paused yaml is not committed
    Given the specifier announces spec-ready for "BL-1190" without a committed paused yaml path
    When the mint durability gate runs for that handoff
    Then the gate refuses with a reason naming the missing yaml path
    And no ApprovalRequested path is armed for "BL-1190"
