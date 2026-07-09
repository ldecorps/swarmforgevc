Feature: mutated Gherkin examples prove acceptance data is load-bearing

# BL-113 gherkin-mutation-01
Scenario: a caught mutant passes the check
  Given a feature file whose example values drive the system under test
  When gherkin-mutator produces mutated IRs and the runs execute
  Then each mutant that changes observable behavior is reported caught

# BL-113 gherkin-mutation-02
Scenario: a surviving mutant is reported
  Given a scenario whose example value is not actually asserted anywhere
  When its mutated IR run executes
  Then the run reports that mutant as surviving, naming the scenario
    and the mutated value

# BL-113 gherkin-mutation-03
Scenario: long mutation runs are distinguishable from hangs
  Given a Gherkin mutation run over multiple mutants
  While the run is in progress
  Then periodic progress/status output is emitted

# Non-behavioral gates:
#  - gherkin-mutator installed from the pinned APS ref recorded in
#    swarmforge.lock.json.
#  - Mutation manifests only ever written by the tools.
#  - hardender.prompt updated with the soft-Gherkin-mutation duty.
