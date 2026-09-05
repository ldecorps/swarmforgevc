Feature: BL-1422 A Work dispatch cannot be completed without work or a stated reason

  The router dispatches a ticket to a role as a note whose message reads
  "Work <ticket>: read file in backlog/active". The task-mode completion
  helper completes whatever is in_process and immediately dequeues the next
  item, so a role clearing a queue with back-to-back completions completes
  each item within seconds of its dequeue without reading it. On
  2026-09-05 the coder cleared thirty queued notes between 05:13Z and
  05:17Z, one every three seconds, and the Work notes for BL-1384 and
  BL-1402 were completed in that burst (39 s and 7 s after dequeue) with
  no commit and no parcel; BL-1384 was re-routed and blind-completed three
  more times (4 s the third time). Nothing distinguishes a dispatch from a
  chase note at the moment of completion.

  This feature is that a Work note is recognised through the one dispatch
  parser (BL-1223) and leaves in_process only with evidence of work since
  its dequeue, a commit naming the ticket on the role's branch or a
  git_handoff naming it, or with an explicit stated reason recorded on the
  completed file; every other note and every git_handoff completes exactly
  as today.

  Background:
    Given a fixture role mailbox and worktree with a Work note for BL-9001 in in_process

  # BL-1422 a-work-note-without-work-is-refused-01
  Scenario: completing a Work note with no work since its dequeue is refused and the note stays in_process
    Given no commit naming BL-9001 on the role's branch since the dequeue and no git_handoff for BL-9001 sent
    When the role runs done_with_current.sh
    Then the completion is refused naming BL-9001 and the two ways to proceed
    And the Work note is still in in_process

  # BL-1422 work-evidence-completes-as-today-02
  Scenario Outline: a Work note followed by work evidence completes as today
    Given <evidence> since the dequeue
    When the role runs done_with_current.sh
    Then the Work note is completed

    Examples:
      | evidence                                              |
      | a commit naming BL-9001 on the role's branch          |
      | a git_handoff naming BL-9001 sent from the role       |

  # BL-1422 a-stated-reason-is-recorded-03
  Scenario: completing a Work note with a stated reason records the reason on the completed file
    Given no work since the dequeue
    When the role runs done_with_current.sh with --no-work and a reason
    Then the Work note is completed
    And the completed file carries the reason under no_work_reason

  # BL-1422 other-items-complete-as-today-04
  Scenario Outline: a note that is not a Work dispatch, or a git_handoff, completes as today
    Given the in_process item is <item> instead of the Work note
    When the role runs done_with_current.sh
    Then the item is completed

    Examples:
      | item                                                |
      | a "branch behind <sha>: dirty worktree" note        |
      | a git_handoff carrying a task                       |

  # BL-1422 the-2026-09-05-burst-stops-at-the-first-work-note-05
  Scenario: a burst of completions over a queue of chase notes stops at the first Work note
    Given a queue of 28 chase notes with a Work note for BL-9001 among them
    When the role runs done_with_current.sh repeatedly with no work in between
    Then every chase note before the Work note is completed
    And the burst stops at the Work note with the refusal
