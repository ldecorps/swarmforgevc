Feature: A role stuck past escalation reaches the human even when nobody has an editor open

# BL-349 (BL-336 finding H4): the stuck-escalation signal is written to a file and nothing else.
# The only code that EMAILS it lives in the VS Code extension host, so on a headless box - which
# is how this swarm actually runs - a role can sit stuck indefinitely and the human is never told.
# The daemon-death alarm and the starvation alarm both already email from the daemon via one
# shared sender; this signal is the odd one out. Reuse that sender, do not build a second one.

Background:
  Given a swarm running headless, with no editor attached

# BL-349 stuck-escalation-email-headless-01
Scenario: A newly escalated role emails the human
  Given a role that has been stuck past its escalation threshold
  When the escalation is detected
  Then the human is emailed about that role

# BL-349 stuck-escalation-email-headless-02
Scenario: The escalation is still recorded, as it was before
  Given a role that has been stuck past its escalation threshold
  When the escalation is detected
  Then the escalation is recorded

# BL-349 stuck-escalation-email-headless-03
Scenario: A role that stays stuck is not emailed about repeatedly
  Given a role that has already been escalated and emailed about
  When the role is still stuck on the next sweep
  Then the human is not emailed about it again

# BL-349 stuck-escalation-email-headless-04
Scenario: A role that recovers and gets stuck again is escalated again
  Given a role that was escalated, emailed about, and then recovered
  When that role becomes stuck past its escalation threshold again
  Then the human is emailed about it again

# BL-349 stuck-escalation-email-headless-05
Scenario: A send that fails is retried, not treated as delivered
  Given a role that has been stuck past its escalation threshold
  And the email send fails for a transient reason
  When the escalation is detected
  Then the escalation is not treated as notified
  And it is attempted again

# BL-349 stuck-escalation-email-headless-06
Scenario: An undeliverable escalation is surfaced rather than silently forgotten
  Given a role that has been stuck past its escalation threshold
  And the email can never be delivered
  When the escalation is detected
  Then the undelivered escalation is reported

# BL-349 stuck-escalation-email-headless-07
Scenario: No role stuck means no email
  Given no role is stuck past its escalation threshold
  When the sweep runs
  Then no escalation email is sent
