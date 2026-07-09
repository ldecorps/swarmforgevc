Feature: a configured-but-keyless daemon warns loudly instead of no-oping silently

# BL-215 warn-01
Scenario: recipient set but key missing warns loudly
  Given notify_email_to is configured
  And RESEND_API_KEY is absent from the daemon's environment
  When the daemon tries to send an alarm or briefing email
  Then the send returns a distinct "missing key" result
  And the daemon logs a visible warning naming RESEND_API_KEY
  And no email is sent

# BL-215 warn-02
Scenario: no recipient stays a quiet no-op
  Given notify_email_to is not configured
  When the daemon tries to send an alarm or briefing email
  Then no email is sent
  And no missing-key warning is logged

# BL-215 warn-03
Scenario: fully configured sends normally
  Given notify_email_to and RESEND_API_KEY are both set
  When the daemon sends an alarm or briefing email
  Then the email is posted
  And no missing-key warning is logged

# BL-215 warn-04
Scenario: the missing-key warning is not spammed
  Given notify_email_to is configured and RESEND_API_KEY is absent
  When the daemon's send path runs many times
  Then the missing-key warning is logged at most once per dedup window

# Non-behavioral gates:
#  - Fix lives in the shared send layer (daemon_alarm_lib.bb) + its daemon
#    caller, so BL-144 alarm and BL-214 briefing both benefit; no forked path.
#  - Post and log side effects are injected fakes — no real network, no real
#    timers. Dedup uses an injected clock/state, not wall-clock sleeps.
#  - The key value is never logged. Recipient-unset no-op is unchanged.
