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
