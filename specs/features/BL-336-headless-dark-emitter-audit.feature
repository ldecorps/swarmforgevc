Feature: Every human-visible emitter has a known headless verdict

# BL-336: "host-only, dark when headless" has bitten three times (BL-214/BL-258 briefing email,
# BL-272 cost-health sidecar, and probably the three invisible features in BL-335). Each time it
# was found by a human noticing an empty surface, never by the system reporting one. The failure
# is silent by construction: nothing errors, the surface is just blank. This is a one-pass audit —
# the output is a list with a verdict per emitter, and the verdict must come from actually running
# headless, because "the code looks like it runs" is exactly the mistake that created the bug class.

Background:
  Given the swarm has emitters that write to surfaces the human looks at

# BL-336 headless-dark-emitter-audit-01
Scenario: Every human-visible emitter is enumerated
  When the audit is performed
  Then every emitter that writes to a human-visible surface is listed

# BL-336 headless-dark-emitter-audit-02
Scenario: Each emitter gets an explicit headless verdict
  When the audit is performed
  Then each listed emitter has a verdict of runs headless, dark when headless, or not applicable
  And no emitter is left without a verdict

# BL-336 headless-dark-emitter-audit-03
Scenario: Each emitter states what triggers it and whether that trigger exists headless
  When the audit is performed
  Then each listed emitter states what triggers it
  And each listed emitter states whether that trigger exists when no host is running

# BL-336 headless-dark-emitter-audit-04
Scenario: The verdict comes from a real headless run, not from reading the code
  Given the swarm is run with no host present
  When the audit is performed
  Then each verdict is supported by which surfaces populated in that run

# BL-336 headless-dark-emitter-audit-05
Scenario: An emitter believed to run headless but observed dark is recorded as dark
  Given an emitter's code suggests it runs without a host
  And the surface it writes to stays empty when no host is running
  When the audit is performed
  Then that emitter is recorded as dark when headless

# BL-336 headless-dark-emitter-audit-06
Scenario: A dark emitter names the headless caller it is missing
  Given an emitter is dark when headless
  When the audit is performed
  Then the audit states what would have to invoke it in a headless run

# BL-336 headless-dark-emitter-audit-07
Scenario: Each dark emitter becomes its own ticket
  Given an emitter is dark when headless
  When the audit is performed
  Then a ticket is raised for that emitter

# BL-336 headless-dark-emitter-audit-08
Scenario: Nothing is fixed silently inside the audit
  Given an emitter is dark when headless
  When the audit is performed
  Then that emitter is not repaired as part of the audit
