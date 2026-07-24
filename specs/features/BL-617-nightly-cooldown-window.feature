Feature: Nightly cooldown window pauses the swarm overnight

  # BL-617, human-requested 2026-07-24, HARD DEADLINE: live before
  # 2026-07-24T18:00Z (19:00 local tonight). Epic swarm-reliability.
  #
  # This is a SCHEDULER over the existing BL-423 pause machinery, not new
  # pause plumbing. Enforcement points:
  #   - Pause state file (existing): .swarmforge/operator/control-pause.json
  #     ({active:true, untilMs} | {active:false}) - the externally readable
  #     truth for human, babysitter daemon, and every swarm process.
  #   - Promotion freeze (existing): backlog_depth_lib.bb folds an active
  #     pause into effective-max-depth 0.
  #   - Morning thaw (existing): handoffd's pause-auto-resume sweep shells to
  #     resume-expired-pauses.js, which clears the expired marker and posts
  #     the Control-topic resume announcement.
  #   - NEW: a cooldown decision evaluated on handoffd's existing sweep
  #     cadence applies the timed pause when the configured window opens.
  #   - NEW: while ANY pause is active, handoffd's outbound-wake sweeps
  #     (parcel delivery, chase nudges, rotate/open-slot nudges) are
  #     suppressed; enqueue always succeeds; nothing is ever killed. The
  #     pause-auto-resume sweep and the cooldown sweep keep running - they
  #     are the thaw.
  #
  # ONE AUTOMATIC APPLICATION PER WINDOW (the manual-override rule, stated
  # per the ticket's instruction): the cooldown applies at most ONE automatic
  # pause per window. A human resume-now while inside the window consumes the
  # current window's application - the swarm then stays resumed until the
  # next window open. A human pause outside or inside the window is never
  # overridden; if it expires inside a window whose application is not yet
  # consumed, the cooldown then applies.
  #
  # Config (swarmforge.conf, read fresh each sweep, degrade-never-crash):
  #   config cooldown_window_enabled true|false   (absent => disabled)
  #   config cooldown_start_local HH:MM           (absent => 19:00)
  #   config cooldown_end_local HH:MM             (absent => 07:00)
  # Times are local wall-clock on the swarm host; the window may span
  # midnight. All decisions are proven with a controllable clock - never
  # sleep-until-7pm in tests.

  Background:
    Given a swarm project with a controllable local clock

  # BL-617 window-open-applies-timed-pause-01
  Scenario: window open applies a timed pause via the existing pause state file
    Given the cooldown window is enabled from "19:00" to "07:00" local
    And no pause is active
    And the cooldown has not yet been applied for the current window
    When the cooldown sweep ticks at "19:03" local
    Then a timed pause is applied until the next "07:00" local boundary
    And the pause state file at ".swarmforge/operator/control-pause.json" records an active pause

  # BL-617 window-decision-table-02
  Scenario Outline: the cooldown decision follows the configured window across midnight
    Given the cooldown window is enabled from "19:00" to "07:00" local
    And no pause is active
    And the cooldown has not yet been applied for the current window
    When the cooldown sweep ticks at "<local_time>" local
    Then the cooldown decision is "<decision>"

    Examples:
      | local_time | decision    |
      | 18:59      | none        |
      | 19:00      | apply-pause |
      | 23:30      | apply-pause |
      | 00:45      | apply-pause |
      | 06:59      | apply-pause |
      | 07:00      | none        |
      | 12:00      | none        |

  # BL-617 morning-auto-resume-thaw-03
  Scenario: the existing auto-resume sweep thaws the swarm at window close
    Given the cooldown pause is active until "07:00" local
    When the pause auto-resume sweep ticks at "07:02" local
    Then the pause is cleared
    And a resume announcement is posted to the Control topic

  # BL-617 human-pause-at-window-open-untouched-04
  Scenario: an already-active human pause is never overridden at window open
    Given the cooldown window is enabled from "19:00" to "07:00" local
    And a human-applied pause is active until "20:00" local
    When the cooldown sweep ticks at "19:03" local
    Then the cooldown decision is "none"
    And the existing pause state is unchanged

  # BL-617 cooldown-applies-after-human-pause-expires-05
  Scenario: the cooldown applies after a human pause expires inside an unconsumed window
    Given the cooldown window is enabled from "19:00" to "07:00" local
    And a human-applied pause expired and was auto-resumed at "20:00" local
    And the cooldown has not yet been applied for the current window
    When the cooldown sweep ticks at "20:05" local
    Then a timed pause is applied until the next "07:00" local boundary

  # BL-617 human-resume-now-during-window-wins-06
  Scenario: a human resume-now after the cooldown paused wins until the next window open
    Given the cooldown window is enabled from "19:00" to "07:00" local
    And the cooldown applied the current window's pause at "19:00" local
    And a human resume-now cleared the pause at "21:00" local
    When the cooldown sweep ticks at "21:05" local
    Then the cooldown decision is "none"
    When the cooldown sweep ticks at "03:00" local
    Then the cooldown decision is "none"

  # BL-617 human-resume-of-human-pause-consumes-window-07
  Scenario: a human resume-now of a human pause inside the window also consumes the window
    Given the cooldown window is enabled from "19:00" to "07:00" local
    And a human-applied pause with no timer has been active since "18:00" local
    And a human resume-now cleared the pause at "22:00" local
    When the cooldown sweep ticks at "22:05" local
    Then the cooldown decision is "none"

  # BL-617 disabled-config-no-pause-08
  Scenario: a disabled or absent cooldown window never pauses
    Given the cooldown window is not enabled
    And no pause is active
    When the cooldown sweep ticks at "19:30" local
    Then the cooldown decision is "none"

  # BL-617 malformed-config-no-pause-loud-log-09
  Scenario: malformed cooldown config disables the window and logs loudly
    Given the cooldown window is enabled with a malformed start time "25:99"
    And no pause is active
    When the cooldown sweep ticks at "19:30" local
    Then the cooldown decision is "none"
    And a malformed cooldown config warning is logged loudly

  # BL-617 default-times-apply-10
  Scenario: enabled with no times configured defaults to 19:00 and 07:00 local
    Given the cooldown window is enabled with no start or end times configured
    And no pause is active
    And the cooldown has not yet been applied for the current window
    When the cooldown sweep ticks at "19:03" local
    Then a timed pause is applied until the next "07:00" local boundary

  # BL-617 delivery-frozen-not-killed-11
  Scenario: in-flight work freezes between enqueue and delivery and thaws at window close
    Given the cooldown pause is active until "07:00" local
    When an agent enqueues a git_handoff parcel at "22:00" local
    Then the parcel is accepted into the outbound queue
    And the parcel is not delivered to the recipient inbox while the pause is active
    And no agent pane is killed by the cooldown
    When the pause clears at "07:00" local
    Then the parcel is delivered within one sweep cadence

  # BL-617 chase-nudges-suppressed-12
  Scenario: chase nudges and wakes are suppressed while the pause is active
    Given the cooldown pause is active until "07:00" local
    And a parcel has sat in a role inbox beyond the stuck threshold
    When the chase sweep ticks at "23:00" local
    Then no chase nudge or wake is sent while the pause is active
    When the pause clears at "07:00" local
    Then the stale parcel is chased normally again

  # BL-617 pause-announcement-posted-13
  Scenario: applying the cooldown pause announces it to the Control topic
    Given the cooldown window is enabled from "19:00" to "07:00" local
    And the Telegram Control topic is configured
    When the cooldown applies the current window's pause
    Then a cooldown pause announcement naming the resume time is posted to the Control topic

  # BL-617 pause-applies-without-telegram-14
  Scenario: a missing Telegram configuration never blocks the pause itself
    Given the cooldown window is enabled from "19:00" to "07:00" local
    And no Telegram configuration is present
    When the cooldown applies the current window's pause
    Then the pause is still applied
    And the pause apply completes without error and skips the announcement

  # BL-617 runbook-names-pause-path-15
  Scenario: the runbook documents the externally readable pause path and config keys
    Given the shipped repository documentation
    When the runbook "docs/how-to/BL-617-nightly-cooldown-window.md" is read
    Then it names the pause state file path ".swarmforge/operator/control-pause.json"
    And it names the cooldown window config keys
