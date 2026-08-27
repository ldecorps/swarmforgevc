Feature: The human can follow an epic, not just its atomised slices

# BL-341: topics are strictly per-ticket, and "epic" exists nowhere in the data — only as prose in
# ticket notes. So the human sees four unrelated topics instead of "Dynamic Routing is 4 of 5
# done, and the missing slice is the one that proves it saves money". The load-bearing requirement
# is the last one: the epic must state remaining slices that HAVE NO TICKET YET. All three of the
# human's epics had exactly such a gap, living only in another ticket's notes — an epic view that
# could only see tickets would have shown all three as done and hidden every one of them.

Background:
  Given work that is delivered as several slices over time

# BL-341 epics-as-first-class-topics-01
Scenario: A slice declares which epic it belongs to, as data
  Given a slice belonging to an epic
  When the slice is read
  Then the epic it belongs to is read from the slice itself
  And it is not inferred from the slice's prose

# BL-341 epics-as-first-class-topics-02
Scenario: An epic gets a topic when its first slice appears
  Given an epic with no topic yet
  When its first slice appears
  Then a topic is created for the epic

# BL-341 epics-as-first-class-topics-03
Scenario: An epic's topic is created once, not once per slice
  Given an epic that already has a topic
  When another of its slices appears
  Then no second topic is created for that epic

# BL-341 epics-as-first-class-topics-04
Scenario: A slice completing posts progress into its epic's topic
  Given an epic with a topic and several slices
  When one of its slices completes
  Then progress is posted into the epic's topic
  And the progress states how many of the epic's slices remain

# BL-341 epics-as-first-class-topics-05
Scenario: The epic states remaining slices that have no ticket yet
  Given the epic has a remaining slice that has no ticket
  When the epic's remaining work is stated
  Then that slice is stated as remaining

# BL-341 epics-as-first-class-topics-06
Scenario: An epic whose ticketed slices are all done is not reported as finished while work remains
  Given an epic whose every ticketed slice is done
  And the epic has a remaining slice that has no ticket
  When the epic's remaining work is stated
  Then the epic is not reported as complete

# BL-341 epics-as-first-class-topics-07
Scenario: A ticket with no epic behaves exactly as it does today
  Given a ticket that declares no epic
  When the ticket completes
  Then it is routed to its own topic as before
  And no epic progress is posted

# BL-341 epics-as-first-class-topics-08
Scenario: The existing per-ticket topic machinery is reused, not duplicated
  Given an epic with a topic
  When the epic's topic is looked up
  Then it is looked up through the same mapping the per-ticket topics use
