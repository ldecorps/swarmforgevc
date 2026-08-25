Feature: An agent's open-ended clarifying question surfaces directly on Telegram as a plain message, with bounded-await escalation

  # BL-466 (feature, human via the Operator front desk 2026-07-16,
  # INTAKE-operator-question-1784230533165). BL-325 (human-in-the-loop ask/answer/unblock) already
  # shipped, but a specifier clarifying question currently reaches the human only indirectly through the
  # Concierge. The human wants the question surfaced DIRECTLY on Telegram in a dedicated agent-questions
  # topic, and — his Q3 choice 2026-07-16 — rendered as a NATIVE TELEGRAM POLL when the question has
  # discrete options ("in an effort to maintain iso-functionality" with the in-editor AskUserQuestion),
  # with a free-text message fallback for open-ended questions. The human's answer must flow back to the
  # asking agent, reusing BL-325's answer-return path.
  #
  # Scope (grep-confirm at build — these are the verified ask subsystem, but confirm the exact relay
  # function): swarmforge/scripts/operator_ask.bb / operator_runtime.bb / operator_lib.bb (the agent
  # ask->human relay and its awaiting-answer store) and extension/src/notify/telegramClient.ts (which
  # today has sendMessage/editMessageText/getUpdates but NO sendPoll — add a sendPoll wrapper and read
  # poll answers from getUpdates). The question is posted to a dedicated agent-questions Telegram topic.
  # Start with the SPECIFIER as the first producer; the mechanism should generalize to any agent ask.
  #
  # Constraints:
  #   - Reuse BL-325's answer-return machinery (awaiting-answer store + unblock) — do not build a
  #     parallel answer path. The poll's selected option becomes the returned answer; a free-text reply
  #     becomes the returned answer in the fallback case.
  #   - A poll needs 2+ discrete options; a question without discrete options (open-ended) falls back to
  #     a plain Telegram message the human replies to in-thread.
  #   - Bounded await + escalate-once-then-drop is inherited from BL-306/BL-325 — a poll that is never
  #     answered follows the same timeout/escalation posture, never blocks the agent forever.
  #   - Telegram creds / bridge remain the untested boundary; keep the question->poll construction and
  #     the answer->return mapping pure/testable behind that boundary.

  # BL-466 agent-question-poll-01 and -02 (native-poll render + poll-answer return) RETIRED 2026-07-17:
  # the discrete-option render moved from a native Telegram poll to tappable inline buttons, superseded by
  # BL-483 (specs/features/BL-483-multi-option-ask-buttons.feature, scenarios -01/-02). This file now owns
  # only the open-ended plain-message fallback and the inherited bounded-await escalation for the ask; the
  # multi-option render + answer-return contract lives in the BL-483 feature file.

  # BL-466 agent-question-poll-03
  Scenario: An open-ended question falls back to a plain message
    Given the specifier asks a question with no discrete options
    When the question is surfaced to the human
    Then it is posted as a plain message in the agent-questions topic, not a poll
    And the human's in-thread reply is returned to the asking agent as the answer

  # BL-466 agent-question-poll-04
  Scenario: An unanswered question follows the bounded-await escalation, never blocking forever
    Given a question surfaced to the human that goes unanswered past the await window
    When the await window elapses
    Then the agent escalates once and then proceeds, per the inherited human-in-the-loop timeout
