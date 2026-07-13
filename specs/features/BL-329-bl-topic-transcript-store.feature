Feature: Every message in a BL ticket's topic is persisted durably as it happens

# BL-329: slice 1 of archive-then-delete. BL topics have NO transcript store (SUP threads do:
# support_thread_store.bb). Inbound human messages land only in .swarmforge/operator/events.jsonl
# — a GITIGNORED firehose of every operator event, with no per-topic view — and the swarm's own
# outbound messages are recorded nowhere at all. BL-298/BL-325 made BL topics two-way, so the
# human's words are now the irreplaceable content, and nothing keeps them. Nothing may be
# archived, let alone deleted, until this exists.

Background:
  Given a backlog ticket that has its own Telegram topic

# BL-329 bl-topic-transcript-01
Scenario Outline: Every message in the topic is recorded, in both directions
  Given a <direction> message is sent in that ticket's topic
  When the message is handled
  Then it is recorded in that ticket's durable transcript
  And the record carries who sent it and when

  Examples:
    | direction |
    | inbound   |
    | outbound  |

# BL-329 bl-topic-transcript-02
Scenario: The transcript is retrievable per ticket, not as a firehose
  Given several tickets each have messages in their own topics
  When one ticket's transcript is read
  Then it contains that ticket's messages only

# BL-329 bl-topic-transcript-03
Scenario: The transcript survives a restart of the process that wrote it
  Given messages have been recorded in a ticket's transcript
  When the process that recorded them is restarted
  Then the transcript still contains every recorded message

# BL-329 bl-topic-transcript-04
Scenario: Existing human messages already captured are backfilled, not lost
  Given human messages for a ticket exist in the operator event log from before this feature
  When the transcript store is backfilled
  Then those messages appear in that ticket's transcript
