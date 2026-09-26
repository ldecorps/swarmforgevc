# mutation-stamp: sha256=d4fb90ede042b62c9cbb33cfb80ac04ceebcb0a3169af0db5f2850d5d2d13f04
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-26T00:27:32.662575214Z","feature_name":"BL-1704 the swarm stop paths stop the ollama server the swarm started","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1704-the-swarm-stop-paths-stop-the-ollama-server-the-swarm-started.feature","background_hash":"d81d214fcc723865e5e81d2dea6b25285b360bfa04396330d2b0ddae71b3efe6","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a stop path stops a swarm-owned server and its runner","scenario_hash":"4b27e3cc484f2b36d3b1f5edd04c53b92dbec14bc593e64386fdc13d81dbf980","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-26T00:27:32.662575214Z"},{"index":2,"name":"a record that no longer matches a live server is cleared without killing anything","scenario_hash":"988ee9d0cf32118ce2a2549544cceeb063882c449dcdd629470a02af4fe1e418","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-26T00:27:32.662575214Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1704 the swarm stop paths stop the ollama server the swarm started

  BL-1703 records whether the running ollama server was started by the
  swarm or found already running. The full-stack stop and kill_all_swarm
  now stop a swarm-owned server together with its model runner children,
  and leave an external one running, naming it in the stop log. A record
  whose process is gone, or whose pid now belongs to something else, is
  cleared without killing anything. The scenarios use stand-in ollama
  processes.

  Background:
    Given a throwaway project with a stand-in ollama server and one runner child

  # BL-1704 the-swarm-stop-paths-stop-the-ollama-server-01
  Scenario Outline: a stop path stops a swarm-owned server and its runner
    Given the ollama record says the server is "swarm-owned"
    When the operator runs "<stop path>"
    Then neither the server nor its runner child is running
    And the ollama record is gone

    Examples:
      | stop path            |
      | the full-stack stop  |
      | kill_all_swarm       |

  # BL-1704 the-swarm-stop-paths-stop-the-ollama-server-02
  Scenario: a stop leaves an external server running and says so
    Given the ollama record says the server is "external"
    When the operator runs "the full-stack stop"
    Then the server and its runner child are still running
    And the stop log names the external server as left running

  # BL-1704 the-swarm-stop-paths-stop-the-ollama-server-03
  Scenario Outline: a record that no longer matches a live server is cleared without killing anything
    Given the ollama record says the server is swarm-owned with a pid that <pid state>
    When the operator runs "the full-stack stop"
    Then no process was signalled
    And the ollama record is gone and the stop log says why

    Examples:
      | pid state                           |
      | is no longer running                |
      | now belongs to a process that is not ollama serve |
