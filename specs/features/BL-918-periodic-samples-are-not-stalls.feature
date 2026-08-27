# mutation-stamp: sha256=04ec708e71a5e9838591001c1b9dec16aeb90ba7f25c2937e6d60607f4a5a027
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-18T14:22:06.279255Z","feature_name":"Periodic sampling telemetry is not a stall","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-918-periodic-samples-are-not-stalls.feature","background_hash":"10d2c3bc928c3deaa69e5862ddb302dcdf450ba0edc03d8a65b20eaa4d554551","implementation_hash":"unknown","scenarios":[{"index":0,"name":"an attention signal is recorded as a stall","scenario_hash":"23930d42adeec0928fda70036e605dfb58b1d5c767a036dcafce83571c107a97","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-18T14:22:06.279255Z"},{"index":1,"name":"a periodic measurement is not recorded as a stall","scenario_hash":"55c1ca0166c8898fe4c0afc4536b92676dd41ed2c1b74582e57912f2b45c348f","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-18T14:22:06.279255Z"}]}
# acceptance-mutation-manifest-end

Feature: Periodic sampling telemetry is not a stall

  # BL-918 (lean-aware-coordinator). handoffd writes several kinds of row into
  # one chaser-*.jsonl family: attention signals that mean something had to
  # intervene (chase, nudge, dead-letter, respawn), and periodic measurements
  # that fire on a timer whether or not anything is wrong (resource_sample,
  # host_load_sample). composeStallEvents ingests the whole file as `stall`,
  # so the timer rows outnumber and outrank the real ones in the closing
  # ceremony packet. This feature pins the classification boundary.
  #
  # Step handlers: specs/pipeline/steps/bl918PeriodicSamplesAreNotStallsSteps.js,
  # driving leanLedgerComposeStall.ts and closingCeremony.ts against fixture
  # telemetry.

  Background:
    Given a shift whose chaser telemetry holds both attention signals and periodic samples

  # BL-918 attention-signal-is-a-stall-01
  Scenario Outline: an attention signal is recorded as a stall
    Given a "<eventType>" telemetry row inside one ticket's window for a role
    When the ticket's lifecycle is composed
    Then the ledger holds a stall entry of that event type for that ticket

    Examples:
      | eventType   |
      | chase       |
      | nudge       |
      | dead-letter |
      | respawn     |

  # BL-918 periodic-sample-is-not-a-stall-02
  Scenario Outline: a periodic measurement is not recorded as a stall
    Given a "<eventType>" telemetry row inside one ticket's window for a role
    When the ticket's lifecycle is composed
    Then the ledger holds no stall entry for that row

    Examples:
      | eventType         |
      | resource_sample   |
      | host_load_sample  |

  # BL-918 unrecognised-type-is-not-a-stall-03
  Scenario: a telemetry type nobody has classified yet is not a stall
    Given a telemetry row whose type is recognised as neither an attention signal nor a known sample
    When the ticket's lifecycle is composed
    Then the ledger holds no stall entry for that row
    And the unrecognised type is reported rather than silently dropped

  # BL-918 hypothesis-ranks-real-stalls-04
  Scenario: the ceremony hypothesis ranks real stalls, not sample volume
    Given a shift where one role has more periodic samples than any role has attention signals
    When the coordinator builds the closing packet
    Then the packet's stall summary counts only attention signals
    And the stall-derived hypothesis names the role with the most attention signals

  # BL-918 excluded-at-classification-05
  Scenario: every reader sees one classification, applied once
    Given a consumer that reads the ledger's stall events
    When it reports on a shift containing periodic samples
    Then it sees no periodic-sample stall entries without filtering them itself
