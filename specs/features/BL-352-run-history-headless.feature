Feature: A swarm launched from the command line appears in the run history

# BL-352 (BL-336 finding H5): the run log is only ever appended by VS Code commands, but the real
# swarm is launched from the shell. So the run history the human reads on the phone never records
# the runs that actually happened. Lowest severity of the audit's findings - a stale history, not
# a missed alert - but it is the same silent-by-construction shape.
#
# The Background deliberately does NOT say "no editor attached": scenario 04 exists precisely to
# pin the editor path, and a Background asserting the opposite would contradict it.

Background:
  Given a run history the human can read

# BL-352 run-history-headless-01
Scenario: A swarm launched from the command line is recorded
  Given no editor is attached
  When the swarm is launched from the command line
  Then that run appears in the run history

# BL-352 run-history-headless-02
Scenario: Stopping the swarm completes the run it started
  Given a swarm was launched from the command line and recorded
  When the swarm is stopped
  Then that run is recorded as finished

# BL-352 run-history-headless-03
Scenario: The recorded run names what it ran against
  Given no editor is attached
  When the swarm is launched from the command line against a target
  Then the recorded run names that target

# BL-352 run-history-headless-04
Scenario: A run launched from an editor is still recorded once
  Given an editor is attached
  When the swarm is launched from the editor
  Then that run appears in the run history once
