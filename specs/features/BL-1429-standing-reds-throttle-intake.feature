# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T19:17:20.347406864Z","feature_name":"BL-1429 Standing reds throttle intake","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1429-standing-reds-throttle-intake.feature","background_hash":"bda8893e89ec7e5dfa2902f20fd7af6eeddac1fc45f0c00604b4a1d205bf4ac7","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: BL-1429 Standing reds throttle intake

  Article 3.5 lets the coordinator lower active_backlog_max_depth when
  health signals spike, and BL-432 automated it: emit-throttle-recommendation
  turns the rework diagnosis into a recommended cap that
  effective_backlog_depth_cli.bb folds in as min(configured, recommended) at
  every promotion decision. Standing reds were never a signal, so twenty
  property and seven unit reds accumulated on main over a week while the
  swarm kept promoting features past them. Human, 2026-09-05, verbatim: "i
  would be more of the school of.stoping everything and fix failing tests
  before doing anything else." Thresholds ruled the same day: more than 10
  reds, or an oldest red older than 7 days, or any unowned red, recommends
  a cap of 1.

  This feature is that the standing-red register (BL-1428) is a throttle
  input: the emitter reads the register, recommends 1 when any threshold is
  crossed, keeps the lower of its two recommendations, logs every change
  with the signal that caused it, and withdraws the recommendation as soon
  as the register is back under every threshold. Thresholds are read from
  swarmforge.conf so the human can move them. Every scenario runs against a
  fixture root under a temporary directory, never the live checkout.

  Background:
    Given a fixture root with a throttle recommendation store, a standing-red register and a swarmforge.conf with the default thresholds

  # BL-1429 the-register-recommends-a-cap-01
  Scenario Outline: the register recommends a cap only past a threshold
    Given the register reports <count> reds, an oldest age of <age> days and <unowned> unowned
    When the throttle recommendation is emitted
    Then the recommended cap is <cap>
    And the recorded reason names <signal>

    Examples:
      | count | age | unowned | cap  | signal                 |
      | 3     | 2   | 0       | none | no standing-red signal |
      | 11    | 2   | 0       | 1    | the red count          |
      | 3     | 8   | 0       | 1    | the oldest red's age   |
      | 3     | 2   | 1       | 1    | an unowned red         |

  # BL-1429 the-lower-recommendation-wins-02
  Scenario: the rework diagnosis and the register never raise each other
    Given a rework diagnosis that recommends a cap of 0
    And the register is over the count threshold alone
    When the throttle recommendation is emitted
    Then the emitted recommendation is the rework diagnosis's 0

  # BL-1429 recovery-withdraws-the-recommendation-03
  Scenario: a register back under every threshold withdraws the recommendation and logs the change
    Given a prior recommendation of 1 caused by the red count
    And the register has fallen back under every threshold
    When the throttle recommendation is emitted
    Then the recommendation is withdrawn
    And the change from 1 to none is logged naming the red count as cleared

  # BL-1429 thresholds-come-from-the-conf-04
  Scenario: the thresholds are read from swarmforge.conf
    Given the swarmforge.conf sets standing_red_max_count to 30 and standing_red_max_age_days to 14
    And the register would cross both default thresholds but neither raised one
    When the throttle recommendation is emitted
    Then no standing-red recommendation is made

  # BL-1429 the-effective-depth-folds-the-register-05
  Scenario: the effective depth CLI prints the throttled cap
    Given a configured active_backlog_max_depth of 6
    And the register is over the count threshold alone
    When effective_backlog_depth_cli.bb runs on the fixture root
    Then it prints 1
