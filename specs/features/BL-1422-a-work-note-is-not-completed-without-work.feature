# mutation-stamp: sha256=1a861c318ecacf6b3e5504670c0a49114ef1071c96d77d5b8820ee3d21855109
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T09:02:05.756978564Z","feature_name":"BL-1422 A Work dispatch cannot be completed without work or a stated reason","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1422-a-work-note-is-not-completed-without-work.feature","background_hash":"cf497ed00684fed6b3bc91685004c488171c408a1538bdc06cb006c8e0c6dbad","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a Work note followed by work evidence completes as today","scenario_hash":"5ce8a0305cd190a42da1252c0c23c8c72c081c0197868e8df4a8e2ecfbbe6b85","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-05T09:02:05.756978564Z"},{"index":3,"name":"a note that is not a Work dispatch, or a git_handoff, completes as today","scenario_hash":"6a2c64a12579e25dfcd0f8ed643b3ebd5a1249db5f6af7570937aa752baa0354","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-05T09:02:05.756978564Z"}]}
# acceptance-mutation-manifest-end

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
