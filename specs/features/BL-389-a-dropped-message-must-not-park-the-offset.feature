Feature: A message dropped on purpose does not trap the front desk in a loop

# BL-389 (LIVE INCIDENT, 2026-07-14): the front desk rewrote and committed
# backlog/topics/BL-359.json every ~15s — 209 commits, all pushed to origin/main, the record grown
# to 21KB of the same two human messages replayed over and over, and the human answered "Nothing to
# approve right now." every 30 seconds.
#
# ROOT CAUSE, confirmed in code. `processUpdate` returns false for a DELIBERATE DROP (not-principal
# / no-text). `pollAndForward` pushes that straight into `delivered[]`. `offsetAfterDelivery` (the
# BL-369 anti-message-loss guard) then refuses to advance past any update where `!delivered[i]` — so
# a dropped update PARKS THE TELEGRAM OFFSET FOREVER. Telegram redelivers it and everything after it
# on every poll, and the redelivered updates re-run their side effects.
#
# The guard is RIGHT about failures and WRONG about drops. A failed delivery may succeed on retry, so
# not advancing is correct. A drop is TERMINAL — it can never succeed on retry — so not advancing is
# an infinite loop by construction. Scenario 02 is the neighbour guard: BL-369 must NOT regress.

Background:
  Given the front desk is collecting messages

# BL-389 a-dropped-message-must-not-park-the-offset-01
Scenario: A message dropped on purpose is never fetched again
  Given a message the front desk drops on purpose
  When the front desk collects the waiting messages
  Then the front desk moves past that message

# BL-389 a-dropped-message-must-not-park-the-offset-02
Scenario: A message whose delivery failed is fetched again
  Given a message whose delivery failed
  When the front desk collects the waiting messages
  Then the front desk does not move past that message

# BL-389 a-dropped-message-must-not-park-the-offset-03
Scenario: A dropped message ahead of a failed one does not shield it
  Given a message the front desk drops on purpose
  And a later message whose delivery failed
  When the front desk collects the waiting messages
  Then the front desk moves past the dropped message
  And the front desk does not move past the failed message

# BL-389 a-dropped-message-must-not-park-the-offset-04
Scenario: A message delivered twice is only recorded once
  Given a message already recorded against its ticket
  When the front desk is given that same message again
  Then it is not recorded against that ticket a second time

# BL-389 a-dropped-message-must-not-park-the-offset-05
Scenario: A message delivered twice is only answered once
  Given a message already answered by the swarm
  When the front desk is given that same message again
  Then the human is not answered a second time
