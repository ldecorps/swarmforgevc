# mutation-stamp: sha256=892c57e3c6cf8a4ba5c66ca5862c1873f6f75c935f6ab7e76d7294e125120de5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-05T01:33:23.467370Z","feature_name":"promote-and-route survives BSD sed hosts","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-803-promote-route-sed-bsd-portability.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"promotion completes end to end regardless of sed flavor","scenario_hash":"9731914e276b12932189bf6074a2d4845a650c0401762507bbbdc7c0d0f6e04d","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-05T01:33:23.467370Z"}]}
# acceptance-mutation-manifest-end

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
