Feature: the holistic UI and daily briefing surface the unit-test suite-duration trend and flag regressions

  # Operator request (2026-07-10, via coordinator): show the unit-test execution
  # duration trend, with a regression flag, on the phone-facing surface and in the
  # daily briefing — so a slowing unit suite (which the engineering rules treat as a
  # real defect) gets noticed.
  #
  # Specifier verified the live layer; scope reflects what already exists:
  #  - The suite-duration TREND is already computed (computeSuiteDurationTrend in
  #    deliveryMetrics.ts) and the holistic dev-state UI (holisticUiHtml.ts) already
  #    renders "Suite duration: Ns latest <arrow>". The regression WARN signal
  #    already exists too (swarmMetrics.ts, BL-078: latest > warn floor OR latest >
  #    2x baseline mean). REUSE both — never recompute or re-threshold.
  #  - The backlog-dashboard PWA is fed by backlog.json, a git-SHA-reproducible
  #    projection that DELIBERATELY excludes machine-local suite-duration records.
  #    So this lands on the LIVE holistic UI + the daily briefing; backlog.json and
  #    the PWA are left untouched (operator decision 2026-07-10).
  #  - Operator: SHOW the trend AND FLAG regression; compact (latest value + arrow +
  #    flag), no sparkline.

  Background:
    Given machine-local unit-test suite-duration records that feed the suite-duration trend and the BL-078 creep-warning signal

  # BL-252 surface-readout-01
  Scenario Outline: each surface shows the suite-duration trend and flags a regression
    Given the latest unit-suite duration is "<state>" by the creep-warning criterion
    When the "<surface>" renders its suite-duration readout
    Then it shows the latest duration and the trend direction
    And it "<flag>" a regression flag

    Examples:
      | surface        | state            | flag  |
      | holistic UI    | over the bound   | shows |
      | holistic UI    | within the bound | omits |
      | daily briefing | over the bound   | shows |
      | daily briefing | within the bound | omits |

  # BL-252 single-warn-source-02
  Scenario: both surfaces flag regression from the one existing creep-warning signal
    Given the BL-078 creep-warning signal marks the unit suite as warning
    When the holistic UI and the daily briefing render their suite-duration readouts
    Then both flag it as regressing from that same signal rather than a re-derived threshold

  # BL-252 no-data-degrades-03
  Scenario: with no local duration records the readout degrades gracefully
    Given no machine-local unit-suite duration records exist
    When the holistic UI and the daily briefing render their suite-duration readouts
    Then each shows a no-data state rather than an error or a fabricated value

  # BL-252 backlog-json-untouched-04
  Scenario: the git-reproducible backlog projection stays free of machine-local data
    Given the backlog dashboard projection backlog.json is generated
    When the holistic UI and the daily briefing render their suite-duration readouts
    Then backlog.json still excludes the machine-local suite-duration records
