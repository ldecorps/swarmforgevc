Feature: pause-blind flow-watchdog alarm names control pause

  # BL-779: A control pause freezes chase/rotation but the flow-watchdog alarm
  # must say the swarm is paused instead of prescribing rotate/nudge verbs the
  # daemon cannot deliver. Babysitter all-clear must name pause too.

  # BL-779 timed-pause-alarm-names-end-01
  Scenario: a warn-tier alarm during a timed pause names the pause end and drops the verb
    Given a parcel aged past the warn threshold
    And a control pause is active with a timed untilMs
    When the flow watchdog formats the alarm text
    Then the alarm names the pause and its end time
    And the alarm carries no rotate or nudge verb

  # BL-779 no-pause-alarm-unchanged-02
  Scenario: the same parcel with no pause active keeps today's alarm text
    Given a parcel aged past the warn threshold
    And no control pause is active
    When the flow watchdog formats the alarm text
    Then the alarm text includes the prescribed unblock verb

  # BL-779 until-resume-pause-no-fabricated-end-03
  Scenario: an until-I-resume pause names pause without fabricating an end time
    Given a parcel aged past the warn threshold
    And a control pause is active until operator resumes
    When the flow watchdog formats the alarm text
    Then the alarm says paused until operator resumes
    And the alarm does not fabricate a timed end

  # BL-779 pause-is-not-a-mute-04
  Scenario: a live pause does not suppress the alarm tier decision
    Given a parcel aged past the warn threshold
    And a control pause is active
    When the flow watchdog evaluates the parcel tier
    Then a warn tier is still decided

  # BL-779 babysitter-all-clear-names-pause-05
  Scenario: babysitter all-clear names an active control pause
    Given a green babysitter snapshot
    And a control pause is active with a timed untilMs
    When the babysitter formats the all-clear line
    Then the line names the control pause and its end time
