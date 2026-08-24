Feature: BL-1111 reply-relay must not sit on terminated for a sustained outage window
  On 2026-08-23 the front-desk supervisor reported the reply-relay loop
  failing continuously for 31 minutes with last error "terminated", retrying
  on a capped backoff — co-occurring with the handoffd stale-heartbeat flap
  but not proven the same root cause. BL-621 already shipped the sustained
  escalation alert; this ticket is the recurrence / new cause that left the
  relay dark for half an hour after the alert fired correctly.

  Background:
    Given the Telegram front-desk bot owns the reply-relay loop

  # BL-1111 reply-relay-01
  Scenario: a terminated relay reconnect recovers inside the sustained-alert window
    Given the reply-relay connection is terminated
    When the reconnect path runs under a healthy network
    Then the relay is delivering again before the sustained-outage alert threshold

  # BL-1111 reply-relay-02
  Scenario: sustained terminated failures still escalate exactly once
    Given the reply-relay has been failing continuously past the sustained threshold
    When the supervisor evaluates the outage
    Then exactly one sustained-outage alert is raised for that outage window
    And the alert names the last error

  # BL-1111 reply-relay-03
  Scenario: intermittent fetch failed does not masquerade as a clean relay
    Given the last relay error is fetch failed
    When the supervisor reports relay health
    Then the relay is not reported healthy
