Feature: A ticket marked done is actually visible to the human

# BL-335: three tickets are green, merged and closed — and the human says the feature is not
# there. Each complaint post-dates the fix that was meant to deliver it. The pattern, not the
# three features, is the finding: work that passes every test and never executes in the human's
# real environment. Two known mechanisms produce it — a stale build (BL-328) and a host-only
# emitter that goes dark headless (BL-336). This ticket verifies against the human's real
# surfaces, because a passing test is exactly what these three already had.

Background:
  Given a feature the human reported as missing after its ticket was closed

# BL-335 shipped-but-invisible-01
Scenario: Each report is checked against the surface the human actually looks at
  When the report is investigated
  Then the feature is checked on the surface the human actually looks at
  And it is not checked by running a test

# BL-335 shipped-but-invisible-02
Scenario: A feature that is present is reported as a stale complaint, with evidence
  Given the feature is present on the human's surface
  When the report is investigated
  Then the report is answered as stale
  And the evidence from the human's surface is given

# BL-335 shipped-but-invisible-03
Scenario: A feature that is absent has its cause found, not just its symptom patched
  Given the feature is absent from the human's surface
  When the report is investigated
  Then the reason a closed ticket never reached the human is identified
  And the reason is fixed

# BL-335 shipped-but-invisible-04
Scenario Outline: The known causes of an invisible feature are each ruled in or out
  Given the feature is absent from the human's surface
  When the report is investigated
  Then <cause> is ruled in or out explicitly

  Examples:
    | cause                              |
    | the running build being stale      |
    | the emitter only running on a host |
    | the emitter never reaching the surface |

# BL-335 shipped-but-invisible-05
Scenario: No report is closed on the strength of a passing test
  Given the feature's tests pass
  And the feature is absent from the human's surface
  When the report is investigated
  Then the report is not answered as stale

# BL-335 shipped-but-invisible-06
Scenario: A request that was never actually built is called that, not called a defect
  Given the feature was never in the scope of the ticket that closed
  When the report is investigated
  Then the report is answered as work not yet done
  And the outstanding work is raised separately

# BL-335 shipped-but-invisible-07
Scenario: The human gets an answer for every report he filed
  When every report has been investigated
  Then each report has an answer
