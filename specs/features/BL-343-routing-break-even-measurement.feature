Feature: Parking roles is proven to save money, or proven not to

# BL-343: the dynamic-routing epic — auto-hibernate, routing manifest, quiet-period gate, per-role
# park/unpark — exists for one reason: to save money by not running roles a ticket does not need.
# Every slice has landed. Nobody has ever measured whether it works. And parking is not free: an
# unparked role comes back cold and re-reads its whole system prompt, so churn can cost more than
# idling. The set of roles held warm was chosen by judgement, not measurement. This slice makes
# the epic falsifiable — and a negative answer is a valid, valuable outcome.

Background:
  Given roles that can be parked when unneeded and unparked when needed

# BL-343 routing-break-even-01
Scenario: The cost of bringing a parked role back is measured from a real unpark
  Given a role that has been parked
  When it is unparked
  Then the cost of bringing it back is recorded from that unpark

# BL-343 routing-break-even-02
Scenario: The saving from parking an idle role is measured from real idle burn
  Given a role that is running but unused
  When its idle burn is measured
  Then the saving from parking it is recorded from that measurement

# BL-343 routing-break-even-03
Scenario: The break-even idle duration is stated as a number
  Given the cost of unparking a role and the saving from parking it are both known
  When the break-even is derived
  Then the idle duration at which parking begins to pay is stated as a number

# BL-343 routing-break-even-04
Scenario: Parking a role that is idle for less than the break-even is identified as a loss
  Given a role that would be idle for less than the break-even duration
  When parking that role is evaluated
  Then parking it is identified as costing more than it saves

# BL-343 routing-break-even-05
Scenario: The set of roles held warm follows the measurement, not a guess
  Given the break-even is known
  When the roles to hold warm are decided
  Then the decision follows from the measured break-even

# BL-343 routing-break-even-06
Scenario: A finding that routing does not save money is reported, not tuned away
  Given the measurement shows that parking costs more than it saves
  When the result is reported
  Then it is reported as a finding that routing does not save money

# BL-343 routing-break-even-07
Scenario: A cost that was estimated rather than observed is not accepted as a measurement
  Given a cost derived without a real park and unpark
  When the break-even is derived
  Then that cost is not used
