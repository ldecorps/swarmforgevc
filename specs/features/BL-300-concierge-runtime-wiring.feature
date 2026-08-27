# mutation-stamp: sha256=24b671115e615addc11a5d990890aed4862736aff0c2304746e4d7db6e8ff3f3
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-11T17:44:32.345126759Z","feature_name":"The Concierge runtime derives task events from the live backlog and routes each into its BL-### topic, persisting the topic map","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-300-concierge-runtime-wiring.feature","background_hash":"79cb67864c77bf6cfc21c4865859e5ad55d77e7e1bf1170b291376a2b7bf853e","implementation_hash":"unknown","scenarios":[{"index":0,"name":"routing a backlog item that has newly <lifecycle>","scenario_hash":"9d78b7d61b0c10054449167d71c51d8a57ad89d394d2ccf2573f4763b5a9d189","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-07-11T17:44:32.345126759Z"}]}
# acceptance-mutation-manifest-end

Feature: The Concierge runtime derives task events from the live backlog and routes each into its BL-### topic, persisting the topic map

  Background:
    Given the Concierge runtime is ticking over the swarm's live backlog state

  # BL-300 concierge-wiring-01
  Scenario Outline: routing a backlog item that has newly <lifecycle>
    Given a backlog item that has newly <lifecycle>
    When the runtime tick derives and routes events
    Then it <outcome>

    Examples:
      | lifecycle | outcome |
      | started being worked | creates the item's topic, posts its opening message, and persists the backlog-id-to-topic-id mapping for later reads |
      | completed | posts a completion summary into the item's topic and closes it |

  # BL-300 concierge-wiring-02
  Scenario: an event handled before a restart is not routed again after it
    Given an event already routed before the runtime restarted
    When the tick runs once more following the restart
    Then that event is not routed a second time
