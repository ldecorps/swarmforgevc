Feature: BL-1754 A role asks another role a question through a one-shot read-only helper

  The human, 2026-09-25: "an agent can spin an ephemeral other agent if it
  has a question for it. But that is not quite the same thing as
  installing a secondary resident." With this feature a role that has a
  question for another role runs swarmforge/scripts/peer_question.bb. The
  helper runs the target role's prompts as one print-mode Claude call that
  can only read files, prints the answer, records the question and the
  answer, and exits. It never claims a parcel, drains an intake, starts a
  tmux session or outlives its answer.

  Background:
    Given a fixture project whose specifier seat runs claude through a recording fake

  # BL-1754 answer-printed-and-recorded-01
  Scenario: a question from QA to the specifier is answered on stdout and recorded
    When QA asks specifier "does scenario 03 still apply?"
    Then the fake's answer is printed
    And a question record names QA, specifier, the question and the answer

  # BL-1754 one-read-only-print-mode-call-02
  Scenario: the helper is one print-mode call carrying the specifier's prompts and file-reading tools only
    When QA asks specifier "does scenario 03 still apply?"
    Then claude was called exactly once, in print mode
    And that call allows file-reading tools only
    And that call carries the specifier's role prompt

  # BL-1754 never-enters-the-role-loop-03
  Scenario: the helper claims no parcel, drains no intake and starts no session
    Given specifier's mailbox holds a git_handoff parcel
    And the backlog root holds a raw intake
    When QA asks specifier "does scenario 03 still apply?"
    Then specifier's parcel is still in its inbox
    And the raw intake is still in the backlog root
    And no tmux session is created
    And no process the helper started is alive

  # BL-1754 unsupported-provider-refused-04
  Scenario Outline: a target seat whose provider has no one-shot read-only mode is refused by name
    Given specifier's seat runs <provider>
    When QA asks specifier "does scenario 03 still apply?"
    Then the ask exits non-zero naming <provider>
    And claude was not called

    Examples:
      | provider    |
      | aider       |
      | local-model |

  # BL-1754 unanswered-question-times-out-05
  Scenario: a helper that has not answered within the bound is stopped
    Given the fake never answers
    When QA asks specifier "does scenario 03 still apply?" with a 2 second bound
    Then the ask exits non-zero saying it timed out
    And no process the helper started is alive
