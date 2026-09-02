Feature: An idle bridge event stream stays alive
  The bridge's /events SSE endpoint writes a frame only when the bridge
  snapshot CHANGES or a reply-outbox entry appears, so a quiet swarm leaves
  the socket silent. undici's default 300 s bodyTimeout then kills the
  front-desk reply-relay's fetch with "terminated", which the relay counts
  as a reconnect FAILURE rather than a clean close - the measured cause of
  43 "reply-relay degraded" warnings since 2026-08-27 and of a false
  sustained-outage escalation. A periodic keepalive frame keeps every
  /events consumer connected through an idle period, and is inert to every
  consumer that reads the stream.

  Background:
    Given a bridge serving /events with a keepalive interval of 20000 ms
    And an authenticated client connected to /events

  # BL-1350 idle-event-stream-keepalive-01
  Scenario: An idle stream is written to even though nothing changed
    When no bridge state changes and 300000 ms elapse
    Then no gap between frames written to the client exceeds 20000 ms
    And the client has received no snapshot frame after the connect snapshot

  # BL-1350 idle-event-stream-keepalive-02
  Scenario: A disconnected client is never written to again
    When the client disconnects and 300000 ms elapse
    Then no keepalive frame is written to the disconnected client

  # BL-1350 idle-event-stream-keepalive-03
  Scenario Outline: The reply relay ignores a frame that carries no reply
    Given a reply relay reading the event stream
    When the stream delivers <frame>
    Then no reply is sent to Telegram
    And no reply is acknowledged

    Examples:
      | frame                   |
      | a keepalive frame       |
      | a bridge snapshot frame |
