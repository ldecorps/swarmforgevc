Feature: Probe legacy topic adoption paths on disk without mutating maps or calling Telegram

  Background:
    Given a target repo with front-desk and cursor-bridge operator state fixtures

  # BL-1147 probe-legacy-01
  Scenario: The probe lists legacy per-ticket BL keys from the backlog topic map read-only
    Given backlog-topic-map.json contains legacy per-ticket keys BL-101 and BL-202
    When the legacy topic adoption probe runs
    Then the probe report lists BL-101 and BL-202 as legacy per-ticket topics
    And the probe does not modify backlog-topic-map.json

  # BL-1147 probe-legacy-02
  Scenario Outline: The probe classifies cursor Host topic routing from provider and bindings
    Given cursor-bridge state binds Host topic 8435
    And SWARMFORGE_LETS_TALK_PROVIDER is <provider>
    When the legacy topic adoption probe runs
    Then the probe report classifies cursor Host routing as <expectedRouting>
    And the probe report cursor Host topic id is 8435

    Examples:
      | provider | expectedRouting    |
      | cursor   | bridge             |
      | local    | operator-re-adopt  |
      |          | bridge             |
      | openai   | operator-re-adopt  |

  # BL-1147 probe-legacy-03
  Scenario: The probe flags stale front-desk bindings on the cursor topic as scrub candidates
    Given cursor-bridge state binds Host topic 9001
    And the front-desk topic map binds topic 9001 to SUP-12
    When the legacy topic adoption probe runs
    Then the probe report lists topic 9001 as a scrub candidate
    And the probe does not modify telegram-topic-map.json

  # BL-1147 probe-legacy-04
  Scenario: openSubjectAndRecord re-adopts the cursor Host topic into OPERATOR when provider is not cursor
    Given cursor-bridge state binds Host topic 7001
    And SWARMFORGE_LETS_TALK_PROVIDER is local
    And the front-desk topic map has no binding for topic 7001
    When openSubjectAndRecord handles a principal message on topic 7001
    Then the front-desk topic map binds topic 7001 to OPERATOR
    And no new SUP subject is opened

  # BL-1147 probe-legacy-05
  Scenario: openSubjectAndRecord refuses the cursor Host topic when cursor routing is enabled
    Given cursor-bridge state binds Host topic 7002
    And SWARMFORGE_LETS_TALK_PROVIDER is cursor
    When openSubjectAndRecord is invoked for topic 7002
    Then openSubjectAndRecord rejects with bridge-owned error
