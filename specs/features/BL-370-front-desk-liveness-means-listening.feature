Feature: A front desk that has stopped listening is never reported healthy

# BL-370: through the ~9h inbound outage of 2026-07-13 (see BL-369), front-desk-supervisor.status.json
# reported status:running / attempts:1 the entire time. The health signal tracked PROCESS LIVENESS —
# "is there a pid" — while the thing that mattered, "is it still consuming inbound", had stopped.
# Recovery came only from a human restarting the bot and bridge by hand at 02:40. Nothing self-healed,
# because nothing knew anything was wrong.
#
# BL-345's starvation alarm cannot cover this: it fires on events PENDING and not draining, and in
# this failure no event ever arrives to be pending. A dead consumer and an idle one look identical to
# it. So the signal has to come from the front desk's own PROGRESS, not from its queue depth.
#
# WHAT MAKES THIS DETECTABLE WITHOUT TRAFFIC (the load-bearing design point): the front desk long-polls
# the chat service with a bounded timeout, so a HEALTHY front desk completes a poll cycle at least once
# per timeout even when nobody has written to it. "No completed poll within the stall window" therefore
# means genuinely stuck — never merely quiet. A quiet night must never be mistaken for a dead consumer,
# and that false positive is what scenario 02 exists to nail down.
#
# The restart is BOUNDED and giving up is LOUD (engineering: bounded-retry), and the escalation is only
# silenced once it has actually REACHED the human (constitution: a flag that suppresses a repeat
# notification is set on CONFIRMED DELIVERY, never on an attempt — the alarm for a silent failure must
# not itself fail silently).

Background:
  Given the front desk's process is alive

# BL-370 front-desk-liveness-means-listening-01
Scenario: A front desk that has stopped listening is reported unhealthy
  Given it has not completed a poll of the chat service within its stall window
  When the supervisor checks its health
  Then the front desk is reported as stalled

# BL-370 front-desk-liveness-means-listening-02
Scenario: A quiet front desk is not mistaken for a stalled one
  Given it is completing polls of the chat service
  And no human has written to it
  When the supervisor checks its health
  Then the front desk is reported as healthy

# BL-370 front-desk-liveness-means-listening-03
Scenario: A stalled front desk is brought back with no human in the loop
  Given the front desk is stalled
  When the supervisor checks its health
  Then the front desk is restarted
  And it resumes listening

# BL-370 front-desk-liveness-means-listening-04
Scenario: Restarts are bounded, and giving up is loud
  Given the front desk stalls again after each restart
  When the supervisor has restarted it up to its limit
  Then it stops restarting the front desk
  And the failure is escalated to the human

# BL-370 front-desk-liveness-means-listening-05
Scenario: The escalation is only silenced once it has actually reached the human
  Given the front desk is stalled
  And the escalation to the human fails to send
  When the supervisor evaluates the escalation again
  Then it attempts the escalation again
