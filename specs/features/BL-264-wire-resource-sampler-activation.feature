Feature: the resource sampler runs while the swarm is up so cost/resource readers see real data

  # Operator direction 2026-07-10 (via coordinator, spec-vs-implementation gap #7):
  # extension/src/metrics/resourceTelemetry.ts is BUILT and tested
  # (startResourceSampler / stopResourceSampler / sampleProcessStats /
  # appendResourceSample) and the READ side already consumes its output
  # (swarmMetrics.ts, tools/swarm-metrics.ts, costHealthSidecar.ts, bridgeState.ts),
  # but extension.ts never STARTS it — so no samples are ever appended and every
  # reader shows "no samples yet."
  #
  # This is a WIRING ticket, NOT a rebuild: call the existing sampler from the real
  # swarm-lifecycle path (start after a successful launchSwarm / reattach; stop on
  # stopSwarm / stopSwarmCompletely / shutdown), resolving each role's pid from the
  # existing swarm-discovery layer (swarmDiscovery.ts / tmuxClient.ts). Do NOT change
  # the telemetry format or the reader side. startResourceSampler already takes
  # injectable getStats + scheduleTick seams, so start->sample->append and
  # stop->no-append are asserted against fakes, never a real timer.

  Background:
    Given the resource sampler that appends an RSS/CPU sample per role on each tick

  # BL-264 samples-per-role-while-running-01
  Scenario: samples are collected per role while the swarm runs
    Given a running swarm whose agent roles resolve to process ids
    When the sampler ticks
    Then it appends an RSS/CPU sample for each role through the existing append path

  # BL-264 starts-on-swarm-up-02
  Scenario: the sampler starts when the swarm becomes ready
    Given no resource sampler is running
    When the swarm becomes ready
    Then the resource sampler is started

  # BL-264 stops-and-no-leak-03
  Scenario: stopping the swarm stops the sampler with no leaked interval
    Given a running resource sampler
    When the swarm is stopped
    Then the sampler stops appending samples and its tick handle is cleared
