Feature: The swarm diagnoses where it is suboptimal and escalates what it cannot safely fix

# BL-431 (epic swarm-self-optimization, slice 2 of BL-429 — DIAGNOSE + ESCALATE). Reads the rework
# signal BL-430 persists and, only when the current rate is meaningfully above the trailing baseline,
# emits a ranked verdict (where it is most suboptimal, likely cause, recommended action). Scenario 02 is
# the no-false-alarm guard. Scenario 04 pins the epic's safety contract: only the sanctioned knob may be
# marked auto-tunable; every other recommendation is escalate-only.

Background:
  Given a persisted rework signal with a current rate and a trailing baseline

# BL-431 rework-diagnosis-and-escalation-01
Scenario: A rate meaningfully above baseline produces a ranked suboptimality verdict
  Given the current rework rate is meaningfully above the trailing baseline
  When the swarm diagnoses its health
  Then it produces a verdict ranking where it is most suboptimal

# BL-431 rework-diagnosis-and-escalation-02
Scenario: A rate at or below baseline produces no verdict
  Given the current rework rate is at or below the trailing baseline
  When the swarm diagnoses its health
  Then it produces no verdict

# BL-431 rework-diagnosis-and-escalation-03
Scenario: The verdict names the likely cause from the attribution
  Given the current rework rate is meaningfully above the trailing baseline
  And the rework concentrates on one role and one ticket-class
  When the swarm diagnoses its health
  Then the verdict names that role and that ticket-class as the likely cause

# BL-431 rework-diagnosis-and-escalation-04
Scenario Outline: A safe-knob remediation is auto-tunable; any other remediation is escalate-only
  Given a verdict recommending <remediation>
  When the swarm classifies the recommended action
  Then the action is marked <disposition>

  Examples:
    | remediation                     | disposition   |
    | lower the intake throttle       | auto-tunable  |
    | respawn a chronically-slow role | escalate-only |
    | change a routing rule           | escalate-only |

# BL-431 rework-diagnosis-and-escalation-05
Scenario: The verdict reaches the human through the existing surface
  Given a verdict ranking where the swarm is most suboptimal
  When the swarm surfaces the verdict
  Then it appears in the surface the human already reads for swarm health
