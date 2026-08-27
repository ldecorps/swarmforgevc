# mutation-stamp: sha256=2d60b2c88b5a4eec0dcce64f8664372d3f0311e06be39ec9de52e36bb77f4fad
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T13:35:18.692894207Z","feature_name":"BL-888 pipeline teardown copilot kill scope","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-888-teardown-copilot-kill-scope.feature","background_hash":"fc00f4323402692105c13dd97be5d3c62e612d9af156b85651e5605c25c16f45","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the copilot kill signals only the root under teardown's agents","scenario_hash":"ebadc977d356fc7286887c6a0e74977f62c8391c467689cc1b0b69e6dc4effde","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-25T13:35:18.692894207Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-888 pipeline teardown copilot kill scope

  kill_pipeline_swarm.sh step 5 signals SwarmForge copilot agent processes
  only when their argv names the root under teardown (typically via
  `-C '<worktree under $ROOT>'` from launch_body). An unscoped
  `pkill -f 'copilot.*SwarmForge'` would match ANY project root on the host;
  tearing down one pipeline must never signal a sibling root's agents.

  Background:
    Given a project root under teardown

  # BL-888 teardown-copilot-kill-scope-01
  Scenario Outline: the copilot kill signals only the root under teardown's agents
    Given a copilot-shaped fixture process whose command line names <process root>
    When kill_pipeline_swarm.sh runs against the root under teardown
    Then the fixture process is <fate>
    And the teardown log reports "<log line>"

    Examples:
      | process root             | fate          | log line                                   |
      | a different project root | still running | no SwarmForge copilot processes            |
      | the root under teardown  | signaled      | signaled SwarmForge copilot processes      |

  # BL-888 teardown-copilot-kill-scope-02
  Scenario: no copilot processes present is not a failure
    Given no copilot-shaped process on the host
    And an otherwise clean teardown condition
    When kill_pipeline_swarm.sh runs against the root under teardown
    Then the teardown log reports "no SwarmForge copilot processes"
    And the teardown exits zero
