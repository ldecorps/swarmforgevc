Feature: the daily briefing is enriched with pipeline-health observables and PWA deep links

  # Operator direction 2026-07-10 (via coordinator intake, "beef up briefing+PWA";
  # operator selected all briefing candidates + "think of any observables you
  # already have — I'd rather have too many and remove what I don't need"). This is
  # the BRIEFING-CONTENT enrichment epic: additive sections on top of BL-099's
  # existing briefing (business-features headline + delivery-metric trends +
  # forecasts + dashboard link), BL-251's approval list, and BL-252's suite trend.
  #
  # REUSE existing telemetry — do NOT re-derive: stage dwell (BL-102 stageDwell.ts),
  # delivery metrics/trends (deliveryMetrics.ts, trend.ts), chase/nudge
  # (chaserMonitor.ts), cost (costTelemetry.ts), resource (resourceTelemetry.ts).
  # Briefing derives from committed git-visible state + existing telemetry; machine-
  # local data stays out of the git-projection (BL-252 boundary). A section with no
  # data degrades gracefully (BL-099's missing-data posture), never errors.
  #
  # SLICED: each section below is a slice the operator can keep or drop. At build
  # time scope the live acceptance file to BUILT slices; park the rest in a
  # BL-256-*.feature.draft (BL-233 slice-scoping rule).

  Background:
    Given a daily briefing generated from committed git-visible state and existing telemetry

  # BL-256 what-merged-whats-blocked-01
  Scenario: the briefing summarizes what merged and what is blocked
    Given tickets merged since the last briefing and one blocked or stalled ticket
    When the briefing is generated
    Then it lists the tickets merged since the last briefing
    And it lists the blocked or stalled tickets needing attention

  # BL-256 per-stage-throughput-dwell-02
  Scenario: the briefing reports per-stage throughput and dwell
    Given stage-dwell telemetry for the pipeline
    When the briefing is generated
    Then it reports each stage's dwell time and the pipeline throughput

  # BL-256 qa-bounce-chase-trends-03
  # Wording note (QA bounce 20260710, evidence
  # BL-256-briefing-enrichment-bounce-20260710.md): no distinct QA-bounce
  # counter exists anywhere in this codebase (grep-confirmed) - REUSE, don't
  # re-derive rules out inventing one. Scoped to chase/nudge/dead-letter
  # telemetry (the real, already-computed pipeline-health signal BL-098
  # provides), matching docs/Specification.MD's own already-honest wording
  # and chase-trend-line.js's own "Chase/nudge trend:" output label - this
  # scenario's own name is kept (BL-256's own numbered scenario id) but its
  # Given/Then text no longer claims QA-bounce-rate coverage.
  Scenario: the briefing reports chase/nudge trends
    Given chase/nudge telemetry over the recent window
    When the briefing is generated
    Then it reports the chase/nudge counts with their trend direction

  # BL-256 deep-links-into-pwa-04
  Scenario: briefing items deep-link into their PWA views
    Given a briefing item that has a corresponding PWA view
    When the briefing is generated
    Then that item includes a deep link to its PWA view

  # BL-256 graceful-missing-data-05
  Scenario: a section with no data degrades gracefully
    Given an enrichment section whose telemetry is unavailable
    When the briefing is generated
    Then that section shows an explicit no-data note rather than being broken or omitted silently
