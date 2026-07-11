# mutation-stamp: sha256=140e62f5fd752848ee361629073e4573f2f77d1967102c2b1a37ee631ec29539
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-11T16:11:11.056347049Z","feature_name":"Swarm emits a typed, Telegram-agnostic event stream tagged by BL-###","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-296-swarm-typed-event-stream.feature","background_hash":"4aebbb4375b10e1fb2f24088771457ec5825f8df23c32a6c41d725d0ec2f3809","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a swarm signal for a backlog item emits its typed event","scenario_hash":"f5c6945aa4b52a8a57f14f27e78b84c81aa281391650b7926647dc2866ae12ce","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-07-11T16:11:11.056347049Z"}]}
# acceptance-mutation-manifest-end

Feature: Swarm emits a typed, Telegram-agnostic event stream tagged by BL-###

  Background:
    Given the swarm's activity is turned into typed events without any knowledge of Telegram

  # BL-296 typed-events-01
  Scenario Outline: a swarm signal for a backlog item emits its typed event
    Given a backlog item <trigger>
    When the event stream is derived
    Then it includes a <eventType> event tagged with that backlog item

    Examples:
      | trigger | eventType |
      | that has just started being worked | TaskStarted |
      | whose work has captured a to-human gate | NeedsApproval |
      | that has just completed | TaskCompleted |

  # BL-296 typed-events-02
  Scenario: no emitted event carries any Telegram or topic reference
    Given an emitted event
    When it is inspected
    Then it names its type and its backlog item but nothing about Telegram or topics

  # BL-296 typed-events-03
  Scenario: an already-emitted event is not emitted twice
    Given an event already emitted for a backlog item
    When the stream is derived again with no new change
    Then that event is not emitted again
