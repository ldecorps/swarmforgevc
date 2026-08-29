Feature: Behaviour-trend series are published on the live Mini App console

  The BL-594 series (BL-595 to BL-602 plus the global-tokens BL-605) are
  producers; this is their surface. A Trends board on the LIVE holistic
  console, served over the token-authed bridge - not the static PWA, which
  carries only git-SHA-derivable data and has no bridge connectivity.

  Read-only, and it never invents a data point: a series with nothing to
  plot says so rather than drawing a flat line, whether that is because
  its producer has not landed or because it has landed and recorded
  nothing yet. The two causes are indistinguishable to this screen by
  design, and both are honest as "no data yet".

  Background:
    Given the live holistic console served over the bridge
    And a trends board registered on that console

  # BL-603 trends-published-on-mini-app-01
  Scenario Outline: Every landed BL-594 series has a place on the board
    Given the series <series> produced by <producer>
    When the trends board is rendered
    Then the board shows a plot for <series>
    And that plot was computed through the shared trend framework

    Examples:
      | series                  | producer                  |
      | human-loop-reliability  | humanLoopReliability.ts   |
      | mono-router-rotation    | rotationDynamics.ts       |
      | self-heal-events        | selfHealTelemetry.ts      |
      | false-alarm-rate        | alertTelemetry.ts         |
      | intake-balance          | deliveryMetrics.ts        |
      | human-decision-latency  | humanDecisionLatency.ts   |
      | compaction-cadence      | compactionCadence.ts      |
      | handoff-latency         | handoffLatency.ts         |
      | global-token-tokens     | globalTokenConsumption.ts |

  # BL-603 trends-published-on-mini-app-02
  Scenario Outline: A series with nothing to plot says so and fabricates nothing
    Given a registered series whose points are empty because <cause>
    When the trends board is rendered
    Then that series reads as having no data yet
    And the board draws no plotted point for it
    And the board renders without error

    Examples:
      | cause                                        |
      | its producer module has not landed           |
      | its producer has landed and recorded nothing |

  # BL-603 trends-published-on-mini-app-03
  Scenario: The trends board is read-only
    When the trends board is rendered
    Then it offers no control that mutates swarm or backlog state

  # BL-603 trends-published-on-mini-app-04
  Scenario: A newly registered series appears without editing the renderer
    Given the series tenth-series registered after the board was written
    When the trends board is rendered
    Then the board shows a plot for tenth-series
    And no exhaustive per-series list had to be edited to make it appear

  # BL-603 trends-published-on-mini-app-05
  Scenario: The board's data rides the authed bridge, not the static PWA
    Given a request for the trends board data without a bridge token
    When the request is served
    Then it is refused as unauthorised
    And no trend series is readable from the static backlog dashboard
