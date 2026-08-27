Feature: a role never consumes a human answer it cannot match to its own pending question

  # BL-1201 (epic question-attention-path). 2026-08-27 18:30:54Z: the
  # coordinator delivered the specifier a priority-00 note reading
  # "answer ready: .swarmforge/operator/role-answers/specifier.json". That
  # file held {"text":"Archive in-repo, still readable - move under the
  # handoffs root; nothing deleted; ...","recordedAt":"2026-08-22T17:01:36Z"}
  # — a five-day-old answer about mailbox retention, already consumed by
  # BL-1073, whose YAML quotes it verbatim. Its mtime (08-22 18:01) confirms
  # nothing rewrote it. Meanwhile role-awaiting/specifier.json held a
  # different, live question about a detached master checkout. The answer
  # store (telegram-front-desk-bot.ts's writeRoleAnswerFileIfNeeded) records
  # only {text, recordedAt}, keyed by role name alone, and nothing clears it
  # once consumed — so a role told "answer ready" has no way to tell whether
  # the file answers its question, someone else's, or one settled last week.
  # The mismatch was obvious this time. It would not be between two similar
  # questions.

  # BL-1201 answer-not-matching-the-pending-question-is-refused-01
  Scenario: An answer that identifies a different question is not consumed
    Given a role has a pending question recorded
    And a recorded answer identifies a different question
    When the role is told an answer is ready
    Then the answer is reported as not matching the pending question
    And the pending question is still pending

  # BL-1201 already-consumed-answer-is-not-offered-as-fresh-02
  Scenario: An answer already consumed is not presented as a fresh answer
    Given a recorded answer has already been consumed by the role it was for
    When the role is told an answer is ready
    Then the answer is reported as already consumed

  # BL-1201 matching-answer-is-consumed-normally-03
  Scenario: An answer that identifies the pending question is consumed
    Given a role has a pending question recorded
    And a recorded answer identifies that same pending question
    When the role is told an answer is ready
    Then the answer is delivered to the role
    And the pending question is no longer pending
