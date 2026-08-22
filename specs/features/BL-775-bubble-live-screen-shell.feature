Feature: Bubble's Live page shows the coordinator and resident panes without a second renderer

  The bridge already renders the Live Screen for the Telegram Mini App, already
  captures the coordinator + resident snapshot, and already refreshes it every
  1500 ms. The human ruled on 2026-08-06 that Bubble's screens ship as remote
  HTML in the UI bundle rather than as native Kotlin, so Bubble's Live page is
  that same renderer published as a bundle page — not a re-implementation.

  These scenarios are therefore bridge-side and run in the Node acceptance
  runner today. The WebView render on a real phone is device surface and is
  verified by the manual procedure recorded in BL-775, not here.

  Background:
    Given a running swarm and the bridge started via its opt-in command

  # BL-775 bubble-live-page-cast-01
  Scenario: the Live page shows the coordinator and the resident
    Given the swarm has a coordinator pane and a resident pane
    When the Live page is rendered for Bubble
    Then it presents the coordinator and the resident in the canonical role order

  # BL-775 bubble-live-page-one-renderer-02
  Scenario: both surfaces come from one renderer
    When the Live page is rendered for Bubble
    And the Live Screen is rendered for the Mini App route
    Then both are produced by the same Live Screen renderer
    And no second copy of the Live Screen markup exists to drift from it

  # BL-775 bubble-live-page-ticket-strip-03
  Scenario: the pane strip carries what the human needs to judge the pane
    Given the resident holds a claimed ticket
    When the Live page is rendered for Bubble
    Then the strip shows <field> for that pane

    Examples:
      | field                |
      | the ticket id        |
      | the ticket title     |
      | the role label       |
      | the model label      |
      | the claim-entered age |

  # BL-775 bubble-live-page-failure-reason-04
  Scenario: an unavailable pane states why, not just that
    Given a pane capture fails with a reason the bridge can report
    When the Live page is rendered for Bubble
    Then that reason is shown for the pane
    And a bare status code is not the whole message

  # BL-775 bubble-live-page-idle-state-05
  Scenario: a quiet swarm reads as quiet rather than as broken
    Given no swarm pane is currently live
    When the Live page is rendered for Bubble
    Then the page states that the swarm is idle
    And it does not present a perpetual loading state

  # BL-775 bubble-live-page-read-only-06
  Scenario: the page offers no way to change swarm state
    When the Live page is rendered for Bubble
    Then it exposes no control affordance
    And it references no bridge endpoint that mutates swarm state

  # BL-775 bubble-live-page-registered-07
  Scenario: the page is reachable from the pager
    When the served UI bundle manifest is read
    Then it names the Live page as one of its pages
