Feature: BL-1804 A note to the coordinator is never a dispatch

  BL-1223 narrowed the dispatch trail to what really dispatches: a
  git_handoff's task, or a note whose message leads with the router's
  verb-first "Work <id>" or "Spec <id>". The sweep's own nudge to the
  coordinator ("Work <id> active unassigned - assign_to and route it.")
  was deliberately written in that form, so the sweep would not repeat it.
  The same form makes the nudge read as a dispatch. dispatch_trail_cli then
  answers DISPATCHED for a ticket nobody has routed,
  route_backlog_to_coder.sh refuses to route it without --force, and the
  dispatch-gap sweep goes quiet about a starved ticket. That is BL-1223's
  own failure (the report of a gap read as proof there was none), come
  back through the prefix. It happened to BL-1803 on 2026-09-29: the nudge
  was at 12:41:32Z, the coordinator's forced route at 12:43:29Z. A note
  addressed to the coordinator, the router itself, is never a dispatch,
  and the nudge is deduplicated against its own unread copy instead.

  Background:
    Given an active ticket with no assignee and no parcel in flight

  # BL-1804 a-work-note-dispatches-only-to-a-working-role-01
  Scenario Outline: a Work note counts as a dispatch only when it is addressed to a working role
    Given the only mailbox handoff naming it is a note to "<to>" reading "Work BL-900: read file in backlog/active"
    When the dispatch trail is asked whether that ticket was dispatched
    Then the answer is "<answer>"

    Examples:
      | to          | answer       |
      | coder       | DISPATCHED   |
      | specifier   | DISPATCHED   |
      | coordinator | UNDISPATCHED |

  # BL-1804 the-router-routes-past-the-sweeps-own-nudge-02
  Scenario: the router routes a ticket whose only mention is the sweep's own nudge
    Given the only mailbox handoff naming it is the sweep's unassigned nudge to the coordinator
    When the coordinator routes it with route_backlog_to_coder.sh without --force
    Then a parcel is emitted for that ticket

  # BL-1804 the-nudge-is-not-repeated-while-unread-03
  Scenario: the sweep does not nudge again while its nudge is still unread
    Given the sweep's unassigned nudge for that ticket is waiting unread in the coordinator's inbox
    When the unassigned-active sweep runs
    Then it sends no second nudge for that ticket
