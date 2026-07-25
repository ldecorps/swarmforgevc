Feature: Morning briefing warns when projected token burn outruns the weekly reset

  # BL-619, human directive 2026-07-24 (re-filed by the operator after the
  # original photo-caption message was silently dropped - BL-620's incident).
  # Epic quota-budget-manager.
  #
  # Ground truth this spec pins (verified 2026-07-25): NO code in this repo
  # reads Anthropic account-level usage (weekly %, credits), and no supported
  # API for the claude.ai subscription limits is known to exist. The account
  # percentage is therefore supplied by a human-recorded ANCHOR checkpoint
  # (the number the human sees in the app), and the projection RATE comes
  # from anchors plus locally metered transcript tokens
  # (extension/src/metrics/transcriptUsage.ts). The section must say when it
  # is projecting from an anchor and must never fabricate a percentage.
  #
  # Surfaces: a new computed briefing section following the established
  # 3-step pattern (compiled TS CLI in extension/out/tools + handoffd.bb
  # adapter + briefing_email_lib.bb key). Unlike the existing appended
  # sections, an ACTIVE WARNING is prepended above the coordinator-authored
  # body and marks the email subject - "leads with" is the directive.
  # All decisions are pure functions over (anchors, local usage, config,
  # pinned now) - never wall-clock reads in tests.

  Background:
    Given a swarm project with a pinned clock and a weekly reset configured for Thursday "07:00" local

  # BL-619 warning-leads-briefing-01
  Scenario: projected exhaustion before the reset makes the briefing lead with the warning
    Given a usage anchor of 23 percent recorded 2 hours before the pinned instant
    And the calibrated burn rate projects 100 percent before the next weekly reset
    When the briefing email is composed
    Then a burn warning section is prepended above the briefing body
    And the warning names the projected run-out time
    And the warning names the choice between pausing human usage and throttling the swarm
    And the email subject carries a token-burn warning marker

  # BL-619 projection-decision-table-02
  Scenario Outline: the projection decision compares projected exhaustion with the next reset
    Given the pinned instant is <hours_to_reset> hours before the next weekly reset
    And a usage anchor of <anchor_pct> percent recorded at the pinned instant
    And the calibrated burn rate is <pct_per_day> percent per day
    When the burn projection is computed
    Then the projection decision is "<decision>"

    Examples:
      | hours_to_reset | anchor_pct | pct_per_day | decision |
      | 72             | 23         | 30          | warn     |
      | 72             | 23         | 20          | ok       |
      | 24             | 90         | 15          | warn     |
      | 24             | 50         | 20          | ok       |

  # BL-619 ok-path-one-line-status-03
  Scenario: projection after the reset appends a one-line status instead of a warning
    Given a usage anchor of 23 percent recorded 2 hours before the pinned instant
    And the calibrated burn rate projects exhaustion after the next weekly reset
    When the briefing email is composed
    Then no token-burn warning marker is added to the subject
    And a one-line burn status appears among the appended sections

  # BL-619 two-anchor-rate-04
  Scenario: with two anchors in the current window the rate uses the latest pair
    Given usage anchors of 10 percent and 23 percent recorded 24 hours apart in the current window
    When the burn projection rate is computed
    Then the projection rate is 13 percent per day

  # BL-619 single-anchor-window-average-05
  Scenario: with a single anchor the rate falls back to the average since the window start
    Given the current weekly window began 48 hours before the pinned instant
    And a single usage anchor of 40 percent recorded 24 hours after the window began
    When the burn projection rate is computed
    Then the projection rate is 40 percent per day

  # BL-619 no-anchor-never-fabricates-06
  Scenario: without a usable anchor the section reports local burn only and never fabricates a percentage
    Given no usage anchor exists in the current weekly window
    When the burn section is composed
    Then the section reports the local token burn rate from transcript telemetry
    And the section states the account-level projection is unavailable until an anchor is recorded
    And the section names the anchor-recording command
    And no account percentage projection is claimed

  # BL-619 anchor-validation-07
  Scenario Outline: the anchor command validates and persists checkpoints
    When the operator records a usage anchor of <pct> percent
    Then the anchor command <outcome>

    Examples:
      | pct | outcome                  |
      | 23  | persists the checkpoint  |
      | 130 | rejects the value        |
      | -5  | rejects the value        |

  # BL-619 malformed-reset-config-08
  Scenario: a malformed reset schedule degrades to local-burn-only and logs loudly
    Given the weekly reset configuration is malformed
    When the burn section is composed
    Then the section degrades to the local-burn-only form
    And a malformed reset config warning is logged loudly

  # BL-619 section-failure-never-blocks-send-09
  Scenario: a burn section failure never blocks the briefing send
    Given the burn section command fails
    When the briefing email is composed
    Then the briefing sends without the burn section
