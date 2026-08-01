Feature: Bubble opens a read-only Live Screen fed by the existing bridge snapshot
  Live Screen is served today by bridgeServer.ts at /resident-pane and rendered
  in the Telegram Mini App. This slice gives Bubble its own native Live Screen
  shell reading that same endpoint, so the two surfaces cannot diverge. It is
  additive: the Mini App Live Screen is untouched, no control action is wired,
  and nothing is deprecated until parity is proven in a later slice.
  Source: backlog/INTAKE-migrate-live-screen-from-mini-app-to-bubble.md.

  Background:
    Given Bubble is paired with a reachable bridge

  # BL-774 bubble-live-screen-01
  Scenario: Live Screen is reachable from Bubble's main navigation
    When the human opens Live Screen from the main navigation
    Then the Live Screen is shown

  # BL-774 bubble-live-screen-02
  Scenario: the roles render in the canonical Live Screen order
    Given the bridge reports a running swarm
    When the human opens Live Screen from the main navigation
    Then every role the bridge reports is listed
    And the roles appear in the canonical Live Screen order

  # BL-774 bubble-live-screen-03
  Scenario Outline: a failed fetch shows the reason the server gave, not a bare code
    Given the bridge fails a Live Screen fetch with <failure>
    When the human opens Live Screen from the main navigation
    Then the Live Screen shows the reason for <failure>
    And it does not show a bare HTTP status code alone

    Examples:
      | failure              |
      | an unreachable host  |
      | a rejected token     |
      | a stopped swarm      |

  # BL-774 bubble-live-screen-04
  Scenario: this slice reads only
    When the human opens Live Screen from the main navigation
    Then no control action is offered on the Live Screen
    And the Mini App Live Screen still serves its own view unchanged
