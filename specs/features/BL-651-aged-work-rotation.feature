Feature: mono-router rotation bounds starvation by parcel age

  # BL-651: preferred-rotate-target (mono_router_lib.bb) ranks actionable
  # roles by priority band and then, inside a band, by NEWEST parcel first
  # (BL-636). Nothing in the rotation decision reads how long a parcel has
  # already waited, so a queue that keeps receiving fresher mail at the same
  # priority — on a mono-router pack that is normally the home role, coder —
  # can outrank an older parcel in a dormant queue for as long as the fresh
  # mail keeps arriving. BL-576 closed the sibling gap for NOTES (an aged
  # note becomes actionable at all); this ticket bounds starvation among rows
  # that are ALREADY actionable, git_handoffs included.
  #
  # Ordering stays priority-first (ticket constraint 4): age breaks ties
  # INSIDE the best priority band and never lets a worse-priority parcel jump
  # a better-priority one. The default threshold sits below
  # flow_watchdog_warn_ms so a dormant queue drains before the human is ever
  # alarmed about it.
  #
  # Everything that already refuses a rotation still refuses it: this rule
  # only changes WHICH role is preferred, never whether the resident may be
  # interrupted (busy pane, recent churn, rotate cooldown, one rotation per
  # sweep are all unchanged).

  Background:
    Given a mono-router pack with config rotation router
    And rotation_starve_after_ms is "600000"

  # BL-651 age-breaks-ties-inside-priority-band-01
  Scenario Outline: age decides only inside the best priority band
    Given dormant role "documenter" holds actionable mail at priority "<dormant_priority>" that has waited "<dormant_waited>"
    And home role "coder" holds actionable mail at priority "<home_priority>" that has waited "1m"
    When the rotation target is computed
    Then "<selected>" is selected

    Examples:
      | dormant_priority | dormant_waited | home_priority | selected   |
      | 00               | 12m            | 00            | documenter |
      | 00               | 3m             | 00            | coder      |
      | 50               | 12m            | 00            | coder      |

  # BL-651 oldest-starved-queue-first-02
  Scenario: two starved queues drain oldest first
    Given dormant role "cleaner" holds actionable mail at priority "00" that has waited "40m"
    And dormant role "documenter" holds actionable mail at priority "00" that has waited "12m"
    When the rotation target is computed
    Then "cleaner" is selected

  # BL-651 age-from-parcel-headers-not-file-mtime-03
  Scenario: a worktree sync touching the file does not reset a parcel's wait
    Given dormant role "documenter" holds actionable mail at priority "00" that has waited "12m"
    And that parcel's file mtime was touched by a worktree sync moments ago
    And home role "coder" holds actionable mail at priority "00" that has waited "1m"
    When the rotation target is computed
    Then "documenter" is selected

  # BL-651 disabled-reproduces-the-starve-04
  Scenario: with the rule off the starved parcel still loses
    Given rotation_starve_after_ms is "off"
    And dormant role "documenter" holds actionable mail at priority "00" that has waited "12m"
    And home role "coder" holds actionable mail at priority "00" that has waited "1m"
    When the rotation target is computed
    Then "coder" is selected

  # BL-651 never-preempts-work-in-flight-05
  Scenario: a starved queue never interrupts the resident mid-turn
    Given dormant role "documenter" holds actionable mail at priority "00" that has waited "40m"
    And the resident pane is busy
    When the resident rotation gate is evaluated for "documenter"
    Then the rotation is refused as "busy"

  # BL-651 drains-before-the-flow-watchdog-warns-06
  Scenario: the default threshold sits below the flow-watchdog warn tier
    Given the default rotation_starve_after_ms
    And the default flow_watchdog_warn_ms
    When the two thresholds are compared
    Then the rotation threshold is lower than the warn threshold

  # BL-651 wired-into-the-live-rotation-decision-07
  Scenario: the daemon's own preferred rotate target reflects a starved queue
    Given a live handoffd role set where dormant role "documenter" holds a git_handoff that has waited "12m"
    And home role "coder" holds a newer git_handoff at the same priority
    When handoffd computes its preferred rotate target
    Then "documenter" is printed as the preferred rotate target
