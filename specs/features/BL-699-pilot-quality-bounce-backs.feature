Feature: Cursor /pilot prefers quality and first-class bounce-backs

  # BL-699: retune composePilotExpeditorPrompt so Cursor-as-expeditor
  # optimizes evidence and gate discipline over finishing quickly, treats
  # bounce-backs to earlier pipeline roles as first-class, and requires a
  # Telegram poll on Cursor Remote for any human question.
  #
  # Prompt-only slice. Sibling intakes (Telegram status posts, orphan
  # cleanup / stage boundaries) are out of scope. Full poll send/wiring
  # lives with the status-posts slice; this feature only requires the
  # prompt rule. Automated /expedite and the pilot-vs-expedite lock gate
  # stay unchanged.

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-699 pilot-quality-01
  Scenario: the /pilot prompt prefers quality over speed
    When the offline expeditor prompt is composed for ticket "BL-699"
    Then the prompt states that output quality is preferred over delivery speed
    And the prompt states that evidence and gate discipline beat finishing quickly

  # BL-699 pilot-quality-02
  Scenario: the /pilot prompt treats bounce-backs as first-class
    When the offline expeditor prompt is composed for ticket "BL-699"
    Then the prompt authorizes returning to an earlier pipeline role when an upstream defect appears
    And the prompt requires a rationale when bouncing back
    And the prompt does not treat "already past role N" as a reason to paper over defects

  # BL-699 pilot-quality-03
  Scenario: the /pilot prompt forbids rushing the QA stamp
    When the offline expeditor prompt is composed for ticket "BL-699"
    Then the prompt forbids rushing to a QA stamp over fixing upstream defects

  # BL-699 pilot-quality-04
  Scenario: the /pilot prompt requires a Telegram poll for human questions
    When the offline expeditor prompt is composed for ticket "BL-699"
    Then the prompt requires any human question from a piloted hat to use a Telegram poll on Cursor Remote
    And the prompt rejects free-text-only human asks as insufficient

  # BL-699 pilot-quality-05
  Scenario: the /pilot prompt still walks stages and keeps expedite isolation
    When the offline expeditor prompt is composed for ticket "BL-699"
    Then the prompt still names the offline Cursor-as-expeditor mode
    And the prompt still forbids spawning expedite_cli or claude -p stage runners
    And the prompt still requires worktree isolation under expedite-BL-699
    And gating /pilot against an active expedite lock still refuses when the lock is held
