# mutation-stamp: sha256=dd069a4723a2747221ce741cda6a7589ff7b843c428fe85748db8378088d9382
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T10:51:42.283734768Z","feature_name":"Bubble talks in its own Telegram topic","feature_path":"/tmp/swarmforge-bl709-hardender-wt/specs/features/BL-709-bubble-its-own-telegram-topic.feature","background_hash":"27e8f813fc75c6733812d2184d179acf931505b30fab3d80cff79d4d19319753","implementation_hash":"unknown","scenarios":[{"index":5,"name":"the front-desk topic map claims neither host-agent topic","scenario_hash":"157d338c35a79a49c963cc615cdb31a08ccb2ee52018198a349d0a1da0a12cef","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-27T10:51:42.283734768Z"}]}
# acceptance-mutation-manifest-end

Feature: Bubble talks in its own Telegram topic
  Let's Talk turns belong in a Bubble topic; Cursor Remote stays operator
  control only. Both still drive the same host-agent session — this separates
  destinations, not sessions.
  Source: human via Cursor 2026-07-30; BL-709.

  Background:
    Given the cursor bridge is running against a Telegram forum
    And the operator is the principal user

  # BL-709 bubble-topic-01
  Scenario: startup binds a Bubble topic alongside Cursor Remote
    When the cursor bridge starts with no Bubble topic bound
    Then a Bubble topic is created in the forum
    And its topic id is persisted alongside the Cursor Remote topic id

  # BL-709 bubble-topic-02
  Scenario: an existing Bubble topic is reused, not duplicated
    Given a Bubble topic id is already persisted
    When the cursor bridge starts
    Then no new Bubble topic is created
    And the persisted Bubble topic id is used

  # BL-709 bubble-topic-03
  Scenario: a Let's Talk turn is mirrored into Bubble
    Given a Bubble topic is bound
    When a Let's Talk turn completes
    Then both sides of the turn are posted into the Bubble topic
    And nothing is posted into the Cursor Remote topic

  # BL-709 bubble-topic-04
  Scenario: a follow-up typed in Bubble is answered in Bubble
    Given a Bubble topic is bound
    When the operator types a follow-up in the Bubble topic
    Then the bridge accepts it as inbound host-agent input
    And the response is posted into the Bubble topic

  # BL-709 bubble-topic-05
  Scenario: an operator control verb is answered in Cursor Remote
    Given a Bubble topic is bound
    When the operator sends a control verb in the Cursor Remote topic
    Then its answer is posted into the Cursor Remote topic
    And nothing is posted into the Bubble topic

  # BL-709 bubble-topic-06
  Scenario Outline: the front-desk topic map claims neither host-agent topic
    Given a Bubble topic is bound
    When the topic map is exported to the front desk
    Then <topic> is absent from the exported map

    Examples:
      | topic         |
      | Bubble        |
      | Cursor Remote |

  # BL-709 bubble-topic-07
  Scenario: an unbound Bubble topic falls back to the previous behaviour
    Given no Bubble topic id can be resolved
    When a Let's Talk turn completes
    Then the turn is mirrored into the Cursor Remote topic as before
    And the poll loop keeps running
