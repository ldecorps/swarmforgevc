# mutation-stamp: sha256=092a7a48a98b8621d8ecabc61710b7dfbc15dcdd0742cab347d7b9250f6a9aa7
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T14:47:18.228387515Z","feature_name":"a swarm is a composite node","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-244-swarm-is-a-composite-node.feature","background_hash":"8a0d8ebe588367dc222cf872eda2d380c6a9b09abca040659b0697fa7b403ffc","implementation_hash":"unknown","scenarios":[{"index":0,"name":"swarm status rolls up its agents","scenario_hash":"9b24ec134a089228b401af61769607f6fcdda876e87408f9cdf35958c4d5245b","mutation_count":10,"result":{"Total":10,"Killed":10,"Survived":0,"Errors":0},"tested_at":"2026-07-10T14:47:18.228387515Z"}]}
# acceptance-mutation-manifest-end

Feature: a swarm is a composite node

  # Baton fleet epic (BL-242) child. A swarm answers the composite interface
  # (identity/status/health/children) by rolling up its agents. The coordinator
  # computes the rollup; the console never inspects agents directly (layering:
  # fleet -> coordinator -> agents). Transport binding is deferred (operator:
  # clarify later) — these steps are transport-agnostic. depends_on BL-243.

  Background:
    Given a running swarm "second" with a coordinator and a pack of
      | role      |
      | specifier |
      | coder     |
      | cleaner   |

  # BL-244 swarm-composite-01
  Scenario Outline: swarm status rolls up its agents
    Given the pack agents are in states "<agent_states>"
    When the console reads status() for the swarm
    Then the swarm status is "<swarm_status>"

    Examples:
      | agent_states                    | swarm_status |
      | all idle                        | idle         |
      | coder active, others idle       | active       |
      | cleaner blocked, others idle    | blocked      |
      | convergence merging branches    | converging   |
      | all done, convergence complete  | done         |

  # BL-244 swarm-composite-02
  Scenario: swarm identity carries name, project, and coordinator address
    When the console reads identity() for the swarm
    Then it returns name "second"
    And it returns the project the swarm is working
    And it returns the coordinator address to subscribe to

  # BL-244 swarm-composite-03
  Scenario: swarm health reports expected vs live panes
    Given the swarm expects 4 panes
    And 4 panes are live
    When the console reads health() for the swarm
    Then expected_panes is 4
    And live_panes is 4
    And coordinator_alive is true

  # BL-244 swarm-composite-04
  Scenario: drilling into a swarm returns its agents as children
    When the console reads children() for the swarm
    Then it returns one node per pack agent
    And each child answers the same composite interface
