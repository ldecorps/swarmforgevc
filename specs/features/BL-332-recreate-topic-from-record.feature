Feature: A topic can be recreated from scratch by replaying its serialised record

# BL-332: the slice that makes deletion REVERSIBLE, and the one that proves the whole design.
# The round-trip — serialise, delete, recreate, content matches — is the acceptance test, not an
# incidental property. Honest limit: Telegram will not let a bot repost history as its original
# authors or at its original timestamps, so a recreated topic is a RENDERED RECONSTRUCTION, not a
# byte-identical restore. It must be designed and LABELLED as such, never quietly passed off as
# the original.

Background:
  Given a backlog ticket whose topic content has been serialised into the repository

# BL-332 recreate-topic-01
Scenario: The round trip holds — serialise, delete, recreate, content matches
  Given that ticket's topic has been deleted
  When the topic is recreated from its record alone
  Then a new topic exists for that ticket
  And its content matches the serialised record

# BL-332 recreate-topic-02
Scenario: The recreated topic is labelled as a reconstruction
  When the topic is recreated from its record alone
  Then the recreated topic is clearly labelled a reconstruction
  And it is not presented as the original conversation

# BL-332 recreate-topic-03
Scenario: Each replayed message preserves its original author and timestamp
  Given the record holds messages from both the swarm and the human
  When the topic is recreated from its record alone
  Then each replayed message shows the author who originally sent it
  And each replayed message shows the time it was originally sent

# BL-332 recreate-topic-04
Scenario: The recreated topic becomes the ticket's live topic
  When the topic is recreated from its record alone
  Then that ticket maps to the new topic
  And the swarm posts about that ticket in the new topic

# BL-332 recreate-topic-05
Scenario: Recreating reads the record without consuming it
  When the topic is recreated from its record alone
  Then the record in the repository is left intact
  And the topic can be recreated from it again
