# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-29T08:17:57.790914788Z","feature_name":"Only a message that dispatches work counts as a dispatch trail","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1223-only-a-dispatch-counts-as-a-dispatch-trail.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: Only a message that dispatches work counts as a dispatch trail

  The dispatch trail answers one question: has this ticket ever been handed to
  a role? Both the coordinator's router and the daemon's dispatch-gap sweep
  read it, and both act on it - the router refuses to originate a parcel for a
  ticket that already has a trail, and the sweep auto-routes one that has none.

  The trail is built by scanning every mailbox handoff and extracting a leading
  ticket id from its task or message header. A note is a message, and by
  convention every note in this swarm leads with the ticket id it concerns. So
  a note that merely NAMES a ticket - announcing it as spec-ready, or reporting
  that it has no parcel in flight - is read as proof it was dispatched.

  The consequence is circular: the alarm is consumed as evidence that there is
  nothing to be alarmed about. A ticket announced as spec-ready is born already
  "dispatched" and can never be routed; the sweep that would catch the
  starvation is blinded by the same note; and the coordinator's own report of
  the gap deepens it.

  # BL-1223 dispatch-evidence-is-a-dispatch-01
  Scenario Outline: The trail counts dispatches, not mentions
    Given an active ticket with no parcel in flight
    And the only mailbox handoff naming it has type <type> and header "<header>"
    When the dispatch trail is asked whether that ticket was dispatched
    Then the answer is <answer>

    Examples:
      | type        | header                                             | answer       |
      | git_handoff | BL-900-some-slug                                   | DISPATCHED   |
      | note        | Work BL-900-some-slug: read file in backlog/active | DISPATCHED   |
      | note        | BL-900 ready in backlog/paused/ - approval pending | UNDISPATCHED |
      | note        | BL-900 no parcel in flight - possible drop.        | UNDISPATCHED |

  # BL-1223 dispatch-evidence-is-a-dispatch-02
  Scenario: Reporting a dispatch gap does not close it
    Given an active ticket with no parcel in flight
    And the coordinator has sent a note reporting that the ticket has no parcel
    When the dispatch-gap sweep lists the tickets needing a route
    Then that ticket is listed

  # BL-1223 dispatch-evidence-is-a-dispatch-03
  Scenario: A ticket announced as spec-ready is still routable when promoted
    Given a paused ticket whose only mailbox mention is a spec-ready note
    When the coordinator promotes and routes it
    Then a parcel is emitted for that ticket
