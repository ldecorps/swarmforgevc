Feature: BL-1126 Local Agent Telegram turns stay live under Ollama latency
  # Real Qwen turns on CPU take tens of seconds to minutes — that is expected.
  # Silent hangs, empty finals, and front-desk wedges are not. Progress must
  # stream without blocking the bot; turn gate / idle abort must recover.

  # Design lock (specifier 2026-08-25): build on landed Local Agent harden
  # on human/local-agent-telegram (turn gate, socket deadlines, empty-reply
  # recovery, progress streaming). This ticket closes remaining hang classes
  # and documents the fast-path vs real-turn latency contract.

  # BL-1126 fast-path-still-immediate-01
  Scenario: Ping and status fast-path probes stay sub-second without Ollama
    Given Local Agent is healthy
    When the human sends a documented fast-path probe (Ping hi hello status)
    Then the Telegram reply returns without calling Ollama
    And latency stays in the fast-path band (order of tens of ms)

  # BL-1126 real-turn-progress-not-silence-02
  Scenario: a real question posts progress before the final answer
    Given Ollama is serving the configured chat model
    When the human asks a non-probe question in the Local Agent topic
    Then the front desk posts at least one progress update before the final
    And the bot poll loop is not blocked waiting on the full completion

  # BL-1126 empty-reply-recovery-03
  Scenario: empty model completion does not leave the topic hung forever
    Given a turn whose model completion is empty or whitespace-only
    When the turn finishes
    Then Local Agent recovers with a non-empty degraded reply or explicit failure
    And the topic is not left awaiting a final that never comes

  # BL-1126 idle-abort-and-deadline-04
  Scenario: wedged Ollama sockets abort and surface instead of hanging Telegram
    Given an Ollama chat call that exceeds the configured socket or idle deadline
    When the deadline fires
    Then the turn aborts cleanly
    And the topic receives an explicit timeout/failure receipt
    And a later probe or turn can succeed without restarting the bot
