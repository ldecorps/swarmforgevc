Feature: A local seat starts the next ticket in a fresh session after it forwards one
  A local-model seat's launcher starts qwen once and starts it again only for
  a restart request (BL-1991), so one session runs from parcel to parcel and
  carries every earlier ticket's reads into the next. The human, 2026-10-07:
  iq3 should clear context after forwarding a ticket. After a seat queues a
  git_handoff and completes the parcel, the repeat guard ends qwen and the
  launcher starts a fresh session with the seat's normal launch message,
  without spending the parcel's restart count.

  Background:
    Given a local coder seat holding a parcel, with no restart used

  # BL-2070 fresh-session-after-forward-01
  Scenario: a seat that forwards its ticket starts the next parcel in a fresh session
    Given the seat queued a git_handoff for its ticket with swarm_handoff.sh
    When the seat runs done_with_current.sh and it completes the parcel
    Then the seat's qwen process is ended
    And the launcher's next session starts with the seat's normal launch message
    And the parcel's restart count is unchanged

  # BL-2070 fresh-session-after-forward-02
  Scenario Outline: a completion that forwarded nothing keeps the session
    Given the seat's only swarm_handoff.sh call since it took the parcel <send>
    When the seat runs done_with_current.sh and it completes the parcel
    Then the seat's qwen process is not ended

    Examples:
      | send                                            |
      | does not exist                                  |
      | printed AUDIT_REQUIRED and queued nothing       |
      | queued a note                                   |
