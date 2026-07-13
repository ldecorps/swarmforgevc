Feature: A BL topic's content is serialised into the repo, so the topic is a projection and not the source of truth

# BL-329: slice 1 of "serialise a topic so it can be recreated from scratch". Today a BL topic's
# content exists ONLY inside Telegram — there is no store (SUP threads have
# support_thread_store.bb; BL topics have none). Inbound human messages land only in
# .swarmforge/operator/events.jsonl, a GITIGNORED firehose with no per-topic view, and the swarm's
# OUTBOUND messages are kept nowhere at all. BL-298/BL-325 made topics two-way, so the human's
# words are now the irreplaceable half (the swarm's are regenerable from the ticket and git).
# Once the record lives in the repo, the topic becomes disposable and deletion becomes reversible.

Background:
  Given a backlog ticket that has its own Telegram topic

# BL-329 serialise-topic-01
Scenario Outline: Every message is serialised as it happens, in both directions
  Given a <direction> message is sent in that ticket's topic
  When the message is handled
  Then it is serialised into that ticket's durable record
  And the record entry carries its order, its timestamp, its author and its text

  Examples:
    | direction |
    | inbound   |
    | outbound  |

# BL-329 serialise-topic-02
Scenario: The record lives in the repository, with the work
  Given messages have been serialised for a ticket
  When that ticket's record is read
  Then it is found in the repository, keyed by that ticket
  And it contains that ticket's messages only

# BL-329 serialise-topic-03
Scenario: The record preserves the order messages were sent in
  Given several messages were sent in a ticket's topic in a known order
  When that ticket's record is read
  Then the messages appear in the order they were sent

# BL-329 serialise-topic-04
Scenario: The record survives a restart of the process that wrote it
  Given messages have been serialised for a ticket
  When the process that serialised them is restarted
  Then the record still contains every serialised message

# BL-329 serialise-topic-05
Scenario: Human messages already captured are backfilled, not abandoned
  Given human messages for a ticket exist in the operator event log from before this feature
  When the record is backfilled
  Then those messages appear in that ticket's record
