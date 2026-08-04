Feature: promote-and-route survives BSD sed hosts

  # BL-803: promote_and_route_next.sh:218 rewrites assigned_to with a
  # GNU-only `sed -i` (no suffix operand). BSD/macOS sed rejects that
  # invocation, and under set -euo pipefail the script dies after the
  # git mv but before the promotion commit and the route step — leaving a
  # half-promoted, uncommitted, unrouted ticket the coordinator must
  # finish by hand (live instance: BL-802 promote, commit 275a8ebb).

  # BL-803 promote-completes-portable-sed-01
  Scenario Outline: promotion completes end to end regardless of sed flavor
    Given a fixture backlog with one eligible paused ticket routed to coder
    And the host sed is <sed_flavor>-flavored
    When promote_and_route_next.sh runs
    Then the ticket file sits in backlog/active with assigned_to rewritten to coder
    And the promotion commit exists
    And the Work route to coder is sent

    Examples:
      | sed_flavor |
      | bsd        |
      | gnu        |
