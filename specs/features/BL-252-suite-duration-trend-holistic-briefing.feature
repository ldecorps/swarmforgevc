# mutation-stamp: sha256=a34b698488d72d873e948657ad01e83944fa46ef68136e21ac94763def475095
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T16:50:05.637898304Z","feature_name":"the holistic UI and daily briefing surface the unit-test suite-duration trend and flag regressions","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-252-suite-duration-trend-holistic-briefing.feature","background_hash":"36bd2fdd5bc5df33cbf45c739061e1e790ec2744653583cba5026d0f9f12c9af","implementation_hash":"unknown","scenarios":[{"index":0,"name":"each surface shows the suite-duration trend and flags a regression","scenario_hash":"0dd6b7061d7fe6a5517f0f24e37ecf2b7255833f2a371f7afaf553c65698cc67","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-07-10T16:50:05.637898304Z"}]}
# acceptance-mutation-manifest-end

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
  #    projection. This ticket lands the trend on the LIVE holistic UI + the daily
  #    briefing only; backlog.json and the PWA are left untouched for now (operator
  #    decision 2026-07-10). BL-290 (2026-07-11) superseded that decision: it lands
  #    suite duration on backlog.json/the PWA too, via the SAME committed-sidecar
  #    mechanism BL-213/BL-272 already use for cost/health data - still never a
  #    live read, so backlog.json stays git-reproducible either way.
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
  # BL-290 note: this scenario's own contract was updated - backlog.json now
  # DOES carry suite-duration data (via BL-290's committed sidecar), but the
  # projection stays git-reproducible either way since it is never a live
  # machine-local read within backlogDashboard.ts itself - see BL-290's own
  # feature file for the PWA-rendering scenarios this landed alongside.
  Scenario: the backlog projection stays git-reproducible - suite duration reaches it only via the committed sidecar, never a live read
    Given the backlog dashboard projection backlog.json is generated
    When the holistic UI and the daily briefing render their suite-duration readouts
    Then backlog.json carries the suite-duration trend only through the committed sidecar, never a live machine-local read
