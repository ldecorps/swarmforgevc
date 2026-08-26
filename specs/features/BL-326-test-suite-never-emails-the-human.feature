Feature: The test suite never sends real email, even with real credentials in the environment

# BL-326: test_handoffd_supervisor.sh kills daemons to exercise BL-144's alarm-and-halt.
# Each killed daemon hits send-configured-email! (daemon_alarm_lib.bb:148), which reads
# RESEND_API_KEY from the process env and notify_email_to from the effective conf — both
# of which are REAL for every agent — and posts for real. 136 real emails reached the
# human. The guard must live in the send path, not in every test author's memory.

Background:
  Given a real RESEND_API_KEY is set in the environment
  And the effective conf configures a real notify_email_to address

# BL-326 test-suite-never-emails-01
Scenario: A full test run sends no email at all
  When the full test suite is run
  Then zero emails are sent

# BL-326 test-suite-never-emails-02
Scenario: A daemon rooted in a throwaway test directory never sends mail
  Given a daemon whose project root is a temporary test directory
  When that daemon dies and its alarm fires
  Then no email is sent
  And the alarm is still recorded in its failure log

# BL-326 test-suite-never-emails-03
Scenario: The alarm-and-halt behaviour is still fully exercised
  When the test suite runs the cases that kill daemons
  Then those daemons are still killed
  And the alarm and halt behaviour is still asserted
  And only the sending of mail is suppressed

# BL-326 test-suite-never-emails-04
Scenario: A configured-but-keyless daemon still warns loudly
  Given a daemon whose conf configures an address but whose key is absent
  When that daemon needs to raise its alarm
  Then it logs a loud warning naming the missing key
  And it does not send an email

# BL-326 test-suite-never-emails-05
Scenario: No daemon outlives the test run
  When the full test suite has finished
  Then no daemon started by the suite is still alive
  And no throwaway test directory is left holding a live daemon
