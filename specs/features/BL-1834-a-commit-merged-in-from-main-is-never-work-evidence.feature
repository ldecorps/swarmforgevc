Feature: BL-1834 a commit merged in from main is never a role's work evidence
  The Work-note gate (BL-1422) lets a role complete a "Work <id>" note
  only after a commit or a git_handoff naming that ticket, counted from
  the moment the note was created (BL-1645). It reads every commit on the
  role's HEAD. The coordinator's own "Promote <id>" and "BL topic record
  for <id>" commits are made seconds after the dispatch; once the role
  merges main they sit on its HEAD and read as its work. On 2026-09-30 the
  coder completed the Work notes for BL-1830, BL-1833 and BL-1816 this
  way, one after another, with nothing built, and went idle. Only work on
  the role's own branch counts.

  Background:
    Given a fixture repository whose main branch and role worktree share history
    And a Work note for BL-9001 created at T in the role's in_process

  # BL-1834 main-commit-is-not-work-evidence-01
  Scenario Outline: a commit main gained after the note is not work evidence once merged in
    Given main gains a commit "<subject>" after T
    And the role merges main with a <merge> merge
    When the role runs done_with_current.sh
    Then the completion is refused naming BL-9001
    And the Work note is still in in_process

    Examples:
      | subject                                    | merge        |
      | BL topic record for BL-9001                | fast-forward |
      | BL topic record for BL-9001                | no-ff        |
      | Promote BL-9001: paused → active for coder | no-ff        |

  # BL-1834 own-branch-commit-is-work-evidence-02
  Scenario: a commit naming the ticket on the role's own branch still completes the note
    Given main gains a commit "BL topic record for BL-9001" after T
    And the role merges main with a no-ff merge
    And the role commits "BL-9001: build the thing" on its own branch after T
    When the role runs done_with_current.sh
    Then the Work note is completed
