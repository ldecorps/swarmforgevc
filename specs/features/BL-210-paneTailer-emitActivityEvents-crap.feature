Feature: pane activity-state decision is pure, covered, and behavior-preserving

# BL-210 pure-decision-01
Scenario: the per-role working-state decision is a pure function
  Given a role's command, raw pane text, last-changed time, current time, and
    prior working state
  When the working-state decision is computed
  Then it returns whether the role is working now and whether a change event
    should emit
  And it reads no class instance state and does not call the real clock

# BL-210 behavior-preserved-02
Scenario: the emitted activity events are unchanged after the refactor
  Given the same sequence of pane updates as before the refactor
  When emitActivityEvents runs
  Then it emits the same activity events, with the same role/working values in
    the same order, as before

# BL-210 dead-role-clears-working-03
Scenario: a role that becomes dead while working emits a not-working event
  Given a role currently marked working
  When that role becomes dead
  Then a working=false event is emitted for it and it is no longer tracked as working

# Non-behavioral gates:
#  - Behavior-preserving refactor only; no change to the activity-event
#    contract or to the rest of PaneTailer.
#  - After the split, the extracted decision is fully covered and its CRAP is
#    below the project gate (< 5).
#  - Injected/fake clock in tests; no real timers.
