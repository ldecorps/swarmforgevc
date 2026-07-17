# mutation-stamp: sha256=e78cbbf75d73eba469eb1c49209d9303df574ea1123162beb4e83b9746c81468
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-17T09:36:40.134415822Z","feature_name":"Operator reacts out-of-cycle to a fresh inbound Telegram message","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-481-operator-out-of-cycle-wake.feature","background_hash":"7e7705841ec064d1ab7f5cd457417b92c4bb8d27e5d10ce2cb04ff7d7f0259de","implementation_hash":"unknown","scenarios":[{"index":2,"name":"the fast path still honours the existing launch guards","scenario_hash":"8d60e3d2fb46e7e48354ebb69c0ef7a8e78e7b3de9bb2e0395d2afd02649a699","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-17T09:36:40.134415822Z"}]}
# acceptance-mutation-manifest-end

Feature: Operator reacts out-of-cycle to a fresh inbound Telegram message
  The Operator runtime's tick loop currently sleeps a full OPERATOR_INTERVAL_MS
  (30s) between ticks unconditionally, so a Telegram message that arrives just
  after a tick sits unread for up to that whole interval before the Operator is
  even launched to answer it — a fixed polling tax on top of the inherent LLM
  reasoning time, which makes the chat feel batchy. This behaviour reduces that
  polling delay: when the runtime is idle and listening, it waits only a short,
  bounded poll interval between event checks, so a freshly-arrived inbound
  message is picked up and dispatched within a few seconds instead of up to a
  full OPERATOR_INTERVAL_MS. It targets the runtime's own event-detection delay
  only; it does not change how long the Operator LLM takes to compose a reply.
  The expensive periodic work (the full health sweep) stays on its own cadence,
  so the shorter idle poll never multiplies health-sweep cost, and the existing
  launch guards (one Operator at a time, provider cooldown) still hold.

  Background:
    Given the Operator runtime tick loop is running
    And no full Operator invocation is in progress
    And the provider is not in cooldown

  # BL-481 operator-out-of-cycle-wake-01
  Scenario: idle-and-listening shortens the inter-tick wait to the poll interval
    Given the runtime has just finished a tick that launched nothing
    When the runtime decides how long to wait before the next tick
    Then the decided wait is the short out-of-cycle poll interval
    And it is not the full OPERATOR_INTERVAL_MS

  # BL-481 operator-out-of-cycle-wake-02
  Scenario: a message arriving between ticks is dispatched within the poll window
    Given a fresh inbound Telegram message addressed to the Operator arrives after a tick completes
    When the next out-of-cycle poll runs
    Then the runtime launches the Operator to handle that message
    And it does so within the short poll window

  # BL-481 operator-out-of-cycle-wake-03
  Scenario Outline: the fast path still honours the existing launch guards
    Given a fresh inbound Telegram message is pending
    And the runtime is in the "<guard>" state
    When the next out-of-cycle poll runs
    Then no additional Operator invocation is launched for that message on this poll

    Examples:
      | guard                    |
      | full-operator-running    |
      | front-desk-operator-running |
      | provider-cooldown        |

  # BL-481 operator-out-of-cycle-wake-04
  Scenario: the periodic full health sweep still fires only on its own cadence
    Given several short out-of-cycle poll wakes occur within one swarm-check cadence
    When the runtime processes each of those wakes
    Then the full health sweep fires at most once across them
    And it fires only when its swarm-check cadence is due

  # BL-481 operator-out-of-cycle-wake-05
  Scenario: the poll interval is a bounded configured value, never a busy-spin
    Given the runtime is idle and listening for inbound messages
    When it schedules successive out-of-cycle polls
    Then each wait is the bounded, env-overridable poll interval
    And no wait is a zero-delay spin
