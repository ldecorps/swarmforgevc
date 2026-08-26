Feature: A blocked role reaches the human even when its question belongs to no ticket

# BL-358: the concierge keys a gate transition by the ticket the gated role currently HOLDS, and
# deliberately DROPS a gate it cannot tag to a ticket rather than guess a topic. Observed live: the
# specifier sat blocked on a question while holding no ticket (it was draining an intake file, not
# building one), so its question reached the human NOWHERE — it was parked in a tmux pane until an
# operator happened to look. That is exactly the failure the human-in-the-loop work exists to
# prevent, reappearing through the one seam it did not cover. A gate with no ticket now has an
# obvious home: the standing Operator topic, which did not exist when the drop-rather-than-guess
# rule was written.

Background:
  Given a role is blocked waiting on the human

# BL-358 untagged-gate-reaches-the-human-01
Scenario: A blocked role holding no ticket still reaches the human
  Given the blocked role holds no ticket
  When the swarm notices the role is blocked
  Then the human is asked the role's question in the standing Operator topic

# BL-358 untagged-gate-reaches-the-human-02
Scenario: A blocked role holding a ticket still asks in that ticket's own topic
  Given the blocked role holds a ticket
  When the swarm notices the role is blocked
  Then the human is asked the role's question in that ticket's topic

# BL-358 untagged-gate-reaches-the-human-03
Scenario: The human's answer reaches the blocked role and unblocks it
  Given the blocked role holds no ticket
  And its question has been posted in the standing Operator topic
  When the human answers there
  Then the answer reaches the blocked role
  And the role resumes work

# BL-358 untagged-gate-reaches-the-human-04
Scenario: A role that blocks and stays blocked is asked about once, not every tick
  Given the blocked role holds no ticket
  And its question has been posted in the standing Operator topic
  When the swarm reviews the gates again while the role is still blocked
  Then no second question is posted in the standing Operator topic
