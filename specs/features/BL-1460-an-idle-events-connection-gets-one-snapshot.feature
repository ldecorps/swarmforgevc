Feature: BL-1460 An idle /events connection receives one snapshot, at connect, however many poll ticks elapse

  The bridge's /events stream sends a snapshot at connect and, on every
  poll tick, broadcasts a fresh snapshot only when it differs from the last
  one broadcast. The connect path computes that first snapshot fresh when
  nothing has been broadcast yet, but never records it as the last one, so
  the first poll tick after a fresh start compares a new snapshot against
  nothing and broadcasts an identical copy to every connected client.
  bridgeServer.test.js's keepalive scenario asserts the idle case and fails
  whenever that first poll tick lands before the first keepalive tick: three
  of six QA runs and one of six specifier runs on 2026-09-07, holding
  BL-1454 at QA under Article 4.2. Consumers replace state on every frame,
  so nothing is corrupted; the invariant BL-1351 named - one producer, one
  frame per real change - is what breaks.

  Background:
    Given a fixture target with a bridge started fresh on short poll and keepalive intervals

  # BL-1460 an-idle-client-gets-exactly-one-snapshot-01
  Scenario: an idle client receives exactly one snapshot frame across several poll ticks
    Given one client connected to /events and no change to the target
    When at least three poll ticks have elapsed
    Then the client has received exactly one data frame, the connect snapshot
    And it has received at least one keepalive comment frame

  # BL-1460 a-later-client-gets-the-same-cached-snapshot-02
  Scenario: a client connecting after the first poll tick receives the cached snapshot and no second copy
    Given one client already connected and at least one poll tick elapsed
    When a second client connects to /events and two more poll ticks elapse
    Then the second client's connect snapshot equals the first client's
    And neither client has received a second data frame

  # BL-1460 a-real-change-still-broadcasts-once-to-every-client-03
  Scenario: a real change still reaches every connected client exactly once
    Given two clients connected to /events and at least one poll tick elapsed
    When the target's state changes once and two poll ticks elapse
    Then each client has received exactly one further data frame carrying the change

  # BL-1460 the-register-row-leaves-with-the-fix-04
  Scenario: the register row leaves with the fix
    When the fix is on main
    Then backlog/standing-reds.tsv carries no row for extension/test/bridgeServer.test.js
