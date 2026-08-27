Feature: Budget-aware shift governor projects burn and chooses shift verdict

  # BL-666: anchor-calibrated burn projection at each shift boundary chooses
  # full / SHORT / CHEAP / SKIP so the prepaid token tank reaches weekly
  # replenish. Human relays Usage % anchors; BL-664 walker measures burn.
  # BL-660 shift applier hosts the governor. Never spends paid credits silently.

  Background:
    Given the budget-aware shift governor is configured for a prepaid plan

  # BL-666 founding-fixture-verdict-01
  Scenario: founding arithmetic 71 percent at 2.2 days yields a pacing verdict
    Given anchor usage is "71" percent at "2.2" days into the weekly window
    And measured burn is "32" percent per day
    And affordable burn is "6" percent per day to reach replenish
    When the governor runs at the shift boundary
    Then the verdict is not full shift
    And the announcement includes remaining percent days-to-reset and measured burn per shift

  # BL-666 anchor-calibration-02
  Scenario: two human anchors calibrate percent-per-token projection
    Given anchor A reports usage "50" percent at timestamp T1
    And anchor B reports usage "71" percent at timestamp T2 after measurable transcript burn
    When calibration runs between anchors
    Then projected usage gauge is labelled calibrated
    And burn between anchors is derived from the BL-664 transcript walker

  # BL-666 stale-anchor-degraded-03
  Scenario: stale anchor beyond N days enters degraded mode
    Given the last human anchor is older than the stale threshold
    When the governor runs at the shift boundary
    Then the verdict announcement labels degraded mode
    And no confident burn projection is presented as exact

  # BL-666 verdict-ladder-short-04
  Scenario: moderate overrun chooses SHORT shift before CHEAP or SKIP
    Given remaining budget percent and days-to-reset allow a trimmed shift but not full hours
    When the governor runs at the shift boundary
    Then the verdict is SHORT shift
    And the announcement states trimmed hours and its arithmetic

  # BL-666 verdict-ladder-cheap-05
  Scenario: severe overrun chooses CHEAP shift via ModelFactory certified seats
    Given remaining budget percent and days-to-reset require cheaper seats
    When the governor runs at the shift boundary
    Then the verdict is CHEAP shift
    And seat assignment uses ModelFactory assign mode cheap for certified seats only

  # BL-666 verdict-ladder-skip-06
  Scenario: skip shift still drains approvals and Telegram at next start
    Given remaining budget percent and days-to-reset require SKIP
    When the governor runs at the shift boundary
    Then the verdict is SKIP
    And approvals and Telegram drain at the next swarm start without silent drop

  # BL-666 no-credits-without-opt-in-07
  Scenario: governor never spends paid credits without explicit human opt-in
    Given the plan distinguishes prepaid tank from paid credits
    When any verdict would spend paid credits
    Then the governor refuses and announces that credits require explicit opt-in
