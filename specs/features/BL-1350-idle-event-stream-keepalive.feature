# mutation-stamp: sha256=382223941aceb38e101b6196b9e6e97f2061bcc1b9b3c9d22dc002c40871db42
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T00:33:58.191108539Z","feature_name":"An idle bridge event stream stays alive","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1350-idle-event-stream-keepalive.feature","background_hash":"717ce43ef9feed13d91c6f9b31e55f906d4c247433ce5f7a650ac69eb4a63d1c","implementation_hash":"unknown","scenarios":[{"index":2,"name":"The reply relay ignores a frame that carries no reply","scenario_hash":"cc0ad4860b0a1453a88a7c11dc17e540cad644eb4f763c425f6da0baff118dd9","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-03T00:33:58.191108539Z"}]}
# acceptance-mutation-manifest-end

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
