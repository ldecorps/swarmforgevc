Feature: A starved front desk is loud, not silent

# BL-333: an interactive Operator holds the single-Operator slot indefinitely (it is instructed
# never to exit), so no disposable Operator is ever spawned to read the front desk. Every inbound
# message queues, unread, for days. Nothing errors; status says "operator_running", which reads
# like health and actually means "the front desk is blocked". This ticket does not fix the
# starvation (BL-334 does) — it makes it VISIBLE, which is what turns an indefinite silent
# failure into one somebody can act on.

Background:
  Given an Operator holds the slot that the front desk's reader would need

# BL-333 front-desk-starvation-alarm-01
Scenario: A live Operator that is consuming nothing is reported as exactly that
  Given the front desk's inbound queue is not being consumed
  When the front desk's health is reported
  Then an Operator is reported as running
  And the queue is reported as not being consumed
  And those are reported as two distinct facts

# BL-333 front-desk-starvation-alarm-02
Scenario: A queue backing up behind a held slot raises a loud alarm
  Given more inbound messages are waiting than the configured limit allows
  When the front desk's health is reported
  Then a starvation alarm is raised

# BL-333 front-desk-starvation-alarm-03
Scenario: An event left unread for too long raises the alarm even if the queue is short
  Given a single inbound message has been waiting longer than the configured limit
  And fewer messages are waiting than the count limit allows
  When the front desk's health is reported
  Then a starvation alarm is raised

# BL-333 front-desk-starvation-alarm-04
Scenario: The alarm goes to a channel that is not the blocked one
  Given more inbound messages are waiting than the configured limit allows
  When a starvation alarm is raised
  Then the alarm is delivered on the operator alarm channel
  And the alarm is not delivered through the front desk

# BL-333 front-desk-starvation-alarm-05  (AMENDED by BL-345: "raised" -> "delivered")
Scenario: A starvation lasting days raises one alarm, not one per tick
  Given more inbound messages are waiting than the configured limit allows
  And a starvation alarm has already been delivered for that starvation
  When the front desk's health is reported again
  Then no further alarm is delivered

# BL-333 front-desk-starvation-alarm-06  (AMENDED by BL-345: "raised" -> "delivered")
Scenario: A starvation that clears and returns is alarmed again
  Given a starvation alarm has already been delivered for that starvation
  And the waiting messages have since been consumed
  When more inbound messages are waiting than the configured limit allows
  Then a starvation alarm is raised

# BL-333 front-desk-starvation-alarm-07
Scenario: A healthy front desk raises no alarm
  Given the front desk's inbound queue is being consumed
  When the front desk's health is reported
  Then no starvation alarm is raised

# BL-333 front-desk-starvation-alarm-08
Scenario: The human's conversation is never hung up on to clear the alarm
  Given more inbound messages are waiting than the configured limit allows
  When a starvation alarm is raised
  Then the Operator holding the slot is still running

# BL-345 front-desk-starvation-alarm-09
Scenario: An alarm that failed to deliver is retried, not treated as sent
  Given more inbound messages are waiting than the configured limit allows
  And the previous alarm attempt failed to deliver
  When the front desk's health is reported
  Then a starvation alarm is raised

# BL-345 front-desk-starvation-alarm-10
Scenario: Alarm delivery is not retried forever
  Given more inbound messages are waiting than the configured limit allows
  And the delivery attempt limit has been reached
  When the front desk's health is reported
  Then no further alarm is delivered
  And the undelivered alarm is recorded loudly in the log

# BL-345 front-desk-starvation-alarm-11
Scenario Outline: A misconfigured alarm channel is warned about, not retried
  Given more inbound messages are waiting than the configured limit allows
  And the alarm channel is <misconfiguration>
  When the front desk's health is reported
  Then no further alarm is delivered
  And the misconfiguration is warned about exactly once

  Examples:
    | misconfiguration    |
    | missing a recipient |
    | missing its api key |
