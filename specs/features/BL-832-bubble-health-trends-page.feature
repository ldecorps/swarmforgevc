Feature: Bubble's Health page reports how the swarm has been working, without inventing a number

  Traverse time, rework, the bottleneck stage and velocity are already computed
  in extension/src/metrics and already served over the bridge. This page reads
  them. Its whole discipline is that the figure on the phone equals the figure
  the bridge and the CLI give for the same metric — so the scenarios below assert
  agreement with the existing computation rather than asserting a number.

  The windows those computations use are not uniform (velocity rolls over 7 days;
  cycle time uses a count of recent tickets), so each readout states the window
  it actually covers instead of claiming one the swarm does not compute.

  Because the human ruled that Bubble's screens ship as remote HTML in the UI
  bundle, this is bridge-side TypeScript and runs in the Node acceptance runner.

  Background:
    Given a running swarm and the bridge started via its opt-in command

  # BL-832 health-page-agrees-with-source-01
  Scenario Outline: every readout equals the computation that owns it
    Given the swarm has closed tickets within the reported window
    When the Health page is rendered for Bubble
    Then its <readout> equals what the existing computation returns for the same inputs

    Examples:
      | readout          |
      | traverse time    |
      | rework rate      |
      | bottleneck stage |
      | velocity         |

  # BL-832 health-page-states-its-window-02
  Scenario: each readout names the window it covers
    Given the swarm has closed tickets within the reported window
    When the Health page is rendered for Bubble
    Then each readout states the window its own computation used
    And no readout claims a window its computation did not use

  # BL-832 health-page-bounce-split-03
  Scenario: bounces are attributed rather than pooled
    Given bounces were recorded by more than one bouncing role
    When the Health page is rendered for Bubble
    Then the rework readout reports each bouncing role separately

  # BL-832 health-page-rework-verdict-04
  Scenario: the rework readout carries its direction, not just its count
    Given the rework signal has a diagnosed verdict against its baseline
    When the Health page is rendered for Bubble
    Then that verdict is shown beside the rework count

  # BL-832 health-page-no-observations-05
  Scenario: an empty window says so instead of showing zero
    Given the window holds no observations for a readout
    When the Health page is rendered for Bubble
    Then that readout states it has no observations
    And it does not show a zero

  # BL-832 health-page-registered-06
  Scenario: the page is reachable from the pager
    When the served UI bundle manifest is read
    Then it names the Health page as one of its pages
