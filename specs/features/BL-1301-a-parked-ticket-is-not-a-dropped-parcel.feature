Feature: An explicitly parked active ticket is not reported as a dropped parcel

  BL-719's dropped-parcel sweep nudges the coordinator when an active ticket
  has a trail, no parcel in flight anywhere, and a trail stale past the
  threshold. A ticket parked on purpose - a QA LAND_ESCALATE held until its
  blocker lands, say - matches that shape exactly and forever, so the sweep
  re-reports it every cooldown window until the park ends.

  The cost is not the noise itself but what the noise trains: a coordinator
  who learns to skip "no parcel in flight" notes will skip the one that
  reports a real drop. So the sweep must be able to tell a stated park from a
  silent disappearance - and only a park stated durably in the ticket counts,
  never one that lives in a commit message or an agent's memory.

  Background:
    Given an active ticket with a trail, no parcel in flight anywhere, and a trail stale past the threshold

  # BL-1301 parked-ticket-is-not-a-dropped-parcel-01
  Scenario Outline: only an explicitly blocked ticket is spared the drop nudge
    Given the active ticket declares status "<status>"
    When the dropped-parcel sweep evaluates it
    Then a dropped-parcel nudge is sent: "<sent>"

    Examples:
      | status       | sent |
      | blocked      | no   |
      | todo         | yes  |
      | needs_design | yes  |
      | superseded   | yes  |
      | paused       | yes  |

  # BL-1301 parked-ticket-is-not-a-dropped-parcel-02
  # Absence must never buy silence - the same fail-closed posture Article
  # 3.2.4 gives a defect with no severity.
  Scenario: a ticket carrying no status field at all is still nudged
    Given the active ticket carries no status field
    When the dropped-parcel sweep evaluates it
    Then a dropped-parcel nudge is sent: "yes"

  # BL-1301 parked-ticket-is-not-a-dropped-parcel-03
  Scenario: a suppressed ticket is recorded, never silently skipped
    Given the active ticket declares status "blocked"
    When the dropped-parcel sweep evaluates it
    Then the sweep log names the ticket and why it was suppressed

  # BL-1301 parked-ticket-is-not-a-dropped-parcel-04
  # Pins the blast radius: read-active-items is shared with BL-222's
  # dispatch-gap sweep and the unassigned-active sweep, so the suppression
  # belongs to this decision alone. Whether those sweeps should honour a park
  # marker too is a separate question, deliberately not decided here.
  Scenario: the dispatch-gap sweep is unchanged by the park marker
    Given an active ticket that declares status "blocked" and has never been dispatched
    When the dispatch-gap sweep evaluates it
    Then a dispatch-gap nudge is sent: "yes"
