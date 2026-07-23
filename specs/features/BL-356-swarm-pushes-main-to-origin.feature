Feature: The swarm's work reaches origin, so a working swarm never looks dead from outside

# BL-356: twice in one day local `main` accumulated hours of committed work that never reached
# origin — six overnight commits, then a three-hour afternoon window where origin sat frozen at
# 11:51 while the swarm closed and specced tickets. From GitHub, a phone, or a remote session, a
# swarm whose origin does not move is indistinguishable from a dead one, and both times a human had
# to notice, pull and push by hand. Nothing in the swarm scripts pushes anything today: pushing
# depends entirely on an agent remembering to.

Background:
  Given the swarm is running and local main carries commits

# BL-356 swarm-pushes-main-to-origin-01
Scenario: Committed work on main reaches origin without a human
  Given origin is behind local main
  When the swarm next checks its published state
  Then the swarm pushes main to origin

# BL-356 swarm-pushes-main-to-origin-02
Scenario: A transient push failure is retried, not abandoned
  Given a push to origin fails for a transient reason
  When the swarm next checks its published state
  Then the push is retried
  And the retries are bounded rather than unlimited

# BL-356 swarm-pushes-main-to-origin-03
Scenario: Pushes that keep failing raise a loud alarm rather than silently accumulating
  Given every bounded retry of the push has failed
  Then the human is alarmed that the swarm's work is not reaching origin
  And the alarm is only marked delivered once it has actually been delivered

# BL-356 swarm-pushes-main-to-origin-04
Scenario: Work that diverged from origin is surfaced, never force-pushed over
  Given origin carries commits that local main does not
  When the swarm next checks its published state
  Then origin's commits are not overwritten
  And the human is told local main and origin have diverged

# BL-356 swarm-pushes-main-to-origin-05
Scenario: An already-published main is left alone
  Given origin already carries every commit on local main
  When the swarm next checks its published state
  Then nothing is pushed
  And no alarm is raised
