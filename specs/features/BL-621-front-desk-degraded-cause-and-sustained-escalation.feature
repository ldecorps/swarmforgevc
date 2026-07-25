Feature: Front-desk degradation names its cause and sustained outages escalate

  # BL-621, from the 2026-07-24 rival-poller incident: 9 hours of
  # "poll degraded - 5 consecutive failures, still retrying" with NO cause,
  # because pollAndForward (telegramFrontDeskBotCore.ts:2130-2133) discards
  # the formatted transport error that getUpdates already returns - a single
  # 409 Conflict line would have named the rival poller immediately. The
  # reply-relay path already interpolates its error; the poll path is the
  # asymmetric one. Epic swarm-reliability.
  #
  # Second half: NOTHING escalates a sustained outage. The poll heartbeat
  # deliberately stamps on failed cycles too (BL-370), so a permanently
  # failing loop reads healthy; the reply-relay retries forever at a 60s cap
  # with one stderr line per streak and has no escalate arm at all (BL-320
  # stated "retry forever, capped backoff, escalate - never silently" but
  # shipped no escalation; BL-302 excluded the SSE loop explicitly). A
  # sustained-degraded episode (configurable threshold, default 30 minutes
  # of continuous failure) now escalates ONCE per episode via the existing
  # stuck-delivery direct-send channel - which still works during a
  # getUpdates 409, because sending does not poll.

  Background:
    Given a front-desk bot with a controllable clock

  # BL-621 degraded-warning-names-cause-01
  Scenario: the poll degraded warning names the underlying transport error
    Given getUpdates fails every cycle with a 409 Conflict error
    When the degraded threshold is crossed
    Then a degraded warning is written naming the 409 Conflict error text

  # BL-621 warning-cadence-unchanged-02
  Scenario: the degraded warning still fires once per failure streak
    Given getUpdates fails every cycle
    When failures continue well past the degraded threshold
    Then exactly one degraded warning is written for the streak

  # BL-621 sustained-poll-outage-escalates-once-03
  Scenario: sustained poll degradation escalates to the human once per episode
    Given getUpdates has failed continuously for longer than the sustained-degraded threshold
    When the next poll cycle completes
    Then one escalation naming the outage duration and the last error is sent via the direct escalation channel
    And no further escalation is sent while the same episode continues

  # BL-621 recovery-closes-episode-04
  Scenario: recovery closes the episode and a later outage escalates again
    Given a sustained poll outage escalated and polling then recovered
    When getUpdates later fails continuously past the sustained-degraded threshold again
    Then a new escalation is sent for the new episode

  # BL-621 relay-sustained-reconnect-escalates-05
  Scenario: sustained reply-relay reconnect failure escalates instead of retrying silently forever
    Given the reply-relay reconnect has failed continuously for longer than the sustained-degraded threshold
    When the next relay cycle completes
    Then one escalation naming the relay outage duration and the last error is sent via the direct escalation channel
    And the relay keeps retrying with capped backoff

  # BL-621 heartbeat-semantics-unchanged-06
  Scenario: failed poll cycles still stamp the poll heartbeat
    Given getUpdates fails every cycle
    When the next poll cycle completes
    Then the poll heartbeat is stamped fresh

  # BL-621 escalation-failure-tolerated-07
  Scenario: a failed escalation send never crashes the loops
    Given the direct escalation channel itself fails
    When a sustained outage triggers an escalation
    Then the poll loop continues on its backoff cadence
    And the escalation failure is logged
