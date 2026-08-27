Feature: the headless daemon emails each committed daily briefing

# BL-214 brief-01
Scenario: a newly committed briefing is emailed without the VS Code host
  Given the daemon is running with no VS Code host open
  And a new docs/briefings/<date>.md has just been committed
  When the daemon's briefing watch runs
  Then it sends that briefing once via send-alarm-email!
  And the send uses the daemon's configured to/from and RESEND_API_KEY

# BL-214 brief-02
Scenario: a briefing is emailed exactly once across restarts
  Given a briefing that was already emailed and marked sent
  When the daemon restarts and the briefing watch runs again
  Then no second email is sent for that briefing

# BL-214 brief-03
Scenario: unconfigured email degrades to a graceful skip
  Given notify_email_to or RESEND_API_KEY is absent
  When the daemon's briefing watch finds a new briefing
  Then it logs the skip and sends nothing
  And the daemon does not crash

# BL-214 brief-04
Scenario: the host no longer double-sends the briefing
  Given the daemon owns briefing email delivery
  When the VS Code host is also open
  Then the host does not also email the briefing

# Non-behavioral gates:
#  - Reuse daemon_alarm_lib.bb's send-alarm-email! and its injectable POST seam;
#    no second Resend client. Tests inject a fake POST — no real network.
#  - No real timers in tests. Exactly-once uses a durable per-date sent marker.
#  - Delivery only; briefing composition/content is unchanged (BL-099 / BL-213).
