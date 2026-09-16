Feature: BL-1614 A Work note is not declined on a stale worktree read

  The coordinator promotes a ticket with a commit on main and routes it
  to the coder with a Work note in the same breath. The coder dequeues
  the note within seconds, reads backlog/active in its own worktree, which
  has not merged main yet, finds the ticket still in paused with no
  assignee, and completes the note with the stated reason that the ticket
  was never promoted. Four tickets on 2026-09-16 (BL-1604, BL-1605,
  BL-1608, BL-1610) and three earlier ones went this way, each found by
  the coordinator's dropped-parcel sweep about forty-five minutes later
  and re-routed with "merge first - retry", which worked every time. This
  feature is that the claim tells the coder when its tree is behind the
  promotion, that a no-work completion of a Work note whose ticket is
  active on main is refused, and that a Work note for a ticket that is
  genuinely paused or absent on main still completes with its reason as
  BL-1422 lets it.

  Background:
    Given a fixture repository with a main branch and a coder worktree branched from an older main, with a coder mailbox and a fixture ticket BL-4242

  # BL-1614 a-work-note-is-not-declined-on-a-stale-worktree-read-01
  Scenario Outline: the claim and the completion both read the promotion from main, never from the worktree alone
    Given on main the ticket BL-4242 is <on-main>
    And in the coder worktree the ticket BL-4242 is <in-worktree>
    And a Work note for BL-4242 is queued to the coder
    When the coder <action>
    Then <outcome>

    Examples:
      | on-main                      | in-worktree                  | action                                                                        | outcome                                                                         |
      | active and assigned to coder | still in paused              | claims the Work note                                                          | the claim prints a merge-main-first line naming BL-4242 and main's tip          |
      | active and assigned to coder | active and assigned to coder | claims the Work note                                                          | the claim prints no merge-main-first line                                       |
      | still in paused              | still in paused              | claims the Work note                                                          | the claim prints no merge-main-first line                                       |
      | active and assigned to coder | still in paused              | claims the Work note and, with no work done, completes it with the reason not promoted yet | the completion is refused naming BL-4242 as active on main and the note stays in in_process |
      | still in paused              | still in paused              | claims the Work note and, with no work done, completes it with the reason not promoted yet | the note is completed with the reason recorded                                   |
      | absent                       | absent                       | claims the Work note and, with no work done, completes it with the reason not promoted yet | the note is completed with the reason recorded                                   |
