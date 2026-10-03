Feature: No script defaults to one user's home checkout

  start_bridge_headless.sh lets an onboarded project with no extension build
  borrow a compiled bridge entrypoint from BRIDGE_EXTENSION_HOST_ROOT
  (9a3063a071). Its default is the literal /home/carillon/swarmforgevc. On
  any other host, including the macOS host this swarm moved from, the
  fallback silently finds nothing. On this host a fixture root with no build
  silently borrows the live checkout's, which is how BL-1886's bridge test
  went green for the wrong reason. wait_for_expedite_then_bedtime.sh
  defaults its project root to the same literal. Both now default to the
  checkout the running script belongs to.

  # BL-1909 the-bridge-falls-back-to-its-own-checkout-01
  # The fixture checkout holds its own copy of the script under
  # swarmforge/scripts/, so "its own checkout" is the fixture, never the live
  # repository (BL-1390).
  Scenario Outline: the bridge entrypoint is chosen without naming a home directory
    Given a fixture checkout holding a copy of start_bridge_headless.sh and its own compiled bridge entrypoint
    And a project root that "<project build>"
    And BRIDGE_EXTENSION_HOST_ROOT "<override>"
    When start_bridge_headless.sh is dry-run for that project root
    Then the bridge command it prints starts the entrypoint under "<expected>"

    Examples:
      | project build               | override                             | expected             |
      | has its own compiled bridge | is unset                             | the project root     |
      | has no compiled bridge      | is unset                             | the fixture checkout |
      | has no compiled bridge      | names a second checkout with a build | the second checkout  |

  # BL-1909 no-script-defaults-to-a-home-path-02
  Scenario: no non-test script defaults a path to a home directory
    When every non-test shell script under swarmforge/scripts is searched for a parameter default that starts with /home/ or /Users/
    Then none is found
    And the searched set includes start_bridge_headless.sh and wait_for_expedite_then_bedtime.sh
