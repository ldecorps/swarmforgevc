Feature: a Telegram chat adapter projects run events and relays human gate replies

  # Roadmap gap #3 (coordinator scan 2026-07-10); operator picked Telegram (easiest
  # bot API, free, unprompted messages fine). Spec.MD 1386-1408. HARD BOUNDARY: the
  # chat app is a human-facing projection ONLY, never the agent coordination bus —
  # agents keep talking only through the on-disk message store. The adapter holds no
  # state: it projects store events outward (via the bridge) and turns a human's
  # gate reply into a gate answer. Per the operator's gate-answer scope (BL-240),
  # inbound is limited to answering captured gates; stop/respawn/other commands are
  # out of scope here. Inbound gate relay depends on BL-240. M6, large.

  Background:
    Given a run whose events are in the on-disk message store, projected by the bridge to a Telegram bot

  # BL-239 per-run-thread-narrates-01
  Scenario: a run gets one Telegram thread that narrates its key events
    Given a run in progress
    When stage transitions, gates, dead-letters, and the final PR link occur
    Then the bot posts each of them to that run's single Telegram thread

  # BL-239 human-reply-answers-gate-02
  Scenario: a human's reply to a gate prompt is relayed as a gate answer
    Given the bot posted a to-human gate prompt in the thread
    When the human replies to that prompt in Telegram
    Then the reply is turned into an answer for that gate and the pipeline unblocks

  # BL-239 human-only-not-agent-bus-03
  Scenario: the adapter never carries agent-to-agent coordination traffic
    Given agents coordinating through the on-disk message store
    When the chat adapter runs
    Then it only projects store events outward and relays human replies inward
    And no agent-to-agent handoff is routed through Telegram

  # BL-239 controls-out-of-scope-04
  Scenario: inbound commands beyond answering a gate are not honored
    Given the operator's remote scope is answer captured gates only
    When a human sends a stop, respawn, or arbitrary command in the thread
    Then it is not executed and only gate answers are accepted inbound
