Feature: A topic's icon tells the truth about its ticket's state

# BL-342: Telegram never hides a closed topic — closing locks it, and it stays in the list
# forever. So the list grows without bound and the icon is the only per-topic signal that
# separates history from live work at a glance. The Operator applied a convention by hand across
# 28 topics; nothing in the swarm knows icons exist, so the moment a ticket ships its icon starts
# lying. A signal that silently goes stale is worse than no signal: it invites trust it has not
# earned. Two things must not break: an icon the human set himself, and a rate-limited backfill
# that silently drops its tail (the hand pass already dropped 7 of 26 that way).

Background:
  Given tickets whose topics are listed together and never hidden

# BL-342 topic-icons-track-ticket-state-01
Scenario: A new topic is created with an icon reflecting its ticket's state
  Given a ticket with no topic yet
  When its topic is created
  Then the topic has an icon reflecting the ticket's state

# BL-342 topic-icons-track-ticket-state-02
Scenario Outline: A ticket's state change updates its topic's icon
  Given a ticket whose topic has an icon set by the swarm
  When the ticket becomes <new_state>
  Then the topic's icon is updated to reflect that state

  Examples:
    | new_state |
    | done      |
    | in flight |
    | paused    |

# BL-342 topic-icons-track-ticket-state-03
Scenario: A done ticket's icon is updated even though its topic is closed
  Given a ticket whose topic has been closed
  When the ticket becomes done
  Then the topic's icon is updated to reflect that state

# BL-342 topic-icons-track-ticket-state-04
Scenario: An icon a human set is never overwritten by the swarm
  Given a topic whose icon was set by a human
  When the ticket's state changes
  Then the topic's icon is left as the human set it

# BL-342 topic-icons-track-ticket-state-05
Scenario: An icon of unknown origin is left alone rather than overwritten
  Given a topic whose icon the swarm did not set
  When the ticket's state changes
  Then the topic's icon is left alone

# BL-342 topic-icons-track-ticket-state-06
Scenario: Icon ids are validated against the set Telegram allows
  Given an icon that Telegram does not allow
  When a topic's icon is set
  Then the icon is rejected before the topic is changed

# BL-342 topic-icons-track-ticket-state-07
Scenario: A bulk backfill that is rate-limited still completes every topic
  Given many topics whose icons must be backfilled
  And the rate limit is reached partway through
  When the backfill runs
  Then it waits as instructed and continues
  And every topic ends with the icon its state calls for
