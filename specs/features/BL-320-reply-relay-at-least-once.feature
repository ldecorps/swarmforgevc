Feature: Telegram reply egress is at-least-once with ack-driven cursor

# BL-320: Telegram reply egress is at-least-once with ack-driven cursor

Background:
  Given the reply path operator_reply.bb → telegram-reply-outbox.jsonl → bridgeServer SSE → front-desk bot → Telegram
  And the bridgeServer currently advances its cursor on emit-to-socket, not on acknowledgement

# BL-320 reply-relay-at-least-once-01
Scenario: Dropped SSE socket triggers reconnect and replay of unacked entries
  Given the SSE connection drops mid-relay
  When the connection is re-established
  Then all unacknowledged outbox entries should be redelivered

# BL-320 reply-relay-at-least-once-02
Scenario: Persisted cursor survives bridge restart
  Given the bridge has unacked entries in the outbox
  When the bridge restarts
  Then it resumes from the last genuinely acknowledged cursor position
  And unacked entries are redelivered exactly once

# BL-320 reply-relay-at-least-once-03
Scenario: Idempotency key prevents double-post on redelivery
  Given an outbox entry has been delivered but not yet acked
  When it is redelivered after a reconnect
  Then Telegram should receive it exactly once (no duplicate)

# BL-320 reply-relay-at-least-once-04
Scenario: Ack-driven cursor advancement
  Given the bot receives a reply from the bridge
  When the bot successfully posts to Telegram
  Then the bot sends an acknowledgement to the bridge
  And the bridge advances its delivered cursor

# BL-320 reply-relay-at-least-once-05
Scenario: Terminated socket triggers replay, not silent success
  Given the SSE connection terminates during relay
  When the daemon detects the terminated state
  Then it should trigger reconnect and replay
  And should not count the entries as delivered
