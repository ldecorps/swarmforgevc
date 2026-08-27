Feature: one ticket travels the pipeline as one live parcel

  # BL-760: BL-727 forked in flight on 2026-07-31. The specifier dispatched it to
  # coder as task "BL-727"; that chain ran coder -> cleaner -> architect ->
  # hardender -> documenter and parked a parcel in QA's inbox at 07:43. Four
  # minutes later the mono-router resident, back at its home coder seat with no
  # inbound parcel of any kind, re-ran the coder stage on the same commit and
  # forwarded it as task "BL-727-bl718-pilot-missed-unwired-acceptance" - the
  # ticket's yaml filename. Two live chains for one ticket then ran for eight
  # hours. The architect found a real defect on the second chain, bounced it, and
  # had to warn QA by hand that the copy already sitting in its queue carried the
  # same unfixed defect. No gate noticed. swarm_handoff.sh already refuses a
  # git_handoff whose ticket sits in backlog/done/ (ticket_close_guard_lib.bb);
  # this is that same shape of send-time gate for a ticket already live elsewhere
  # in the pipeline. Ticket ids below are fixtures, never real backlog ids.

  Background:
    Given a SwarmForge project whose pipeline roles each have their own mailbox
    And fixture ticket BL-901 is in backlog/active/

  # BL-760 live-parcel-elsewhere-blocks-01
  Scenario Outline: a forward is refused only when another role holds a live parcel for the same ticket
    Given the documenter's <mailbox> mailbox holds a git_handoff for task "<held task>"
    When the coder runs swarm_handoff.sh on a git_handoff draft for task "<sent task>" addressed to cleaner
    Then the handoff is <outcome>

    Examples:
      | mailbox    | held task                              | sent task                              | outcome |
      | new        | BL-901                                 | BL-901-pilot-missed-unwired-acceptance | refused |
      | in_process | BL-901-pilot-missed-unwired-acceptance | BL-901                                 | refused |
      | new        | BL-90                                  | BL-901                                 | sent    |
      | completed  | BL-901                                 | BL-901                                 | sent    |
      | new        | BL-901                                 | tracer-bullet-carrying-no-ticket-id    | sent    |

  # BL-760 own-inbound-parcel-never-blocks-02
  Scenario: the sender's own inbound parcel never blocks its own forward
    Given the coder's in_process mailbox holds the git_handoff for task "BL-901" it is working
    And no other role holds a live parcel for BL-901
    When the coder runs swarm_handoff.sh on a git_handoff draft for task "BL-901" addressed to cleaner
    Then the handoff is sent

  # BL-760 refusal-is-inert-03
  Scenario: a refused forward writes nothing and wakes nobody
    Given the documenter's new mailbox holds a git_handoff for task "BL-901"
    When the coder runs swarm_handoff.sh on a git_handoff draft for task "BL-901" addressed to cleaner
    Then the handoff is refused
    And the coder's outbox and sent mailboxes are unchanged
    And the cleaner's mailbox receives no parcel
    And no wake is injected into any session

  # BL-760 refusal-names-the-blocker-04
  Scenario: a refusal names the blocking parcel and how to clear a stale one
    Given the documenter's new mailbox holds a git_handoff for task "BL-901"
    When the coder runs swarm_handoff.sh on a git_handoff draft for task "BL-901" addressed to cleaner
    Then the refusal names the ticket, the documenter, and the blocking parcel filename
    And the refusal names the command that abandons a genuinely stale parcel

  # BL-760 notes-are-never-blocked-05
  Scenario: a note about a ticket already in flight is still delivered
    Given the documenter's new mailbox holds a git_handoff for task "BL-901"
    When the architect runs swarm_handoff.sh on a note draft about BL-901 addressed to QA
    Then the handoff is sent
