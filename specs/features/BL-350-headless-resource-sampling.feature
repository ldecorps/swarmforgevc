Feature: Resource anomalies are sampled even when nobody has an editor open

# BL-350 (BL-336 finding H1): the most insidious shape in the audit. The cost-health sidecar is
# emitted headless every day and looks healthy - but its resourceAnomalies field is ALWAYS empty,
# because the only thing that samples resources lives in the VS Code extension host. The container
# looks fixed; one of its own fields is dead. Live proof: this month's telemetry file has 1677
# real lines and not one of them is a resource sample.

Background:
  Given a swarm running headless, with no editor attached

# BL-350 headless-resource-sampling-01
Scenario: Resource samples are recorded with no editor attached
  When the swarm has been running for a sampling interval
  Then resource samples have been recorded

# BL-350 headless-resource-sampling-02
Scenario: The daily cost-health report carries the anomalies it found
  Given resource samples that contain an anomaly
  When the daily cost-health report is emitted
  Then that anomaly appears in the report

# BL-350 headless-resource-sampling-03
Scenario: A quiet period reports no anomalies rather than reporting nothing
  Given resource samples that contain no anomaly
  When the daily cost-health report is emitted
  Then the report states that no anomaly was found

# BL-350 headless-resource-sampling-04
Scenario: Samples accumulate alongside the existing telemetry, not instead of it
  Given the telemetry already records the swarm's other activity
  When resource samples are recorded
  Then the existing telemetry is still recorded

# BL-350 headless-resource-sampling-05
Scenario: Sampling does not run twice when an editor is also attached
  Given an editor is attached and already sampling resources
  When the swarm samples resources
  Then each sampling interval is recorded once
