Feature: The average cost of delivering a ticket is a number the human can watch fall

# BL-338: cost is visible per-role and per-hour, but never per unit of delivered work — so every
# efficiency decision on this project is argued from intuition. The human asked for a diagram of
# average cost per ticket, explicitly so he can reduce it. The trap is attribution: with a ~58%
# bounce rate, a figure that quietly excludes rework flatters the swarm and steers him away from
# his largest cost. So the accounting basis is part of the deliverable, not a footnote.

Background:
  Given tickets that have been delivered, and recorded usage for the roles that worked on them

# BL-338 cost-per-ticket-diagram-01
Scenario: An average cost per ticket is derived from real usage
  When the average cost per ticket is produced
  Then it is derived from the recorded usage of the roles that worked on those tickets

# BL-338 cost-per-ticket-diagram-02
Scenario: The figure does not double-count the master-resident roles
  Given a role that is master-resident worked on a ticket
  When the average cost per ticket is produced
  Then that role's usage is counted once

# BL-338 cost-per-ticket-diagram-03
Scenario: Rework from bounces is included, or its exclusion is stated on the surface
  Given a ticket was bounced and reworked before it was delivered
  When the average cost per ticket is produced
  Then the rework is either included in the ticket's cost or declared as excluded

# BL-338 cost-per-ticket-diagram-04
Scenario: The accounting basis is stated where the human reads the number
  When the average cost per ticket is shown to the human
  Then the surface states what the number includes and excludes

# BL-338 cost-per-ticket-diagram-05
Scenario: The trend over time is visible, not just a single figure
  Given tickets were delivered across more than one period
  When the average cost per ticket is shown to the human
  Then the change over time is visible

# BL-338 cost-per-ticket-diagram-06
Scenario: The diagram reaches the surface the human actually looks at
  When the average cost per ticket is produced
  Then the diagram is present on the surface the human actually looks at
