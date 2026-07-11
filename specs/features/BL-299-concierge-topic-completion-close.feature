# mutation-stamp: sha256=3bedfe4bd5b2ba99380c5cb9ac1ab70f5db9367c62981ec2a91bd742b39415e4
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-11T17:13:58.005499505Z","feature_name":"Concierge posts a completion summary and closes a backlog item's topic when its task completes","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-299-concierge-topic-completion-close.feature","background_hash":"dacc7a707b6a4d0c02a931ed7dcfdde6603ee36034f9797beb72a4e53447f538","implementation_hash":"unknown","scenarios":[{"index":0,"name":"routing a <kind> event for an item that <topic-state>","scenario_hash":"6323f91b57bb1239a409a373e1f4d02582bb9c6d43ceb2a300497fb8239d4e44","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-07-11T17:13:58.005499505Z"}]}
# acceptance-mutation-manifest-end

Feature: Concierge posts a completion summary and closes a backlog item's topic when its task completes

  Background:
    Given the Concierge is routing a typed swarm event for a backlog item

  # BL-299 topic-complete-01
  Scenario Outline: routing a <kind> event for an item that <topic-state>
    Given a <kind> event for an item that <topic-state>
    When the Concierge routes the event
    Then it <outcome>

    Examples:
      | kind | topic-state | outcome |
      | completion | has a topic | posts a completion summary naming the item, then closes the topic |
      | progress | has a topic | posts the event and leaves the topic open |
      | completion | has no topic | posts nothing and closes no topic |
