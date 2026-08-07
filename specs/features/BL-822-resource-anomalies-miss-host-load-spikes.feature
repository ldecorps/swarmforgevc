# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-07T15:56:00.922096Z","feature_name":"resource health reports host load, not only per-role RSS/CPU trends","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-822-resource-anomalies-miss-host-load-spikes.feature","background_hash":"de173330278d1b8372b8709196c2bce362583dfa71b3504b6d757d3e0ebae7dc","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: resource health reports host load, not only per-role RSS/CPU trends

  # BL-822. The cost-health sidecar's resource section is derived entirely from
  # per-role RSS/CPU trends (computeResourceAnomalies, ≥10% hour-over-hour).
  # Nothing on the sampling path ever reads the host's load average, so a day
  # spent at 20-25x core count is indistinguishable, in that section, from a
  # quiet one.
  #
  # Host load lands in its own optional sidecar field, NOT inside the
  # resourceAnomalies array: a ResourceAnomaly is {role, rssBytes, cpuPercent,
  # rssTrend, cpuTrend} and the static PWA renderer iterates it reading .role
  # and .rssBytes unconditionally. The load-bearing change is that the
  # "none found" verdict — JSON field and rendered prose alike — must consult
  # both signals.

  Background:
    Given resource sampling is running headlessly on a host with a known core count
    And per-role RSS and CPU trends are available to the cost-health sidecar

  # BL-822 severe-host-load-is-reported-01
  Scenario: a sustained host load far above core count is reported even when every role trend is quiet
    Given the recorded host load stayed at 20 times the core count for 240 minutes
    And no per-role RSS or CPU trend crosses the existing anomaly threshold
    When the cost-health sidecar is built for that day
    Then the sidecar reports a severe host load for that day
    And the sidecar does not report that no resource anomalies were found

  # BL-822 role-anomaly-does-not-mask-host-load-02
  # The observed 2026-08-06 shape: one role anomaly WAS present (coder, 840KB
  # RSS trending down, 0.0% cpu) while the host sat at 20-25x cores. A check
  # that only asserts "none found" is absent passes vacuously on that data, so
  # this scenario asserts the host-load signal is itself present alongside it.
  Scenario: a per-role anomaly present at the same time does not mask the host-load signal
    Given the recorded host load stayed at 20 times the core count for 240 minutes
    And one role's RSS or CPU trend crosses the existing anomaly threshold
    When the cost-health sidecar is built for that day
    Then the sidecar reports a severe host load for that day
    And that role still appears among the per-role resource anomalies

  # BL-822 quiet-host-still-reports-none-found-03
  Scenario: a genuinely quiet host still reports none found
    Given the recorded host load stayed at 1.5 times the core count for 240 minutes
    And no per-role RSS or CPU trend crosses the existing anomaly threshold
    When the cost-health sidecar is built for that day
    Then the sidecar does not report a severe host load for that day
    And the sidecar reports that no resource anomalies were found

  # BL-822 role-anomalies-remain-additive-04
  Scenario: a per-role anomaly still surfaces on its own when the host was quiet
    Given the recorded host load stayed at 1.5 times the core count for 240 minutes
    And one role's RSS or CPU trend crosses the existing anomaly threshold
    When the cost-health sidecar is built for that day
    Then that role still appears among the per-role resource anomalies
    And the sidecar does not report a severe host load for that day

  # BL-822 severity-needs-ratio-and-duration-05
  # Guards against crying wolf: a single build spike clears the ratio but not
  # the sustained window, and a long stretch of ordinary load clears the
  # window but not the ratio. Severe requires both.
  Scenario Outline: host load is severe only when it is both high enough and sustained enough
    Given the recorded host load stayed at <ratio> times the core count for <minutes> minutes
    And no per-role RSS or CPU trend crosses the existing anomaly threshold
    When the cost-health sidecar is built for that day
    Then the sidecar severe host load verdict is <severe>

    Examples:
      | ratio | minutes | severe |
      | 20    | 240     | true   |
      | 6     | 30      | true   |
      | 20    | 5       | false  |
      | 3     | 240     | false  |

  # BL-822 host-load-does-not-imply-role-sampling-06
  # BL-350 defined resourceSamplesObserved as "per-role sampling actually ran",
  # so a broken sampler is distinguishable from a quiet day. A host-load sample
  # needs no role pid and must never stand in for that signal.
  Scenario: a recorded host load never stands in for per-role sampling having run
    Given no role's process could be sampled for that day
    And the recorded host load stayed at 20 times the core count for 240 minutes
    When the cost-health sidecar is built for that day
    Then the sidecar reports that per-role resource samples were not observed
    And the sidecar reports a severe host load for that day
