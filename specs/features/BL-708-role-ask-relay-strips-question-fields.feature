# mutation-stamp: sha256=03a3e38027aaaf4646934d1d87d797c50f2d6171786c5969ed7ce7f37695ff77
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-04T15:13:51.887105Z","feature_name":"A role's clarifying question reaches its own Telegram topic","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-708-role-ask-relay-strips-question-fields.feature","background_hash":"83e34e1e20af59be6e7eb31e7db3c7d8f30399308832c583573608d4ecac8b7f","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a question record keeps the fields that decide its delivery","scenario_hash":"9b6a93d3b08b176566884bd1edfc933e76a87a4c6e74579bf99dbe86bc43c53d","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-08-04T15:13:42.945986Z"}]}
# acceptance-mutation-manifest-end

Feature: A role's clarifying question reaches its own Telegram topic
  role_ask writes a question into the reply outbox marked with the asking
  role and its options. The bridge relay must carry those fields to the front
  desk so the question is delivered as a question, into that role's own topic
  and not as an ordinary reply to a thread that resolves nowhere.
  Source: human via Cursor 2026-07-30; BL-708 (defect on BL-607).

  Background:
    Given the front desk is relaying reply-outbox records from the bridge
    And the specifier role is mapped to its own Telegram topic

  # BL-708 role-ask-relay-01
  Scenario Outline: a question record keeps the fields that decide its delivery
    When a question record marked <question_field> with options <options> is written to the reply outbox
    Then the front desk receives that record with <question_field> and its options intact
    And the question is posted into <destination>

    Examples:
      | question_field | options | destination                      |
      | roleQuestion   | present | the asking role's own topic      |
      | roleQuestion   | absent  | the asking role's own topic      |
      | agentQuestion  | present | the shared agent questions topic |

  # BL-708 role-ask-relay-02
  Scenario: options become tappable buttons
    When a question record marked roleQuestion with options present is written to the reply outbox
    Then the message posted into the asking role's own topic offers every option as a tappable button

  # BL-708 role-ask-relay-03
  Scenario: a role question is never delivered as an ordinary reply
    When a question record marked roleQuestion with options absent is written to the reply outbox
    Then the front desk does not deliver it through the ordinary reply path
    And no delivery is attempted against the synthetic role-ask thread id

  # BL-708 role-ask-relay-04
  Scenario: an undeliverable question is surfaced before it is acked
    Given the asking role has no Telegram topic mapped
    When a question record marked roleQuestion with options present is written to the reply outbox
    Then the undeliverable question leaves a surfaced trace naming that role
    And the record is not reported as delivered

  # BL-708 role-ask-relay-05
  Scenario: an ordinary reply still relays unchanged
    When a reply record carrying no question field is written to the reply outbox
    Then the front desk delivers it through the ordinary reply path as before
